import {
  evaluateCriticalGates,
  type DomainFact,
  type GateResult,
  type GateState,
  type HardGateId,
  type ReadinessEvaluationInput,
} from './gates.js';

export const PRODUCTION_DOMAINS = [
  'PEOPLE',
  'LOCATION',
  'TIME_ENVIRONMENT',
  'EQUIPMENT',
  'DOCUMENTS_RIGHTS',
  'LOGISTICS',
] as const;

export type ProductionDomainId = (typeof PRODUCTION_DOMAINS)[number];

export interface DomainHealth {
  readonly domain: ProductionDomainId;
  readonly state: GateState;
  readonly reasons: readonly string[];
}

export interface DomainHealthResult {
  readonly domains: readonly DomainHealth[];
}

const DOMAIN_GATES: Readonly<Partial<Record<ProductionDomainId, HardGateId>>> = {
  PEOPLE: 'CRITICAL_TALENT',
  LOCATION: 'LOCATION_ACCESS',
  EQUIPMENT: 'CRITICAL_CAPTURE_KIT',
  DOCUMENTS_RIGHTS: 'RIGHTS',
  LOGISTICS: 'STUDIO_AVAILABILITY',
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

function gateById(gates: readonly GateResult[], id: string): GateResult | undefined {
  return gates.find((gate) => gate.id === id);
}

function combineHealth(states: readonly GateState[]): GateState {
  if (states.some((state) => state === 'FAILED')) {
    return 'FAILED';
  }
  if (states.some((state) => state === 'UNRESOLVED')) {
    return 'UNRESOLVED';
  }
  return 'PASSED';
}

function factsFor(facts: readonly DomainFact[], domain: ProductionDomainId): readonly DomainFact[] {
  return facts.filter((fact) => fact.domain === domain);
}

function evaluateOneDomain(
  domain: ProductionDomainId,
  gates: readonly GateResult[],
  facts: readonly DomainFact[],
): DomainHealth {
  const reasons: string[] = [];
  const states: GateState[] = [];
  const gateId = DOMAIN_GATES[domain];
  if (gateId !== undefined) {
    const gate = gateById(gates, gateId);
    if (gate !== undefined) {
      states.push(gate.state);
      reasons.push(...gate.reasons);
    }
  }
  const domainFacts = factsFor(facts, domain);
  if (domainFacts.length === 0 && gateId === undefined) {
    states.push('UNRESOLVED');
    reasons.push(`${domain}_FACT_MISSING`);
  }
  for (const fact of domainFacts) {
    states.push(fact.state);
    reasons.push(...fact.reasons);
  }
  if (states.length === 0) {
    states.push('UNRESOLVED');
    reasons.push(`${domain}_UNRESOLVED`);
  }
  return Object.freeze({
    domain,
    state: combineHealth(states),
    reasons: Object.freeze([...reasons].sort(compareOrdinal)),
  });
}

export function evaluateDomainHealth(input: ReadinessEvaluationInput): DomainHealthResult {
  const gates = evaluateCriticalGates(input).gates;
  const facts = input.domainFacts ?? [];
  return Object.freeze({
    domains: Object.freeze(
      PRODUCTION_DOMAINS.map((domain) => evaluateOneDomain(domain, gates, facts)),
    ),
  });
}
