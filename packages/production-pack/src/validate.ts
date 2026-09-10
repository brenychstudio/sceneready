import { resolveZonedProductionTime } from '@sceneready/domain';

import {
  sortProductionPackIssues,
  type ProductionPackValidationIssue,
  type ProductionPackValidationResult,
} from './errors.js';
import {
  collectDuplicateIdIssues,
  collectUnknownReferenceIssues,
  indexPackReferences,
} from './references.js';
import { ProductionPackSchema, type ProductionPack } from './schema.js';

const SUPPORTED_POLICY_VERSION = 'SR-POLICY-v1';

function resolveInstant(
  date: string,
  time: string,
  timeZone: string,
  path: string,
  issues: ProductionPackValidationIssue[],
): string | null {
  try {
    return resolveZonedProductionTime({ date, time, timeZone }).instant;
  } catch {
    issues.push({
      code: 'TEMPORAL_AMBIGUITY',
      path,
      message: `Local timestamp '${date} ${time}' is ambiguous or nonexistent in ${timeZone}.`,
    });
    return null;
  }
}

function collectTemporalAndOrderIssues(pack: ProductionPack): ProductionPackValidationIssue[] {
  const issues: ProductionPackValidationIssue[] = [];
  const starts = new Map<string, string>();
  const ends = new Map<string, string>();

  for (const [index, activity] of pack.schedule.entries()) {
    const start = resolveInstant(
      pack.production.date,
      activity.startLocal,
      pack.production.timeZone,
      `schedule.${index}.startLocal`,
      issues,
    );
    const end = resolveInstant(
      pack.production.date,
      activity.endLocal,
      pack.production.timeZone,
      `schedule.${index}.endLocal`,
      issues,
    );
    if (start !== null) {
      starts.set(activity.id, start);
    }
    if (end !== null) {
      ends.set(activity.id, end);
    }
    if (start !== null && end !== null && start > end) {
      issues.push({
        code: 'INVALID_ACTIVITY_ORDER',
        path: `schedule.${index}.endLocal`,
        message: `Activity '${activity.id}' ends before it starts.`,
      });
    }
  }

  for (let index = 1; index < pack.schedule.length; index += 1) {
    const current = pack.schedule[index];
    const previous = pack.schedule[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    const currentStart = starts.get(current.id);
    const previousStart = starts.get(previous.id);
    if (currentStart === undefined || previousStart === undefined) {
      continue;
    }
    if (currentStart < previousStart) {
      issues.push({
        code: 'INVALID_ACTIVITY_ORDER',
        path: `schedule.${index}.startLocal`,
        message: `Activity '${current.id}' starts before previous activity '${previous.id}'.`,
      });
    }
  }

  for (const [index, activity] of pack.schedule.entries()) {
    const start = starts.get(activity.id);
    if (start === undefined) {
      continue;
    }
    for (const [dependencyIndex, dependencyId] of activity.dependsOn.entries()) {
      const predecessorEnd = ends.get(dependencyId);
      if (predecessorEnd === undefined) {
        continue;
      }
      if (predecessorEnd > start) {
        issues.push({
          code: 'INVALID_ACTIVITY_ORDER',
          path: `schedule.${index}.dependsOn.${dependencyIndex}`,
          message: `Activity '${activity.id}' starts before dependency '${dependencyId}' completes.`,
        });
      }
    }
  }

  return issues;
}

function collectPolicyIssues(pack: ProductionPack): ProductionPackValidationIssue[] {
  if (pack.policyVersion === SUPPORTED_POLICY_VERSION) {
    return [];
  }
  return [
    {
      code: 'UNSUPPORTED_POLICY_VERSION',
      path: 'policyVersion',
      message: `Unsupported policy version '${pack.policyVersion}'.`,
    },
  ];
}

function validateCrossReferencesAndTime(pack: ProductionPack): ProductionPackValidationIssue[] {
  const index = indexPackReferences(pack);
  return [
    ...collectUnknownReferenceIssues(pack, index),
    ...collectTemporalAndOrderIssues(pack),
    ...collectDuplicateIdIssues(pack),
    ...collectPolicyIssues(pack),
  ];
}

export function validateProductionPack(input: unknown): ProductionPackValidationResult {
  const parsed = ProductionPackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: sortProductionPackIssues(
        parsed.error.issues.map((issue) => ({
          code: 'SCHEMA_INVALID',
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      ),
    };
  }

  const issues = sortProductionPackIssues(validateCrossReferencesAndTime(parsed.data));
  return issues.length === 0 ? { ok: true, pack: parsed.data } : { ok: false, issues };
}
