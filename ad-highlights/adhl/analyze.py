"""Pure moment detection over an OpenDota *parsed* match. No network, no filesystem.

Input shape (OpenDota /matches/{id} after parse):
  match.players[i]           - index-aligned with match.teamfights[*].players[i]
    .hero_id, .player_slot, .personaname, .isRadiant
    .ability_upgrades_arr    - ability ids in level-up order (the drafted kit, plus talents)
    .ability_uses            - {internal_name: count} for the whole game
    .kills_log               - [{time, key: "npc_dota_hero_x"}]
  match.teamfights[]         - {start, end, last_death, deaths, players[10]: {ability_uses, killed, deaths, damage, healing, gold_delta, xp_delta}}

Scoring is deliberately simple and documented inline so it can be tuned by feel:
kills dominate, damage refines, using 2+ drafted actives in the same fight is the "combo" signal,
and tag-based setup->payoff pairs (from ability_tags.json) get a bonus.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

GAME_MODE_ABILITY_DRAFT = 18

# Names in ability_uses / ability_upgrades that are not draftable abilities.
_SKIP_PREFIXES = ("special_bonus", "generic_", "ability_", "attribute_bonus", "plus_", "twin_gate", "dota_")

# Tag classes for the synergy bonus. Vocabulary mirrors resources/data/ability_tags.json.
SETUP_TAGS = frozenset({"hard_cc", "setup_cc", "initiation"})
PAYOFF_TAGS = frozenset({"nuke", "aoe", "teamfight_ult", "steroid"})

W_KILL = 3.0
W_DAMAGE_PER_1000 = 1.0
W_EXTRA_ACTIVE = 1.5  # per drafted active used beyond the first in one fight
W_SETUP_PAYOFF = 2.0
W_DOUBLE_ULT = 2.0
W_TRIPLE_PLUS = 2.0
W_DEATH = -1.0
W_FOCUS = 3.0
W_BURST_PER_EXTRA_KILL = 1.5
W_STANDALONE_BURST_KILL = 2.5


@dataclass
class Moment:
    match_id: int
    player_index: int
    hero: str
    player_name: str
    team: str
    kind: str  # "teamfight" | "kill_burst"
    start: float
    end: float
    kills: int = 0
    deaths: int = 0
    damage: int = 0
    healing: int = 0
    gold_delta: int = 0
    used: dict[str, int] = field(default_factory=dict)  # drafted abilities cast during the window
    kit: list[str] = field(default_factory=list)  # full drafted kit (internal names)
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {**self.__dict__, "score": round(self.score, 2)}


def is_draftable(name: str) -> bool:
    return bool(name) and not name.startswith(_SKIP_PREFIXES)


def player_kit(player: dict[str, Any], ability_ids: dict[str, str]) -> list[str]:
    """Drafted abilities in first-skilled order, plus anything cast that the upgrade list missed."""
    kit: list[str] = []
    for aid in player.get("ability_upgrades_arr") or []:
        name = ability_ids.get(str(aid))
        if name and is_draftable(name) and name not in kit:
            kit.append(name)
    for name in (player.get("ability_uses") or {}):
        if is_draftable(name) and name not in kit:
            kit.append(name)
    return kit


def hero_name(hero_id: Any, heroes: dict[str, Any]) -> str:
    h = heroes.get(str(hero_id)) or {}
    return h.get("localized_name") or f"hero#{hero_id}"


def _tags_of(name: str, tags: dict[str, Any]) -> set[str]:
    entry = (tags.get("abilities") or {}).get(name) or {}
    return set(entry.get("tags") or [])


def _matches_focus(name: str, focus: Iterable[str]) -> bool:
    return any(f and f.lower() in name.lower() for f in focus)


def _kill_bursts(times: list[float], window: float) -> list[tuple[float, float, int]]:
    """Maximal clusters of >=2 kills where consecutive kills are <= window apart -> (first, last, n)."""
    times = sorted(times)
    out: list[tuple[float, float, int]] = []
    i = 0
    while i < len(times):
        j = i
        while j + 1 < len(times) and times[j + 1] - times[j] <= window:
            j += 1
        if j > i:
            out.append((times[i], times[j], j - i + 1))
        i = j + 1
    return out


def analyze_match(
    match: dict[str, Any],
    ability_ids: dict[str, str],
    heroes: dict[str, Any],
    tags: dict[str, Any] | None = None,
    focus_abilities: Iterable[str] = (),
    kill_burst_window: float = 20.0,
) -> list[Moment]:
    tags = tags or {}
    focus = list(focus_abilities)
    match_id = int(match.get("match_id") or 0)
    players: list[dict[str, Any]] = list(match.get("players") or [])
    teamfights: list[dict[str, Any]] = list(match.get("teamfights") or [])

    kits = [player_kit(p, ability_ids) for p in players]
    names = [hero_name(p.get("hero_id"), heroes) for p in players]
    moments: list[Moment] = []

    def base(i: int, kind: str, start: float, end: float) -> Moment:
        p = players[i]
        radiant = p.get("isRadiant") if p.get("isRadiant") is not None else (int(p.get("player_slot") or 0) < 128)
        return Moment(
            match_id=match_id,
            player_index=i,
            hero=names[i],
            player_name=(p.get("personaname") or "Anonymous").strip() or "Anonymous",
            team="Radiant" if radiant else "Dire",
            kind=kind,
            start=float(start),
            end=float(end),
            kit=kits[i],
        )

    # --- teamfight moments ------------------------------------------------------------------------
    tf_moments: dict[tuple[int, int], Moment] = {}
    for t_idx, tf in enumerate(teamfights):
        tf_players = tf.get("players") or []
        for i, p in enumerate(players):
            if i >= len(tf_players):
                break
            tp = tf_players[i] or {}
            kills = sum(int(v) for v in (tp.get("killed") or {}).values())
            deaths = int(tp.get("deaths") or 0)
            damage = int(tp.get("damage") or 0)
            used = {n: int(c) for n, c in (tp.get("ability_uses") or {}).items() if is_draftable(n)}
            if kills == 0 and not (len(used) >= 2 and damage >= 1500):
                continue
            m = base(i, "teamfight", tf.get("start", 0), tf.get("end", 0))
            m.kills, m.deaths, m.damage = kills, deaths, damage
            m.healing = int(tp.get("healing") or 0)
            m.gold_delta = int(tp.get("gold_delta") or 0)
            m.used = used
            score = W_KILL * kills + W_DAMAGE_PER_1000 * damage / 1000.0 + W_DEATH * deaths
            if kills:
                m.reasons.append(f"{kills} kill{'s' if kills != 1 else ''} in one fight")
            if damage >= 3000:
                m.reasons.append(f"{damage:,} hero damage")
            if len(used) >= 2:
                score += W_EXTRA_ACTIVE * (len(used) - 1)
                m.reasons.append("cast " + " + ".join(sorted(used, key=lambda n: -used[n])))
            used_tags = {n: _tags_of(n, tags) for n in used}
            has_setup = [n for n, t in used_tags.items() if t & SETUP_TAGS]
            has_payoff = [n for n, t in used_tags.items() if t & PAYOFF_TAGS and n not in has_setup]
            if has_setup and has_payoff:
                score += W_SETUP_PAYOFF
                m.reasons.append(f"setup->payoff: {has_setup[0]} -> {has_payoff[0]}")
            ults = [n for n, t in used_tags.items() if "teamfight_ult" in t]
            if len(ults) >= 2:
                score += W_DOUBLE_ULT
                m.reasons.append("two teamfight ultimates in one fight")
            if kills >= 3:
                score += W_TRIPLE_PLUS
            focused = [n for n in used if _matches_focus(n, focus)]
            if focused:
                score += W_FOCUS
                m.reasons.append("focus ability: " + ", ".join(focused))
            m.score = score
            tf_moments[(t_idx, i)] = m

    # --- rapid kill bursts from kills_log (multi-kills) ------------------------------------------
    for i, p in enumerate(players):
        times = [float(k.get("time", 0)) for k in (p.get("kills_log") or []) if isinstance(k, dict)]
        for first, last, n in _kill_bursts(times, kill_burst_window):
            attached = False
            for (t_idx, pi), m in tf_moments.items():
                if pi == i and m.start - 5 <= first <= m.end + 5:
                    m.score += W_BURST_PER_EXTRA_KILL * (n - 1)
                    m.reasons.append(f"{n} kills within {int(last - first)}s")
                    attached = True
                    break
            if attached:
                continue
            m = base(i, "kill_burst", first, last)
            m.kills = n
            m.score = W_STANDALONE_BURST_KILL * n
            m.reasons.append(f"{n} kills within {int(last - first)}s (outside a detected teamfight)")
            focused = [nme for nme in kits[i] if _matches_focus(nme, focus)]
            if focused:
                m.score += W_FOCUS / 2
                m.reasons.append("kit has focus ability: " + ", ".join(focused))
            moments.append(m)

    moments.extend(tf_moments.values())
    moments.sort(key=lambda m: (-m.score, m.start))
    return moments


def rank(moments: list[Moment], top: int, per_match: int, min_score: float) -> list[Moment]:
    """Global ranking with a per-match cap so one stomp doesn't fill the report."""
    counts: dict[int, int] = {}
    out: list[Moment] = []
    for m in sorted(moments, key=lambda m: (-m.score, m.match_id, m.start)):
        if m.score < min_score:
            continue
        if counts.get(m.match_id, 0) >= per_match:
            continue
        counts[m.match_id] = counts.get(m.match_id, 0) + 1
        out.append(m)
        if len(out) >= top:
            break
    return out
