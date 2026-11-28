//! Box-group ability pick reconciliation and serpentine turn ordering.
//!
//! Mirrors `src/core/domain/pick-attribution.ts`.

use std::collections::{BTreeMap, HashMap, HashSet};

pub const LATE_PICK_GRACE_S: f64 = 20.0;
pub const PICK_SEEN_EARLY_TOLERANCE_S: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PickBox {
    Std,
    Ult,
}

impl PickBox {
    fn capacity(self) -> usize {
        match self {
            Self::Std => 3,
            Self::Ult => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickKind {
    Ability,
    Model,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PickEvent {
    pub seq: usize,
    pub player_index: u8,
    pub ability_name: Option<String>,
    pub kind: PickKind,
    pub pool_hero_order: Option<u8>,
    pub clock_time: Option<i64>,
    pub box_group: Option<PickBox>,
    pub seen_at_s: Option<f64>,
    pub vacated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CardSlotReading {
    pub hero_order: u8,
    pub is_ultimate: bool,
    pub name: Option<String>,
    pub confidence: f64,
    pub has_rejected_match: bool,
}

impl CardSlotReading {
    fn is_unreadable(&self) -> bool {
        self.name.is_none() && (self.has_rejected_match || self.confidence > 0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnWindow {
    pub player_index: u8,
    pub start_s: f64,
    pub end_s: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DraftTurnOptions {
    pub grace_s: f64,
    pub early_s: f64,
}

impl Default for DraftTurnOptions {
    fn default() -> Self {
        Self {
            grace_s: LATE_PICK_GRACE_S,
            early_s: PICK_SEEN_EARLY_TOLERANCE_S,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AbilityPickUpdate {
    pub timeline: Vec<PickEvent>,
    pub added: Vec<PickEvent>,
    pub corrected: Vec<(u8, String, String)>,
    pub phantoms: Vec<(u8, String)>,
    pub vacated_changed: bool,
}

pub fn reconcile_ability_picks(
    timeline_in: &[PickEvent],
    next_selected: &[CardSlotReading],
    clock_time: Option<i64>,
    seen_at_s: Option<f64>,
) -> AbilityPickUpdate {
    let mut timeline: Vec<Option<PickEvent>> = timeline_in.iter().cloned().map(Some).collect();
    let mut added: Vec<PickEvent> = Vec::new();
    let mut corrected: Vec<(u8, String, String)> = Vec::new();
    let mut phantoms: Vec<(u8, String)> = Vec::new();
    let mut vacated_changed = false;

    let mut groups: BTreeMap<(u8, u8), Vec<&CardSlotReading>> = BTreeMap::new();
    for slot in next_selected {
        let box_kind = if slot.is_ultimate { 1u8 } else { 0u8 };
        groups.entry((slot.hero_order, box_kind)).or_default().push(slot);
    }

    for ((row, box_code), boxes) in groups {
        let box_group = if box_code == 1 { PickBox::Ult } else { PickBox::Std };
        let mut visible: Vec<String> = Vec::new();
        for slot in &boxes {
            if let Some(name) = &slot.name {
                if !visible.contains(name) {
                    visible.push(name.clone());
                }
            }
        }
        let readable =
            boxes.len() >= box_group.capacity() && !boxes.iter().any(|s| s.is_unreadable());

        let indices: Vec<usize> = timeline
            .iter()
            .enumerate()
            .filter_map(|(idx, slot)| {
                let ev = slot.as_ref()?;
                if ev.kind == PickKind::Ability
                    && ev.player_index == row
                    && ev.box_group == Some(box_group)
                {
                    Some(idx)
                } else {
                    None
                }
            })
            .collect();

        for &idx in &indices {
            if let Some(ev) = timeline[idx].as_mut() {
                if ev.vacated {
                    if let Some(name) = &ev.ability_name {
                        if visible.contains(name) {
                            ev.vacated = false;
                            vacated_changed = true;
                        }
                    }
                }
            }
        }

        let recorded_names: HashSet<String> = indices
            .iter()
            .filter_map(|&idx| timeline[idx].as_ref()?.ability_name.clone())
            .collect();
        let appeared: Vec<String> = visible
            .iter()
            .filter(|name| !recorded_names.contains(*name))
            .cloned()
            .collect();
        let gone: Vec<usize> = indices
            .iter()
            .copied()
            .filter(|&idx| {
                timeline[idx]
                    .as_ref()
                    .and_then(|e| e.ability_name.as_ref())
                    .is_some_and(|name| !visible.contains(name))
            })
            .collect();

        let make_pick = |name: String| PickEvent {
            seq: 0,
            player_index: row,
            ability_name: Some(name),
            kind: PickKind::Ability,
            pool_hero_order: None,
            clock_time,
            box_group: Some(box_group),
            seen_at_s,
            vacated: false,
        };

        if !readable {
            for idx in gone {
                if let Some(ev) = timeline[idx].as_mut() {
                    if !ev.vacated {
                        ev.vacated = true;
                        vacated_changed = true;
                    }
                }
            }
            for name in appeared {
                added.push(make_pick(name));
            }
            continue;
        }

        let mut gone_live: Vec<usize> = Vec::new();
        for idx in gone {
            let is_vacated = timeline[idx].as_ref().is_some_and(|e| e.vacated);
            if is_vacated {
                let name = timeline[idx]
                    .as_ref()
                    .and_then(|e| e.ability_name.clone())
                    .unwrap_or_default();
                phantoms.push((row, name));
                timeline[idx] = None;
            } else {
                gone_live.push(idx);
            }
        }

        let mut replacements = appeared.into_iter();
        for idx in gone_live {
            if let Some(replacement) = replacements.next() {
                if let Some(ev) = timeline[idx].as_mut() {
                    let from = ev.ability_name.clone().unwrap_or_default();
                    corrected.push((row, from, replacement.clone()));
                    ev.ability_name = Some(replacement);
                }
            } else {
                let name = timeline[idx]
                    .as_ref()
                    .and_then(|e| e.ability_name.clone())
                    .unwrap_or_default();
                phantoms.push((row, name));
                timeline[idx] = None;
            }
        }
        for remaining in replacements {
            added.push(make_pick(remaining));
        }
    }

    AbilityPickUpdate {
        timeline: timeline.into_iter().flatten().collect(),
        added,
        corrected,
        phantoms,
        vacated_changed,
    }
}

pub fn assign_draft_turns(
    timeline: &[PickEvent],
    schedule: &[TurnWindow],
    options: DraftTurnOptions,
) -> Vec<Option<usize>> {
    let mut turns_of: HashMap<u8, Vec<usize>> = HashMap::new();
    for (turn, window) in schedule.iter().enumerate() {
        turns_of.entry(window.player_index).or_default().push(turn);
    }

    let mut events_of: HashMap<u8, Vec<(usize, &PickEvent)>> = HashMap::new();
    for (pos, event) in timeline.iter().enumerate() {
        events_of.entry(event.player_index).or_default().push((pos, event));
    }

    let mut turn_of = vec![None; timeline.len()];
    for (player, events) in events_of {
        let turns = turns_of.get(&player).map(Vec::as_slice).unwrap_or(&[]);
        let mut taken: HashSet<usize> = HashSet::new();

        let started = |seen_at: f64, turn: usize| -> bool {
            schedule[turn].start_s <= seen_at + options.early_s
        };
        let lateness = |seen_at: f64, turn: usize| -> f64 {
            seen_at - schedule[turn].end_s - options.grace_s
        };

        let mut timed: Vec<(usize, f64)> = events
            .iter()
            .filter_map(|&(pos, ev)| ev.seen_at_s.map(|s| (pos, s)))
            .collect();
        timed.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

        // 1. Seen in time for a turn
        for &(pos, seen_at) in &timed {
            if let Some(&turn) = turns
                .iter()
                .find(|&&t| !taken.contains(&t) && started(seen_at, t) && lateness(seen_at, t) <= 0.0)
            {
                turn_of[pos] = Some(turn);
                taken.insert(turn);
            }
        }

        // 2. Seen late: least-late pairing first
        loop {
            let mut best: Option<(usize, usize, f64)> = None;
            for &(pos, seen_at) in &timed {
                if turn_of[pos].is_some() {
                    continue;
                }
                for &turn in turns {
                    if taken.contains(&turn) || !started(seen_at, turn) {
                        continue;
                    }
                    let late = lateness(seen_at, turn);
                    if best.is_none_or(|b| late < b.2) {
                        best = Some((pos, turn, late));
                    }
                }
            }
            let Some((pos, turn, _)) = best else {
                break;
            };
            turn_of[pos] = Some(turn);
            taken.insert(turn);
        }

        // 3. Remaining events fill earliest free turns
        for &(pos, _) in &events {
            if turn_of[pos].is_some() {
                continue;
            }
            if let Some(&turn) = turns.iter().find(|&&t| !taken.contains(&t)) {
                turn_of[pos] = Some(turn);
                taken.insert(turn);
            }
        }

        // Same-capture group hands out turns in timeline order
        let mut by_seen: Vec<(f64, Vec<usize>)> = Vec::new();
        for &(pos, seen_at) in &timed {
            if let Some((_, group)) = by_seen.iter_mut().find(|(s, _)| (*s - seen_at).abs() == 0.0) {
                group.push(pos);
            } else {
                by_seen.push((seen_at, vec![pos]));
            }
        }
        for (_, mut positions) in by_seen {
            if positions.len() < 2 {
                continue;
            }
            let mut slots: Vec<Option<usize>> = positions.iter().map(|&p| turn_of[p]).collect();
            slots.sort_by_key(|s| s.unwrap_or(usize::MAX));
            positions.sort_unstable();
            for (pos, slot) in positions.into_iter().zip(slots) {
                turn_of[pos] = slot;
            }
        }
    }

    turn_of
}

pub fn order_by_draft_turns(
    timeline: &[PickEvent],
    schedule: &[TurnWindow],
    options: DraftTurnOptions,
) -> Vec<PickEvent> {
    let turn_of = assign_draft_turns(timeline, schedule, options);
    let mut indexed: Vec<(usize, usize, PickEvent)> = timeline
        .iter()
        .cloned()
        .enumerate()
        .map(|(pos, ev)| (turn_of[pos].unwrap_or(schedule.len() + pos), pos, ev))
        .collect();
    indexed.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    indexed
        .into_iter()
        .enumerate()
        .map(|(seq, (_, _, mut ev))| {
            ev.seq = seq;
            ev
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn std_slot(hero_order: u8, name: Option<&str>, rejected: bool) -> CardSlotReading {
        CardSlotReading {
            hero_order,
            is_ultimate: false,
            name: name.map(ToOwned::to_owned),
            confidence: if name.is_some() { 0.95 } else { 0.0 },
            has_rejected_match: rejected,
        }
    }

    #[test]
    fn reordered_standard_boxes_produce_zero_new_or_corrected_picks() {
        let initial = vec![PickEvent {
            seq: 0,
            player_index: 2,
            ability_name: Some("sven_storm_bolt".into()),
            kind: PickKind::Ability,
            pool_hero_order: None,
            clock_time: Some(-10),
            box_group: Some(PickBox::Std),
            seen_at_s: Some(12.0),
            vacated: false,
        }];
        let next = vec![
            std_slot(2, None, false),
            std_slot(2, Some("sven_storm_bolt"), false),
            std_slot(2, None, false),
        ];
        let upd = reconcile_ability_picks(&initial, &next, Some(-20), Some(20.0));
        assert!(upd.added.is_empty());
        assert!(upd.corrected.is_empty());
        assert!(upd.phantoms.is_empty());
        assert_eq!(upd.timeline.len(), 1);
    }

    #[test]
    fn unreadable_box_vacates_instead_of_dropping_then_clears_when_visible() {
        let initial = vec![PickEvent {
            seq: 0,
            player_index: 1,
            ability_name: Some("lion_impale".into()),
            kind: PickKind::Ability,
            pool_hero_order: None,
            clock_time: Some(-10),
            box_group: Some(PickBox::Std),
            seen_at_s: Some(10.0),
            vacated: false,
        }];
        let hidden = vec![
            std_slot(1, None, true),
            std_slot(1, None, false),
            std_slot(1, None, false),
        ];
        let upd1 = reconcile_ability_picks(&initial, &hidden, Some(-15), Some(15.0));
        assert!(upd1.vacated_changed);
        assert!(upd1.timeline[0].vacated);

        let restored = vec![
            std_slot(1, Some("lion_impale"), false),
            std_slot(1, None, false),
            std_slot(1, None, false),
        ];
        let upd2 = reconcile_ability_picks(&upd1.timeline, &restored, Some(-20), Some(20.0));
        assert!(upd2.vacated_changed);
        assert!(!upd2.timeline[0].vacated);
    }

    #[test]
    fn orders_picks_idempotently_across_double_turns() {
        let schedule = vec![
            TurnWindow { player_index: 0, start_s: 0.0, end_s: 7.0 },
            TurnWindow { player_index: 1, start_s: 7.0, end_s: 14.0 },
            TurnWindow { player_index: 1, start_s: 14.0, end_s: 21.0 },
            TurnWindow { player_index: 0, start_s: 21.0, end_s: 28.0 },
        ];
        let timeline = vec![
            PickEvent {
                seq: 0,
                player_index: 0,
                ability_name: Some("p0_late_second".into()),
                kind: PickKind::Ability,
                pool_hero_order: None,
                clock_time: None,
                box_group: Some(PickBox::Std),
                seen_at_s: Some(30.0),
                vacated: false,
            },
            PickEvent {
                seq: 1,
                player_index: 1,
                ability_name: Some("p1_first".into()),
                kind: PickKind::Ability,
                pool_hero_order: None,
                clock_time: None,
                box_group: Some(PickBox::Std),
                seen_at_s: Some(18.0),
                vacated: false,
            },
            PickEvent {
                seq: 2,
                player_index: 1,
                ability_name: Some("p1_second".into()),
                kind: PickKind::Ability,
                pool_hero_order: None,
                clock_time: None,
                box_group: Some(PickBox::Std),
                seen_at_s: Some(24.0),
                vacated: false,
            },
            PickEvent {
                seq: 3,
                player_index: 0,
                ability_name: Some("p0_first".into()),
                kind: PickKind::Ability,
                pool_hero_order: None,
                clock_time: None,
                box_group: Some(PickBox::Std),
                seen_at_s: Some(9.0),
                vacated: false,
            },
        ];

        let ordered = order_by_draft_turns(&timeline, &schedule, DraftTurnOptions::default());
        let names: Vec<&str> = ordered
            .iter()
            .map(|e| e.ability_name.as_deref().unwrap())
            .collect();
        assert_eq!(names, vec!["p0_first", "p1_first", "p1_second", "p0_late_second"]);
        // Idempotency
        assert_eq!(
            order_by_draft_turns(&ordered, &schedule, DraftTurnOptions::default()),
            ordered
        );
    }
}
