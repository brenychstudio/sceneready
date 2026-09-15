import {
  evaluateCriticalGates,
  type GateResult,
  type GateState,
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

function gateById(gates: readonly GateResult[], id: string): GateResult | undefined {
  return gates.find((gate) => gate.id === id);
}

function domainFromGate(
  domain: ProductionDomainId,
  gate: GateResult | undefined,
  fallbackReason: string,
): DomainHealth {
  if (gate === undefined) {
    return Object.freeze({
      domain,
      state: 'UNRESOLVED',
      reasons: Object.freeze([fallbackReason]),
    });
  }
  return Object.freeze({
    domain,
    state: gate.state,
    reasons: Object.freeze([...gate.reasons]),
  });
}

export function evaluateDomainHealth(input: ReadinessEvaluationInput): DomainHealthResult {
  const gates = evaluateCriticalGates(input).gates;
  return Object.freeze({
    domains: Object.freeze([
      domainFromGate('PEOPLE', gateById(gates, 'CRITICAL_TALENT'), 'PEOPLE_UNRESOLVED'),
      domainFromGate('LOCATION', gateById(gates, 'LOCATION_ACCESS'), 'LOCATION_UNRESOLVED'),
      Object.freeze({
        domain: 'TIME_ENVIRONMENT',
        state: 'UNRESOLVED',
        reasons: Object.freeze(['TIME_ENVIRONMENT_NO_HARD_GATE']),
      }),
      domainFromGate('EQUIPMENT', gateById(gates, 'CRITICAL_CAPTURE_KIT'), 'EQUIPMENT_UNRESOLVED'),
      domainFromGate('DOCUMENTS_RIGHTS', gateById(gates, 'RIGHTS'), 'DOCUMENTS_RIGHTS_UNRESOLVED'),
      domainFromGate('LOGISTICS', gateById(gates, 'STUDIO_AVAILABILITY'), 'LOGISTICS_UNRESOLVED'),
    ]),
  });
}
