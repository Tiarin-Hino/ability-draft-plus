//! Native SQLite reader (`rusqlite`) compatible with `resources/dota_ad_data.db`.

use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HeroRow {
    pub hero_id: i64,
    pub name: String,
    pub display_name: Option<String>,
    pub winrate: Option<f64>,
    pub pick_rate: Option<f64>,
    pub windrun_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AbilityRow {
    pub ability_id: i64,
    pub name: String,
    pub display_name: Option<String>,
    pub hero_id: Option<i64>,
    pub winrate: Option<f64>,
    pub pick_rate: Option<f64>,
    pub is_ultimate: bool,
    pub ability_order: Option<i64>,
    pub windrun_id: Option<i64>,
    pub kills_shift: Option<f64>,
    pub deaths_shift: Option<f64>,
    pub ka_shift: Option<f64>,
    pub gpm_shift: Option<f64>,
    pub xpm_shift: Option<f64>,
    pub dmg_shift: Option<f64>,
    pub healing_shift: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AbilitySynergyRow {
    pub base_ability_id: i64,
    pub synergy_ability_id: i64,
    pub synergy_winrate: f64,
    pub synergy_increase: Option<f64>,
    pub is_op: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DbSummary {
    pub heroes_count: i64,
    pub abilities_count: i64,
    pub ability_synergies_count: i64,
    pub hero_ability_synergies_count: i64,
    pub ability_triplets_count: i64,
    pub hero_ability_triplets_count: i64,
    pub last_successful_scrape_date: Option<String>,
}

pub struct AdDatabase {
    conn: Connection,
}

impl AdDatabase {
    pub fn open_immutable_readonly(path: &Path) -> rusqlite::Result<Self> {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let raw = canonical.to_string_lossy().replace('\\', "/");
        let stripped = raw.strip_prefix("//?/").unwrap_or(&raw);
        let uri = format!("file:///{}?immutable=1", stripped.trim_start_matches('/'));
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI;
        let conn = Connection::open_with_flags(uri, flags)?;
        Ok(Self { conn })
    }

    fn count_table(&self, table: &str) -> rusqlite::Result<i64> {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        self.conn.query_row(&sql, [], |row| row.get(0))
    }

    pub fn summary(&self) -> rusqlite::Result<DbSummary> {
        let last_successful_scrape_date = self
            .conn
            .query_row(
                "SELECT value FROM Metadata WHERE key = 'last_successful_scrape_date'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        Ok(DbSummary {
            heroes_count: self.count_table("Heroes")?,
            abilities_count: self.count_table("Abilities")?,
            ability_synergies_count: self.count_table("AbilitySynergies")?,
            hero_ability_synergies_count: self.count_table("HeroAbilitySynergies")?,
            ability_triplets_count: self.count_table("AbilityTriplets")?,
            hero_ability_triplets_count: self.count_table("HeroAbilityTriplets")?,
            last_successful_scrape_date,
        })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn load_heroes(&self) -> rusqlite::Result<Vec<HeroRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT hero_id, name, display_name, winrate, pick_rate, windrun_id
             FROM Heroes
             ORDER BY hero_id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HeroRow {
                hero_id: row.get(0)?,
                name: row.get(1)?,
                display_name: row.get(2)?,
                winrate: row.get(3)?,
                pick_rate: row.get(4)?,
                windrun_id: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn load_abilities(&self) -> rusqlite::Result<Vec<AbilityRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT ability_id, name, display_name, hero_id, winrate, pick_rate,
                    COALESCE(is_ultimate, 0), ability_order, windrun_id,
                    kills_shift, deaths_shift, ka_shift, gpm_shift, xpm_shift, dmg_shift, healing_shift
             FROM Abilities
             ORDER BY ability_id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let ult_int: i64 = row.get(6)?;
            Ok(AbilityRow {
                ability_id: row.get(0)?,
                name: row.get(1)?,
                display_name: row.get(2)?,
                hero_id: row.get(3)?,
                winrate: row.get(4)?,
                pick_rate: row.get(5)?,
                is_ultimate: ult_int != 0,
                ability_order: row.get(7)?,
                windrun_id: row.get(8)?,
                kills_shift: row.get(9)?,
                deaths_shift: row.get(10)?,
                ka_shift: row.get(11)?,
                gpm_shift: row.get(12)?,
                xpm_shift: row.get(13)?,
                dmg_shift: row.get(14)?,
                healing_shift: row.get(15)?,
            })
        })?;
        rows.collect()
    }

    pub fn load_ability_synergies(&self) -> rusqlite::Result<Vec<AbilitySynergyRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT base_ability_id, synergy_ability_id, synergy_winrate, synergy_increase, COALESCE(is_op, 0)
             FROM AbilitySynergies",
        )?;
        let rows = stmt.query_map([], |row| {
            let op_int: i64 = row.get(4)?;
            Ok(AbilitySynergyRow {
                base_ability_id: row.get(0)?,
                synergy_ability_id: row.get(1)?,
                synergy_winrate: row.get(2)?,
                synergy_increase: row.get(3)?,
                is_op: op_int != 0,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn seed_db_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources/dota_ad_data.db")
    }

    #[test]
    fn reads_bundled_seed_database_schema_and_counts() {
        let path = seed_db_path();
        assert!(path.exists(), "missing seed DB at {}", path.display());

        let db = AdDatabase::open_immutable_readonly(&path).expect("open seed DB");
        let summary = db.summary().expect("query DB summary");
        assert_eq!(summary.heroes_count, 127);
        assert!(summary.abilities_count >= 500);
        assert!(summary.ability_synergies_count > 2000);
        assert!(summary.hero_ability_synergies_count > 0);
        assert!(summary.ability_triplets_count > 0);
        assert!(summary.hero_ability_triplets_count > 0);

        let heroes = db.load_heroes().expect("load heroes");
        assert_eq!(heroes.len(), 127);

        let abilities = db.load_abilities().expect("load abilities");
        assert_eq!(i64::try_from(abilities.len()).ok(), Some(summary.abilities_count));

        let synergies = db.load_ability_synergies().expect("load ability synergies");
        assert_eq!(
            i64::try_from(synergies.len()).ok(),
            Some(summary.ability_synergies_count)
        );
    }
}
