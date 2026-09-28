export type StructuredValue =
  string | number | boolean | null | readonly StructuredValue[] | StructuredRecord;

export interface StructuredRecord {
  readonly [key: string]: StructuredValue;
}

export interface AuthoritativeReadiness {
  readonly productionId: string;
  readonly facts: StructuredRecord;
}

export interface AuthoritativeChanges {
  readonly productionId: string;
  readonly changes: readonly StructuredRecord[];
}

export interface AuthoritativeExecutionStatus {
  readonly productionId: string;
  readonly facts: StructuredRecord;
}

export interface AuthoritativeRiskContext {
  readonly productionId: string;
  readonly riskId: string;
  readonly facts: StructuredRecord;
}

export interface AuthoritativeRecoveryContext {
  readonly productionId: string;
  readonly facts: StructuredRecord;
}

export interface RecoveryCompositionInput {
  readonly productionId: string;
  readonly objective: string;
  readonly recoveryContext: AuthoritativeRecoveryContext;
}

export function copyStructuredData<T>(value: T): T {
  return copyValue(value) as T;
}

function copyValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (const item of value) {
      if (typeof item === 'function') {
        continue;
      }
      copy.push(copyValue(item));
    }
    return copy;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'function') {
      continue;
    }
    copy[key] = copyValue(child);
  }
  return copy;
}
