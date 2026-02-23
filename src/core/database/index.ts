// @DEV-GUIDE: Barrel export for the database layer. Re-exports the schema and all
// repository factory functions. The actual sql.js database initialization (loading the
// WASM binary, opening/creating the .db file, running SCHEMA_SQL) happens in
// src/main/services/database-service.ts, not here. This file is purely re-exports.

export * from './schema'
export { createHeroRepository, type HeroRepository } from './repositories/hero-repository'
export {
  createAbilityRepository,
  type AbilityRepository,
} from './repositories/ability-repository'
export {
  createSynergyRepository,
  type SynergyRepository,
} from './repositories/synergy-repository'
export {
  createMetadataRepository,
  type MetadataRepository,
} from './repositories/metadata-repository'
