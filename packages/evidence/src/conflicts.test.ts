import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EvidenceTrustState } from '@sceneready/domain';
import { SCENEREADY_POLICY_V1 } from '@sceneready/readiness-engine';

import {
  createEvidenceEnvelope,
  resolveEvidenceSet,
  type EvidenceAuthorityClass,
  type EvidenceKind,
  type ScopedEvidence,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const PRODUCTION_ID = 'BCN-DEMO-01';
const NOW_INSTANT = '2026-09-17T05:00:00Z';
const PERSON_SCOPE = 'PERSON:MODEL-01:AVAILABILITY';
const LOCATION_SCOPE = 'LOCATION:LOC-GOTHIC:ACCESS';
const DOCUMENT_SCOPE = 'DOCUMENT:MODEL-RELEASE:VALIDITY';
const EQUIPMENT_SCOPE = 'EQUIPMENT:CAM-A:OPERATIONAL_STATE';

interface MakeEvidenceInput {
  readonly evidenceId: string;
  readonly scope: string;
  readonly authorityClass: EvidenceAuthorityClass;
  readonly value: string;
  readonly observedAt?: string;
  readonly receivedAt?: string;
  readonly trustState?: EvidenceTrustState;
  readonly kind?: EvidenceKind;
}

function kindForScope(scope: string): EvidenceKind {
  if (scope.startsWith('PERSON:')) {
    return 'CREW_CONFIRMATION';
  }
  if (scope.startsWith('LOCATION:')) {
    return 'LOCATION_ACCESS';
  }
  if (scope.startsWith('DOCUMENT:')) {
    return 'DOCUMENT';
  }
  if (scope.startsWith('EQUIPMENT:')) {
    return 'EQUIPMENT_VERIFICATION';
  }
  return 'WEATHER';
}

function makeEvidence(input: MakeEvidenceInput): ScopedEvidence {
  const observedAt = input.observedAt ?? '2026-09-17T04:00:00Z';
  const envelope = createEvidenceEnvelope({
    evidenceId: input.evidenceId,
    productionId: PRODUCTION_ID,
    kind: input.kind ?? kindForScope(input.scope),
    sourceType: 'EXTERNAL_PROVIDER',
    authorityClass: input.authorityClass,
    trustState: input.trustState ?? 'LIVE',
    observedAt,
    receivedAt: input.receivedAt ?? '2026-09-17T04:01:00Z',
    payload: { value: input.value },
  });
  return {
    scope: input.scope,
    value: input.value,
    envelope,
  };
}

function resolve(evidence: readonly ScopedEvidence[]) {
  return resolveEvidenceSet(evidence, NOW_INSTANT, SCENEREADY_POLICY_V1);
}

function activeIds(evidence: readonly ScopedEvidence[]): string[] {
  return evidence.map((item) => item.envelope.evidenceId);
}

function supersededIds(evidence: readonly ScopedEvidence[]): string[] {
  return evidence.map((item) => item.envelope.evidenceId);
}

describe('evidence conflict resolution', () => {
  it('lets subject confirmation supersede an older recorded availability fact', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const recorded = makeEvidence({
      evidenceId: 'E-OLD',
      scope: PERSON_SCOPE,
      authorityClass: 'RECORDED_INTERNAL',
      observedAt: '2026-09-16T18:00:00Z',
      value: 'CONFIRMED_06_55',
    });
    const confirmed = makeEvidence({
      evidenceId: 'E-NEW',
      scope: PERSON_SCOPE,
      authorityClass: 'SUBJECT_CONFIRMATION',
      observedAt: '2026-09-17T04:30:00Z',
      value: 'CANNOT_ARRIVE_BEFORE_07_15',
    });

    const result = resolve([recorded, confirmed]);

    expect(result.active).toHaveLength(1);
    expect(result.active[0]?.envelope.evidenceId).toBe('E-NEW');
    expect(result.active[0]?.value).toBe('CANNOT_ARRIVE_BEFORE_07_15');
    expect(supersededIds(result.superseded)).toEqual(['E-OLD']);
    expect(result.conflicts).toEqual([]);
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('quarantines contradictory location access authorities', () => {
    const permit = makeEvidence({
      evidenceId: 'E-PERMIT',
      scope: LOCATION_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      value: 'VALID',
    });
    const lead = makeEvidence({
      evidenceId: 'E-LEAD',
      scope: LOCATION_SCOPE,
      authorityClass: 'PRODUCTION_LEAD_ASSERTION',
      value: 'REVOKED',
    });

    const result = resolve([permit, lead]);

    expect(result.active).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.scope).toBe(LOCATION_SCOPE);
    expect(result.conflicts[0]?.productionId).toBe(PRODUCTION_ID);
    expect(result.conflicts[0]?.status).toBe('UNRESOLVED');
    expect(result.conflicts[0]?.evidenceIds).toEqual(['E-LEAD', 'E-PERMIT']);
  });

  it('returns an identical result when the same input is reversed', () => {
    const recorded = makeEvidence({
      evidenceId: 'E-OLD',
      scope: PERSON_SCOPE,
      authorityClass: 'RECORDED_INTERNAL',
      observedAt: '2026-09-16T18:00:00Z',
      value: 'CONFIRMED_06_55',
    });
    const confirmed = makeEvidence({
      evidenceId: 'E-NEW',
      scope: PERSON_SCOPE,
      authorityClass: 'SUBJECT_CONFIRMATION',
      observedAt: '2026-09-17T04:30:00Z',
      value: 'CANNOT_ARRIVE_BEFORE_07_15',
    });
    const permit = makeEvidence({
      evidenceId: 'E-PERMIT',
      scope: LOCATION_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      value: 'VALID',
    });
    const lead = makeEvidence({
      evidenceId: 'E-LEAD',
      scope: LOCATION_SCOPE,
      authorityClass: 'PRODUCTION_LEAD_ASSERTION',
      value: 'REVOKED',
    });

    const forward = resolve([recorded, confirmed, permit, lead]);
    const reversed = resolve([lead, permit, confirmed, recorded]);

    expect(reversed).toEqual(forward);
  });

  it('keeps superseded evidence present after a legitimate update', () => {
    const older = makeEvidence({
      evidenceId: 'E-DOC-OLD',
      scope: DOCUMENT_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      observedAt: '2026-09-16T12:00:00Z',
      value: 'VALID',
    });
    const newer = makeEvidence({
      evidenceId: 'E-DOC-NEW',
      scope: DOCUMENT_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      observedAt: '2026-09-17T04:00:00Z',
      value: 'VALID',
    });

    const result = resolve([older, newer]);

    expect(activeIds(result.active)).toEqual(['E-DOC-NEW']);
    expect(result.superseded).toHaveLength(1);
    expect(result.superseded[0]?.envelope.evidenceId).toBe('E-DOC-OLD');
    expect(result.superseded[0]?.envelope).toBe(older.envelope);
    expect(result.conflicts).toEqual([]);
  });

  it('does not let stale evidence silently supersede fresh usable evidence', () => {
    const freshRecorded = makeEvidence({
      evidenceId: 'E-FRESH-RECORDED',
      scope: PERSON_SCOPE,
      authorityClass: 'RECORDED_INTERNAL',
      observedAt: '2026-09-17T04:40:00Z',
      value: 'CONFIRMED_06_55',
    });
    const staleConfirmation = makeEvidence({
      evidenceId: 'E-STALE-CONFIRMATION',
      scope: PERSON_SCOPE,
      authorityClass: 'SUBJECT_CONFIRMATION',
      observedAt: '2026-09-16T12:00:00Z',
      value: 'CANNOT_ARRIVE_BEFORE_07_15',
    });

    const result = resolve([staleConfirmation, freshRecorded]);

    expect(activeIds(result.active)).toEqual(['E-FRESH-RECORDED']);
    expect(result.active[0]?.value).toBe('CONFIRMED_06_55');
    expect(result.conflicts).toEqual([]);
  });

  it('does not promote MISSING evidence into active truth', () => {
    const missing = makeEvidence({
      evidenceId: 'E-MISSING',
      scope: EQUIPMENT_SCOPE,
      authorityClass: 'RECORDED_INTERNAL',
      trustState: 'MISSING',
      value: 'OPERATIONAL',
    });

    const result = resolve([missing]);

    expect(result.active).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('lets same-value newer legitimate evidence supersede without conflict', () => {
    const older = makeEvidence({
      evidenceId: 'E-EQ-OLD',
      scope: EQUIPMENT_SCOPE,
      authorityClass: 'RECORDED_INTERNAL',
      observedAt: '2026-09-16T18:00:00Z',
      value: 'OPERATIONAL',
    });
    const newer = makeEvidence({
      evidenceId: 'E-EQ-NEW',
      scope: EQUIPMENT_SCOPE,
      authorityClass: 'EXTERNAL_AUTHORITATIVE',
      observedAt: '2026-09-17T04:20:00Z',
      value: 'OPERATIONAL',
    });

    const result = resolve([newer, older]);

    expect(activeIds(result.active)).toEqual(['E-EQ-NEW']);
    expect(supersededIds(result.superseded)).toEqual(['E-EQ-OLD']);
    expect(result.conflicts).toEqual([]);
  });

  it('does not transform a human assertion into DOCUMENT_AUTHORITY', () => {
    const permit = makeEvidence({
      evidenceId: 'E-PERMIT',
      scope: LOCATION_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      value: 'VALID',
    });
    const lead = makeEvidence({
      evidenceId: 'E-LEAD',
      scope: LOCATION_SCOPE,
      authorityClass: 'PRODUCTION_LEAD_ASSERTION',
      value: 'REVOKED',
    });

    const result = resolve([lead, permit]);
    const involved = [permit, lead];

    expect(result.conflicts).toHaveLength(1);
    expect(result.active).toEqual([]);
    expect(lead.envelope.authorityClass).toBe('PRODUCTION_LEAD_ASSERTION');
    expect(involved.every((item) => item.envelope.authorityClass === resultSourceClass(item))).toBe(
      true,
    );
    expect(
      result.conflicts[0]?.evidenceIds.every((evidenceId) => {
        const source = involved.find((item) => item.envelope.evidenceId === evidenceId);
        return source?.envelope.authorityClass !== undefined;
      }),
    ).toBe(true);
    expect(permit.envelope.authorityClass).toBe('DOCUMENT_AUTHORITY');
    expect(lead.envelope.authorityClass).not.toBe('DOCUMENT_AUTHORITY');
  });

  it('assigns a deterministic conflict ID from production, scope, and evidence identity', () => {
    const permit = makeEvidence({
      evidenceId: 'E-PERMIT',
      scope: LOCATION_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      value: 'VALID',
    });
    const lead = makeEvidence({
      evidenceId: 'E-LEAD',
      scope: LOCATION_SCOPE,
      authorityClass: 'PRODUCTION_LEAD_ASSERTION',
      value: 'REVOKED',
    });

    const first = resolve([permit, lead]);
    const second = resolve([lead, permit]);

    expect(first.conflicts[0]?.conflictId).toEqual(second.conflicts[0]?.conflictId);
    expect(first.conflicts[0]?.conflictId).toMatch(/BCN-DEMO-01/);
    expect(first.conflicts[0]?.conflictId).toContain(LOCATION_SCOPE);
    expect(first.conflicts[0]?.conflictId).toContain('E-LEAD');
    expect(first.conflicts[0]?.conflictId).toContain('E-PERMIT');
    expect(first.conflicts[0]?.conflictId).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('resolves unrelated scopes independently', () => {
    const person = makeEvidence({
      evidenceId: 'E-PERSON',
      scope: PERSON_SCOPE,
      authorityClass: 'SUBJECT_CONFIRMATION',
      value: 'CONFIRMED_06_55',
    });
    const equipment = makeEvidence({
      evidenceId: 'E-EQ',
      scope: EQUIPMENT_SCOPE,
      authorityClass: 'EXTERNAL_AUTHORITATIVE',
      value: 'OPERATIONAL',
    });

    const result = resolve([equipment, person]);

    expect(activeIds(result.active).sort()).toEqual(['E-EQ', 'E-PERSON']);
    expect(result.conflicts).toEqual([]);
  });

  it('does not let a conflicted scope quarantine unrelated scopes', () => {
    const permit = makeEvidence({
      evidenceId: 'E-PERMIT',
      scope: LOCATION_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      value: 'VALID',
    });
    const lead = makeEvidence({
      evidenceId: 'E-LEAD',
      scope: LOCATION_SCOPE,
      authorityClass: 'PRODUCTION_LEAD_ASSERTION',
      value: 'REVOKED',
    });
    const person = makeEvidence({
      evidenceId: 'E-PERSON',
      scope: PERSON_SCOPE,
      authorityClass: 'SUBJECT_CONFIRMATION',
      value: 'CONFIRMED_06_55',
    });

    const result = resolve([permit, person, lead]);

    expect(activeIds(result.active)).toEqual(['E-PERSON']);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.scope).toBe(LOCATION_SCOPE);
  });

  it('sorts multiple conflicting evidence IDs deterministically', () => {
    const charlie = makeEvidence({
      evidenceId: 'E-C',
      scope: LOCATION_SCOPE,
      authorityClass: 'RECORDED_INTERNAL',
      value: 'RESTRICTED',
    });
    const alpha = makeEvidence({
      evidenceId: 'E-A',
      scope: LOCATION_SCOPE,
      authorityClass: 'DOCUMENT_AUTHORITY',
      value: 'VALID',
    });
    const bravo = makeEvidence({
      evidenceId: 'E-B',
      scope: LOCATION_SCOPE,
      authorityClass: 'PRODUCTION_LEAD_ASSERTION',
      value: 'REVOKED',
    });

    const result = resolve([charlie, alpha, bravo]);

    expect(result.active).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.evidenceIds).toEqual(['E-A', 'E-B', 'E-C']);
  });
});

function resultSourceClass(item: ScopedEvidence): EvidenceAuthorityClass {
  return item.envelope.authorityClass;
}
