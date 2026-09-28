import type { InterventionPrimitive } from '@sceneready/intervention-engine';

import type {
  AuthoritativeChanges,
  AuthoritativeExecutionStatus,
  AuthoritativeReadiness,
  AuthoritativeRecoveryContext,
  AuthoritativeRiskContext,
  RecoveryCompositionInput,
} from './context.js';

export const INTELLIGENCE_PATHS = ['FAST_OPERATIONAL', 'REASONING', 'RECOVERY_PLANNING'] as const;

export type IntelligencePath = (typeof INTELLIGENCE_PATHS)[number];

export const INTELLIGENCE_REQUEST_KINDS = [
  'GET_READINESS',
  'GET_CHANGES',
  'GET_EXECUTION_STATUS',
  'EXPLAIN_RISK',
  'PLAN_RECOVERY',
] as const;

export type IntelligenceRequestKind = (typeof INTELLIGENCE_REQUEST_KINDS)[number];

export type IntelligenceRequest =
  | {
      readonly kind: 'GET_READINESS';
      readonly productionId: string;
    }
  | {
      readonly kind: 'GET_CHANGES';
      readonly productionId: string;
    }
  | {
      readonly kind: 'GET_EXECUTION_STATUS';
      readonly productionId: string;
    }
  | {
      readonly kind: 'EXPLAIN_RISK';
      readonly productionId: string;
      readonly riskId: string;
    }
  | {
      readonly kind: 'PLAN_RECOVERY';
      readonly productionId: string;
      readonly objective: string;
    };

export interface SceneReadyStatePort {
  getReadiness(productionId: string): Promise<AuthoritativeReadiness>;
  getChanges(productionId: string): Promise<AuthoritativeChanges>;
  getExecutionStatus(productionId: string): Promise<AuthoritativeExecutionStatus>;
  getRiskContext(productionId: string, riskId: string): Promise<AuthoritativeRiskContext>;
  getRecoveryContext(productionId: string): Promise<AuthoritativeRecoveryContext>;
}

export interface RecoveryCandidate {
  readonly optionId: string;
  readonly interventions: readonly InterventionPrimitive[];
}

export interface RecoveryComposer {
  compose(input: RecoveryCompositionInput): Promise<readonly RecoveryCandidate[]>;
}
