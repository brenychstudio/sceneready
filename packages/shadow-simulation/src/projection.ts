import type {
  ProductionEvaluationInput,
  ReadinessImpactFact,
  ReadinessRiskFact,
  ScoreSeverity,
} from '@sceneready/readiness-engine';

import { readActivity, projectEvaluation, type ShadowOperationalState } from './clone.js';

export const RECOVERY_PROJECTION_SCHEMA_VERSION = 'SR-RECOVERY-PROJECTION-v1';

export const PROJECTION_DENIAL_CODES = [
  'PROJECTION_VERSION_MISMATCH',
  'DUPLICATE_PROJECTION_RULE',
  'UNKNOWN_PROJECTION_RISK',
  'PROJECTION_PREDICATE_TARGET_MISSING',
  'CONFLICTING_PROJECTION_RULES',
  'UNSUPPORTED_PROJECTION_PREDICATE',
  'UNDECLARED_IMPACT_RISK',
] as const;

export type ProjectionDenialCode = (typeof PROJECTION_DENIAL_CODES)[number];

export type ProjectionPredicate =
  | {
      readonly kind: 'ACTIVITY_START_DELTA_AT_MOST';
      readonly activityId: string;
      readonly deltaMinutes: number;
    }
  | {
      readonly kind: 'ACTIVITY_END_DELTA_AT_MOST';
      readonly activityId: string;
      readonly deltaMinutes: number;
    }
  | {
      readonly kind: 'CALL_TIME_DELTA_AT_MOST';
      readonly personId: string;
      readonly deltaMinutes: number;
    }
  | {
      readonly kind: 'BUFFER_BEFORE_AT_LEAST';
      readonly activityId: string;
      readonly deltaMinutes: number;
    };

export interface RiskProjectionRule {
  readonly ruleId: string;
  readonly targetRiskId: string;
  readonly when: readonly ProjectionPredicate[];
  readonly afterSeverity: ScoreSeverity | null;
}

export interface RecoveryProjectionPolicy {
  readonly schemaVersion: typeof RECOVERY_PROJECTION_SCHEMA_VERSION;
  readonly rules: readonly RiskProjectionRule[];
}

export const EMPTY_RECOVERY_PROJECTION: RecoveryProjectionPolicy = Object.freeze({
  schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
  rules: Object.freeze([]),
});

export type ShadowProjectionResult =
  | { readonly ok: true; readonly evaluation: ProductionEvaluationInput }
  | { readonly ok: false; readonly code: ProjectionDenialCode };

const SEVERITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function deny(code: ProjectionDenialCode): ShadowProjectionResult {
  return { ok: false, code };
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function severityRank(severity: ScoreSeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

function isSeverity(value: unknown): value is ScoreSeverity {
  return typeof value === 'string' && (SEVERITY_ORDER as readonly string[]).includes(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareOrdinal);
}

function predicateKey(predicate: ProjectionPredicate): string {
  if (predicate.kind === 'CALL_TIME_DELTA_AT_MOST') {
    return `${predicate.kind}\u0000${predicate.personId}\u0000${predicate.deltaMinutes}`;
  }
  return `${predicate.kind}\u0000${predicate.activityId}\u0000${predicate.deltaMinutes}`;
}

function canonicalPredicate(predicate: ProjectionPredicate): ProjectionPredicate {
  if (predicate.kind === 'CALL_TIME_DELTA_AT_MOST') {
    return {
      kind: predicate.kind,
      personId: predicate.personId,
      deltaMinutes: predicate.deltaMinutes,
    };
  }
  return {
    kind: predicate.kind,
    activityId: predicate.activityId,
    deltaMinutes: predicate.deltaMinutes,
  };
}

function canonicalRule(rule: RiskProjectionRule): RiskProjectionRule {
  return {
    ruleId: rule.ruleId,
    targetRiskId: rule.targetRiskId,
    afterSeverity: rule.afterSeverity,
    when: [...rule.when]
      .map(canonicalPredicate)
      .sort((left, right) => compareOrdinal(predicateKey(left), predicateKey(right))),
  };
}

export function canonicalRecoveryProjection(
  policy: RecoveryProjectionPolicy,
): RecoveryProjectionPolicy {
  const rules = [...policy.rules]
    .map(canonicalRule)
    .sort((left, right) => compareOrdinal(left.ruleId, right.ruleId));
  return {
    schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
    rules,
  };
}

function predicateShape(value: ProjectionPredicate): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (!isInteger(value.deltaMinutes)) {
    return false;
  }
  switch (value.kind) {
    case 'ACTIVITY_START_DELTA_AT_MOST':
    case 'ACTIVITY_END_DELTA_AT_MOST':
    case 'BUFFER_BEFORE_AT_LEAST':
      return isNonEmptyString(value.activityId);
    case 'CALL_TIME_DELTA_AT_MOST':
      return isNonEmptyString(value.personId);
    default:
      return false;
  }
}

function ruleShape(rule: RiskProjectionRule): boolean {
  return (
    isNonEmptyString(rule.ruleId) &&
    isNonEmptyString(rule.targetRiskId) &&
    Array.isArray(rule.when) &&
    (rule.afterSeverity === null || isSeverity(rule.afterSeverity)) &&
    rule.when.every(predicateShape)
  );
}

function hasActivity(state: ShadowOperationalState, activityId: string): boolean {
  return readActivity(state, activityId) !== null;
}

function hasPerson(state: ShadowOperationalState, personId: string): boolean {
  return state.callTimes.some((item) => item.personId === personId);
}

function predicateTargetPresent(
  predicate: ProjectionPredicate,
  state: ShadowOperationalState,
): boolean {
  if (predicate.kind === 'CALL_TIME_DELTA_AT_MOST') {
    return hasPerson(state, predicate.personId);
  }
  return hasActivity(state, predicate.activityId);
}

function minuteDelta(
  live: ShadowOperationalState,
  shadow: ShadowOperationalState,
  activityId: string,
  field: 'startMinute' | 'endMinute' | 'bufferBeforeMinutes',
): number | null {
  const before = readActivity(live, activityId);
  const after = readActivity(shadow, activityId);
  if (before === null || after === null) {
    return null;
  }
  return after[field] - before[field];
}

function callDelta(
  live: ShadowOperationalState,
  shadow: ShadowOperationalState,
  personId: string,
): number | null {
  const before = live.callTimes.find((item) => item.personId === personId);
  const after = shadow.callTimes.find((item) => item.personId === personId);
  if (before === undefined || after === undefined) {
    return null;
  }
  return after.callMinute - before.callMinute;
}

function predicateDelta(
  predicate: ProjectionPredicate,
  live: ShadowOperationalState,
  shadow: ShadowOperationalState,
): number | null {
  switch (predicate.kind) {
    case 'ACTIVITY_START_DELTA_AT_MOST':
      return minuteDelta(live, shadow, predicate.activityId, 'startMinute');
    case 'ACTIVITY_END_DELTA_AT_MOST':
      return minuteDelta(live, shadow, predicate.activityId, 'endMinute');
    case 'BUFFER_BEFORE_AT_LEAST':
      return minuteDelta(live, shadow, predicate.activityId, 'bufferBeforeMinutes');
    case 'CALL_TIME_DELTA_AT_MOST':
      return callDelta(live, shadow, predicate.personId);
  }
}

function predicateMatches(
  predicate: ProjectionPredicate,
  live: ShadowOperationalState,
  shadow: ShadowOperationalState,
): boolean | null {
  const delta = predicateDelta(predicate, live, shadow);
  if (delta === null) {
    return null;
  }
  if (predicate.kind === 'BUFFER_BEFORE_AT_LEAST') {
    return delta >= predicate.deltaMinutes;
  }
  return delta <= predicate.deltaMinutes;
}

function compareRisks(left: ReadinessRiskFact, right: ReadinessRiskFact): number {
  const incident = compareOrdinal(left.incidentId, right.incidentId);
  if (incident !== 0) {
    return incident;
  }
  const risk = compareOrdinal(left.riskId, right.riskId);
  if (risk !== 0) {
    return risk;
  }
  return compareOrdinal(left.subjectId, right.subjectId);
}

function withSeverity(risk: ReadinessRiskFact, severity: ScoreSeverity): ReadinessRiskFact {
  if (risk.reasons === undefined) {
    return {
      riskId: risk.riskId,
      incidentId: risk.incidentId,
      subjectId: risk.subjectId,
      severity,
      sourceEvidenceIds: risk.sourceEvidenceIds,
    };
  }
  return {
    riskId: risk.riskId,
    incidentId: risk.incidentId,
    subjectId: risk.subjectId,
    severity,
    sourceEvidenceIds: risk.sourceEvidenceIds,
    reasons: risk.reasons,
  };
}

function maxSeverity(severities: readonly ScoreSeverity[]): ScoreSeverity | null {
  let best: ScoreSeverity | null = null;
  for (const severity of severities) {
    if (best === null || severityRank(severity) > severityRank(best)) {
      best = severity;
    }
  }
  return best;
}

function validatePolicy(
  policy: RecoveryProjectionPolicy,
  live: ShadowOperationalState,
  evaluation: ProductionEvaluationInput,
): ProjectionDenialCode | null {
  if (policy.schemaVersion !== RECOVERY_PROJECTION_SCHEMA_VERSION) {
    return 'PROJECTION_VERSION_MISMATCH';
  }
  const seen = new Map<string, string>();
  for (const rule of policy.rules) {
    if (!ruleShape(rule)) {
      return 'UNSUPPORTED_PROJECTION_PREDICATE';
    }
    const identity = JSON.stringify(canonicalRule(rule));
    const existing = seen.get(rule.ruleId);
    if (existing === undefined) {
      seen.set(rule.ruleId, identity);
    } else if (existing !== identity) {
      return 'DUPLICATE_PROJECTION_RULE';
    }
  }
  const liveRiskIds = new Set(evaluation.risks.map((risk) => risk.riskId));
  for (const rule of canonicalRecoveryProjection(policy).rules) {
    if (!liveRiskIds.has(rule.targetRiskId)) {
      return 'UNKNOWN_PROJECTION_RISK';
    }
    for (const predicate of rule.when) {
      if (!predicateTargetPresent(predicate, live)) {
        return 'PROJECTION_PREDICATE_TARGET_MISSING';
      }
    }
  }
  for (const impact of evaluation.impacts) {
    for (const riskId of impact.riskIds) {
      if (!liveRiskIds.has(riskId)) {
        return 'UNDECLARED_IMPACT_RISK';
      }
    }
  }
  return null;
}

function projectImpacts(
  impacts: readonly ReadinessImpactFact[],
  projectedRisks: readonly ReadinessRiskFact[],
  changedRiskIds: ReadonlySet<string>,
): ReadinessImpactFact[] {
  const remainingById = new Map<string, ReadinessRiskFact>();
  for (const risk of projectedRisks) {
    const existing = remainingById.get(risk.riskId);
    if (existing === undefined || severityRank(risk.severity) > severityRank(existing.severity)) {
      remainingById.set(risk.riskId, risk);
    }
  }
  const projected: ReadinessImpactFact[] = [];
  for (const impact of impacts) {
    const touchesChange = impact.riskIds.some((riskId) => changedRiskIds.has(riskId));
    if (!touchesChange) {
      projected.push(impact);
      continue;
    }
    const remainingIds = uniqueSorted(impact.riskIds.filter((riskId) => remainingById.has(riskId)));
    if (remainingIds.length === 0) {
      continue;
    }
    const evidence: string[] = [];
    const severities: ScoreSeverity[] = [];
    for (const riskId of remainingIds) {
      const risk = remainingById.get(riskId);
      if (risk === undefined) {
        continue;
      }
      evidence.push(...risk.sourceEvidenceIds);
      severities.push(risk.severity);
    }
    const severity = maxSeverity(severities);
    if (severity === null) {
      continue;
    }
    projected.push({
      incidentId: impact.incidentId,
      deliverableId: impact.deliverableId,
      severity,
      sourceEvidenceIds: uniqueSorted(evidence),
      riskIds: remainingIds,
    });
  }
  return projected;
}

export function projectShadowEvaluation(
  evaluation: ProductionEvaluationInput,
  live: ShadowOperationalState,
  shadow: ShadowOperationalState,
  policy: RecoveryProjectionPolicy,
): ShadowProjectionResult {
  const invalid = validatePolicy(policy, live, evaluation);
  if (invalid !== null) {
    return deny(invalid);
  }

  const effects = new Map<string, ScoreSeverity | null>();
  for (const rule of canonicalRecoveryProjection(policy).rules) {
    let matches = true;
    for (const predicate of rule.when) {
      const matched = predicateMatches(predicate, live, shadow);
      if (matched === null) {
        return deny('PROJECTION_PREDICATE_TARGET_MISSING');
      }
      if (!matched) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    const existing = effects.get(rule.targetRiskId);
    if (existing !== undefined && existing !== rule.afterSeverity) {
      return deny('CONFLICTING_PROJECTION_RULES');
    }
    effects.set(rule.targetRiskId, rule.afterSeverity);
  }

  const changedRiskIds = new Set<string>();
  const projectedRisks: ReadinessRiskFact[] = [];
  for (const risk of evaluation.risks) {
    if (!effects.has(risk.riskId)) {
      projectedRisks.push(risk);
      continue;
    }
    const afterSeverity = effects.get(risk.riskId);
    if (afterSeverity === null || afterSeverity === undefined) {
      changedRiskIds.add(risk.riskId);
      continue;
    }
    if (afterSeverity !== risk.severity) {
      changedRiskIds.add(risk.riskId);
      projectedRisks.push(withSeverity(risk, afterSeverity));
      continue;
    }
    projectedRisks.push(risk);
  }
  projectedRisks.sort(compareRisks);

  const base = projectEvaluation(evaluation);
  return {
    ok: true,
    evaluation: {
      ...base,
      risks: projectedRisks,
      impacts: projectImpacts(base.impacts, projectedRisks, changedRiskIds),
    },
  };
}
