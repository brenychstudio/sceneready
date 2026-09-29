export const NEW_RISK_INTRODUCED_ALGORITHM_VERSION = 'SR-NEW-RISK-INTRODUCED-v1' as const;

export const NEW_RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type NewRiskSeverity = (typeof NEW_RISK_SEVERITIES)[number];

export const NEW_RISK_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type NewRiskLevel = (typeof NEW_RISK_LEVELS)[number];

export const NEW_RISK_INTRODUCED_ISSUES = [
  'CONFLICTING_RISK',
  'MALFORMED_INPUT',
  'MALFORMED_RISK_ID',
  'MALFORMED_SEVERITY',
] as const;

export type NewRiskIntroducedIssue = (typeof NEW_RISK_INTRODUCED_ISSUES)[number];

export interface IntroducedRisk {
  readonly riskId: string;
  readonly severity: NewRiskSeverity;
}

export interface NewRiskIntroducedAvailable {
  readonly status: 'AVAILABLE';
  readonly algorithmVersion: typeof NEW_RISK_INTRODUCED_ALGORITHM_VERSION;
  readonly level: NewRiskLevel;
}

export interface NewRiskIntroducedWithheld {
  readonly status: 'WITHHELD';
  readonly algorithmVersion: typeof NEW_RISK_INTRODUCED_ALGORITHM_VERSION;
  readonly issues: readonly NewRiskIntroducedIssue[];
}

export type NewRiskIntroducedResult = NewRiskIntroducedAvailable | NewRiskIntroducedWithheld;

interface RiskIdentity {
  readonly key: string;
  readonly signature: string;
}

interface AcceptedRisk {
  readonly key: string;
  readonly severity: NewRiskSeverity;
}

const SEVERITY_RANK: Readonly<Record<NewRiskSeverity, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSeverity(value: unknown): value is NewRiskSeverity {
  return typeof value === 'string' && (NEW_RISK_SEVERITIES as readonly string[]).includes(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== null && typeof nested === 'object') {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

function sortedIssues(
  issues: ReadonlySet<NewRiskIntroducedIssue>,
): readonly NewRiskIntroducedIssue[] {
  return [...issues].sort(compareOrdinal);
}

function withhold(issues: ReadonlySet<NewRiskIntroducedIssue>): NewRiskIntroducedWithheld {
  return deepFreeze({
    status: 'WITHHELD',
    algorithmVersion: NEW_RISK_INTRODUCED_ALGORITHM_VERSION,
    issues: sortedIssues(issues),
  });
}

function available(level: NewRiskLevel): NewRiskIntroducedAvailable {
  return deepFreeze({
    status: 'AVAILABLE',
    algorithmVersion: NEW_RISK_INTRODUCED_ALGORITHM_VERSION,
    level,
  });
}

function worstSeverity(risks: readonly AcceptedRisk[]): NewRiskLevel {
  let worst: NewRiskSeverity | null = null;
  for (const risk of risks) {
    if (worst === null || SEVERITY_RANK[risk.severity] > SEVERITY_RANK[worst]) {
      worst = risk.severity;
    }
  }
  return worst ?? 'NONE';
}

export function evaluateNewRiskIntroduced(risks: unknown): NewRiskIntroducedResult {
  const issues = new Set<NewRiskIntroducedIssue>();
  if (!Array.isArray(risks)) {
    issues.add('MALFORMED_INPUT');
    return withhold(issues);
  }

  const identities: RiskIdentity[] = [];
  const accepted: AcceptedRisk[] = [];
  for (const entry of risks) {
    if (!isRecord(entry)) {
      issues.add('MALFORMED_INPUT');
      continue;
    }
    const riskId = entry.riskId;
    const severity = entry.severity;
    const riskOk = nonEmptyString(riskId);
    const severityOk = isSeverity(severity);
    if (!riskOk) {
      issues.add('MALFORMED_RISK_ID');
    }
    if (!severityOk) {
      issues.add('MALFORMED_SEVERITY');
    }
    if (!riskOk || !severityOk) {
      continue;
    }
    const key = riskId;
    identities.push({ key, signature: severity });
    accepted.push({ key, severity });
  }

  const seen = new Map<string, string>();
  for (const identity of identities) {
    const previous = seen.get(identity.key);
    if (previous === undefined) {
      seen.set(identity.key, identity.signature);
    } else if (previous !== identity.signature) {
      issues.add('CONFLICTING_RISK');
    }
  }

  if (issues.size > 0) {
    return withhold(issues);
  }

  const unique: AcceptedRisk[] = [];
  const acceptedKeys = new Set<string>();
  for (const risk of accepted) {
    if (acceptedKeys.has(risk.key)) {
      continue;
    }
    acceptedKeys.add(risk.key);
    unique.push(risk);
  }

  return available(worstSeverity(unique));
}
