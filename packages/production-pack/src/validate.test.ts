import { describe, expect, it } from 'vitest';

import { validateProductionPack } from './index.js';

type JsonObject = Record<string, unknown>;

function makeMinimalValidPack(): JsonObject {
  return {
    fixtureVersion: 'BCN-DEMO-v1',
    policyVersion: 'SR-POLICY-v1',
    production: {
      id: 'BCN-DEMO-01',
      campaignName: 'Minimal production',
      date: '2026-09-17',
      timeZone: 'Europe/Madrid',
    },
    crew: [
      {
        id: 'PERSON-01',
        role: 'PRODUCTION_LEAD',
        name: 'Synthetic Lead',
      },
    ],
    locations: [
      {
        id: 'LOC-01',
        name: 'Studio North — synthetic',
        coordinates: {
          latitude: 41.4034,
          longitude: 2.1986,
        },
      },
    ],
    schedule: [
      {
        id: 'ACT-01',
        startLocal: '09:00',
        endLocal: '10:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: [],
        constraint: 'FIXED',
        equipmentIds: ['EQ-PRIMARY-01'],
        documentIds: ['DOC-01'],
      },
    ],
    deliverables: [
      {
        id: 'DELIVERABLE-01',
        importance: 'CRITICAL',
        requiredActivityIds: ['ACT-01'],
        requiredDocumentIds: ['DOC-01'],
      },
    ],
    equipment: [
      { id: 'EQ-PRIMARY-01', name: 'Primary camera' },
      { id: 'EQ-BACKUP-01', name: 'Backup camera' },
    ],
    capturePaths: [
      {
        id: 'PATH-01',
        primaryEquipmentIds: ['EQ-PRIMARY-01'],
        backupEquipmentIds: ['EQ-BACKUP-01'],
      },
    ],
    rights: [
      {
        id: 'DOC-01',
        coversDeliverableIds: ['DELIVERABLE-01'],
        locationIds: ['LOC-01'],
      },
    ],
    priorities: {
      profile: 'CREATIVE_FIRST',
      rankedObjectives: [
        'PRESERVE_EXTERIOR_INTENT',
        'PRESERVE_STUDIO',
        'MINIMIZE_DELAY',
        'CREW_CONVENIENCE',
        'MINIMIZE_COST',
      ],
    },
    hardGates: [
      {
        id: 'LOCATION_ACCESS',
        evidenceIds: ['EVD-01'],
      },
    ],
    evidence: [
      {
        id: 'EVD-01',
        documentIds: ['DOC-01'],
      },
    ],
  };
}

function issueCodes(input: unknown): readonly string[] {
  const result = validateProductionPack(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    return [];
  }
  return result.issues.map((issue) => issue.code);
}

