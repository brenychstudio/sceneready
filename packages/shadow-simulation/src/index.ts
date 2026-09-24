export {
  SHADOW_SIMULATION_DENIAL_CODES,
  SHADOW_SIMULATION_SCHEMA_VERSION,
  simulateShadowProduction,
  type ShadowCallTimeFact,
  type ShadowGraphSnapshot,
  type ShadowOperationalState,
  type ShadowSimulation,
  type ShadowSimulationDenialCode,
  type ShadowSimulationInput,
  type ShadowSimulationResult,
} from './simulate.js';
export {
  compareProductionAssessments,
  type ShadowComparison,
  type ShadowRiskTransition,
} from './compare.js';
export {
  EMPTY_RECOVERY_PROJECTION,
  PROJECTION_DENIAL_CODES,
  RECOVERY_PROJECTION_SCHEMA_VERSION,
  type ProjectionDenialCode,
  type ProjectionPredicate,
  type RecoveryProjectionPolicy,
  type RiskProjectionRule,
} from './projection.js';
