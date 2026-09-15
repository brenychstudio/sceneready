export interface RightsDocumentFact {
  readonly id: string;
  readonly kind: string;
  readonly validFromDate: string | null;
  readonly validThroughDate: string | null;
  readonly personIds: readonly string[];
  readonly locationIds: readonly string[];
  readonly coversDeliverableIds: readonly string[];
  readonly usageScopes: readonly string[];
}

export interface RightsEvaluationInput {
  readonly document: RightsDocumentFact;
  readonly intendedUsageScope: string;
  readonly intendedDeliverableId: string;
  readonly productionDate: string;
  readonly requiredPersonIds: readonly string[];
  readonly requiredLocationIds: readonly string[];
}

export function dateWithinBounds(
  productionDate: string,
  validFromDate: string | null,
  validThroughDate: string | null,
): boolean {
  if (validFromDate !== null && productionDate < validFromDate) {
    return false;
  }
  if (validThroughDate !== null && productionDate > validThroughDate) {
    return false;
  }
  return true;
}

export function evaluateRightsCoverage(input: RightsEvaluationInput): {
  readonly covered: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (!input.document.usageScopes.includes(input.intendedUsageScope)) {
    reasons.push('USAGE_SCOPE_MISMATCH');
  }
  if (!input.document.coversDeliverableIds.includes(input.intendedDeliverableId)) {
    reasons.push('DELIVERABLE_COVERAGE_MISMATCH');
  }
  if (
    !dateWithinBounds(
      input.productionDate,
      input.document.validFromDate,
      input.document.validThroughDate,
    )
  ) {
    reasons.push('VALIDITY_OUTSIDE_BOUNDS');
  }
  if (
    input.document.personIds.length > 0 &&
    input.requiredPersonIds.some((personId) => !input.document.personIds.includes(personId))
  ) {
    reasons.push('PERSON_SCOPE_MISMATCH');
  }
  if (
    input.document.locationIds.length > 0 &&
    input.requiredLocationIds.some((locationId) => !input.document.locationIds.includes(locationId))
  ) {
    reasons.push('LOCATION_SCOPE_MISMATCH');
  }
  return {
    covered: reasons.length === 0,
    reasons,
  };
}