describe('Production Pack validation', () => {
  it('accepts a minimal valid pack', () => {
    const result = validateProductionPack(makeMinimalValidPack());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.production.id).toBe('BCN-DEMO-01');
    expect(result.pack.policyVersion).toBe('SR-POLICY-v1');
  });

  it('rejects a deliverable that references an unknown activity', () => {
    const pack = makeMinimalValidPack();
    const deliverables = pack.deliverables as JsonObject[];
    deliverables[0]!.requiredActivityIds = ['ACT-UNKNOWN'];

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.code).toBe('UNKNOWN_ACTIVITY_REFERENCE');
  });

  it('rejects unknown person, location, equipment, and document references', () => {
    const pack = makeMinimalValidPack();
    const schedule = pack.schedule as JsonObject[];
    schedule[0]!.assignedPersonIds = ['PERSON-UNKNOWN'];
    schedule[0]!.locationId = 'LOC-UNKNOWN';
    schedule[0]!.documentIds = ['DOC-UNKNOWN'];
    const capturePaths = pack.capturePaths as JsonObject[];
    capturePaths[0]!.primaryEquipmentIds = ['EQ-UNKNOWN'];

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('UNKNOWN_PERSON_REFERENCE');
    expect(codes).toContain('UNKNOWN_LOCATION_REFERENCE');
    expect(codes).toContain('UNKNOWN_EQUIPMENT_REFERENCE');
    expect(codes).toContain('UNKNOWN_DOCUMENT_REFERENCE');
  });

  it('rejects duplicate entity ids', () => {
    const pack = makeMinimalValidPack();
    const crew = pack.crew as JsonObject[];
    crew.push({
      id: 'PERSON-01',
      role: 'PHOTOGRAPHER',
      name: 'Synthetic Photographer',
    });

    expect(issueCodes(pack)).toContain('DUPLICATE_ID');
  });

  it('types SR-POLICY-v2 as unsupported rather than schema-invalid', () => {
    const pack = makeMinimalValidPack();
    pack.policyVersion = 'SR-POLICY-v2';

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.map((issue) => issue.code)).toEqual(['UNSUPPORTED_POLICY_VERSION']);
    expect(result.issues.some((issue) => issue.code === 'SCHEMA_INVALID')).toBe(false);
  });

  it('rejects the Barcelona fall-back ambiguous local timestamp', () => {
    const pack = makeMinimalValidPack();
    const production = pack.production as JsonObject;
    production.date = '2026-10-25';
    const schedule = pack.schedule as JsonObject[];
    schedule[0]!.startLocal = '02:30';

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'TEMPORAL_AMBIGUITY')).toBe(true);
  });

  it('rejects a schedule that is not chronological by resolved instant', () => {
    const pack = makeMinimalValidPack();
    pack.schedule = [
      {
        id: 'ACT-01',
        startLocal: '11:00',
        endLocal: '12:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: [],
        constraint: 'FIXED',
        equipmentIds: ['EQ-PRIMARY-01'],
        documentIds: ['DOC-01'],
      },
      {
        id: 'ACT-02',
        startLocal: '09:00',
        endLocal: '10:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: [],
        constraint: 'FLEXIBLE',
        equipmentIds: ['EQ-BACKUP-01'],
        documentIds: ['DOC-01'],
      },
    ];

    expect(issueCodes(pack)).toContain('INVALID_ACTIVITY_ORDER');
  });

  it('rejects a dependency whose completion is after the dependent start', () => {
    const pack = makeMinimalValidPack();
    pack.schedule = [
      {
        id: 'ACT-SETUP',
        startLocal: '09:00',
        endLocal: '11:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: [],
        constraint: 'FIXED',
        equipmentIds: ['EQ-PRIMARY-01'],
        documentIds: ['DOC-01'],
      },
      {
        id: 'ACT-SHOOT',
        startLocal: '10:00',
        endLocal: '12:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: ['ACT-SETUP'],
        constraint: 'DEPENDENT',
        equipmentIds: ['EQ-BACKUP-01'],
        documentIds: ['DOC-01'],
      },
    ];

    expect(issueCodes(pack)).toContain('INVALID_ACTIVITY_ORDER');
  });

  it('allows overlapping activities when no explicit dependency exists', () => {
    const pack = makeMinimalValidPack();
    pack.schedule = [
      {
        id: 'ACT-01',
        startLocal: '09:00',
        endLocal: '11:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: [],
        constraint: 'FIXED',
        equipmentIds: ['EQ-PRIMARY-01'],
        documentIds: ['DOC-01'],
      },
      {
        id: 'ACT-02',
        startLocal: '10:00',
        endLocal: '12:00',
        locationId: 'LOC-01',
        assignedPersonIds: ['PERSON-01'],
        dependsOn: [],
        constraint: 'FLEXIBLE',
        equipmentIds: ['EQ-BACKUP-01'],
        documentIds: ['DOC-01'],
      },
    ];

    expect(validateProductionPack(pack).ok).toBe(true);
  });

  it('rejects unknown top-level and nested fields as schema-invalid', () => {
    const extraTopLevel = makeMinimalValidPack();
    extraTopLevel.hiddenDefault = 1;
    expect(issueCodes(extraTopLevel)).toEqual(['SCHEMA_INVALID']);

    const extraNested = makeMinimalValidPack();
    const production = extraNested.production as JsonObject;
    production.hiddenDefault = 1;
    expect(issueCodes(extraNested)).toEqual(['SCHEMA_INVALID']);
  });

  it('returns all bounded semantic issues together', () => {
    const pack = makeMinimalValidPack();
    pack.policyVersion = 'SR-POLICY-v2';
    const crew = pack.crew as JsonObject[];
    crew.push({
      id: 'PERSON-01',
      role: 'PHOTOGRAPHER',
      name: 'Synthetic Photographer',
    });
    const deliverables = pack.deliverables as JsonObject[];
    deliverables[0]!.requiredActivityIds = ['ACT-UNKNOWN'];
    const schedule = pack.schedule as JsonObject[];
    schedule[0]!.assignedPersonIds = ['PERSON-UNKNOWN'];

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('UNKNOWN_ACTIVITY_REFERENCE');
    expect(codes).toContain('UNKNOWN_PERSON_REFERENCE');
    expect(codes).toContain('DUPLICATE_ID');
    expect(codes).toContain('UNSUPPORTED_POLICY_VERSION');
    expect(codes).not.toContain('SCHEMA_INVALID');
  });

  it('orders issues by code priority, then path, then message', () => {
    const pack = makeMinimalValidPack();
    pack.policyVersion = 'SR-POLICY-v2';
    const crew = pack.crew as JsonObject[];
    crew.push({
      id: 'PERSON-01',
      role: 'PHOTOGRAPHER',
      name: 'Synthetic Photographer',
    });
    const deliverables = pack.deliverables as JsonObject[];
    deliverables[0]!.requiredActivityIds = ['ACT-UNKNOWN'];
    const schedule = pack.schedule as JsonObject[];
    schedule[0]!.assignedPersonIds = ['PERSON-UNKNOWN'];

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const codes = result.issues.map((issue) => issue.code);
    const expectedOrder = [
      'UNKNOWN_ACTIVITY_REFERENCE',
      'UNKNOWN_PERSON_REFERENCE',
      'DUPLICATE_ID',
      'UNSUPPORTED_POLICY_VERSION',
    ] as const;
    expect(codes).toEqual([...expectedOrder]);

    const sorted = [...result.issues].sort((left, right) => {
      const rank = [
        'SCHEMA_INVALID',
        'UNKNOWN_ACTIVITY_REFERENCE',
        'UNKNOWN_PERSON_REFERENCE',
        'UNKNOWN_LOCATION_REFERENCE',
        'UNKNOWN_EQUIPMENT_REFERENCE',
        'UNKNOWN_DOCUMENT_REFERENCE',
        'TEMPORAL_AMBIGUITY',
        'INVALID_ACTIVITY_ORDER',
        'DUPLICATE_ID',
        'UNSUPPORTED_POLICY_VERSION',
      ] as const;
      const codeDelta = rank.indexOf(left.code) - rank.indexOf(right.code);
      if (codeDelta !== 0) {
        return codeDelta;
      }
      const pathDelta = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
      if (pathDelta !== 0) {
        return pathDelta;
      }
      return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
    });
    expect(result.issues).toEqual(sorted);
  });

  it('accepts valid PRIMARY and BACKUP equipment references', () => {
    const result = validateProductionPack(makeMinimalValidPack());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.capturePaths[0]?.primaryEquipmentIds).toEqual(['EQ-PRIMARY-01']);
    expect(result.pack.capturePaths[0]?.backupEquipmentIds).toEqual(['EQ-BACKUP-01']);
  });

  it('rejects malformed date and time as schema-invalid', () => {
    const badDate = makeMinimalValidPack();
    (badDate.production as JsonObject).date = '2026-9-17';
    expect(issueCodes(badDate)).toEqual(['SCHEMA_INVALID']);

    const badTime = makeMinimalValidPack();
    (badTime.schedule as JsonObject[])[0]!.startLocal = '9:00';
    expect(issueCodes(badTime)).toEqual(['SCHEMA_INVALID']);

    const secondsTime = makeMinimalValidPack();
    (secondsTime.schedule as JsonObject[])[0]!.endLocal = '10:00:00';
    expect(issueCodes(secondsTime)).toEqual(['SCHEMA_INVALID']);
  });
});
