import { describe, expect, it } from 'vitest';

import { validateProductionPack } from './index.js';

type JsonObject = Record<string, unknown>;

function makeMinimalValidPack(): JsonObject {
  return {
    fixtureVersion: 'BCN-DEMO-v1',
    policyVersion: 'SR-POLICY-v1',
    syntheticDataDeclaration: true,
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
        critical: true,
      },
    ],
    locations: [
      {
        id: 'LOC-01',
        name: 'Studio North — synthetic',
        kind: 'STUDIO',
        coordinates: {
          latitude: 41.4034,
          longitude: 2.1986,
        },
        visualIntent: 'Controlled studio look',
        accessNotes: 'Synthetic studio access',
        environmentNotes: 'Indoor climate-controlled',
        logisticsNotes: 'Load-in via synthetic dock',
      },
    ],
    schedule: [
      {
        id: 'ACT-01',
        name: 'Synthetic activity',
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
        name: 'Synthetic stills',
        importance: 'CRITICAL',
        requiredActivityIds: ['ACT-01'],
        requiredDocumentIds: ['DOC-01'],
        requiredPersonIds: ['PERSON-01'],
        requiredLocationIds: ['LOC-01'],
        requiredEquipmentIds: ['EQ-PRIMARY-01'],
      },
    ],
    equipment: [
      {
        id: 'EQ-PRIMARY-01',
        name: 'Primary camera',
        category: 'BODY',
        operationalState: 'READY',
      },
      {
        id: 'EQ-BACKUP-01',
        name: 'Backup camera',
        category: 'BODY',
        operationalState: 'READY',
      },
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
        name: 'Model release',
        kind: 'MODEL_RELEASE',
        validFromDate: null,
        validThroughDate: null,
        personIds: ['PERSON-01'],
        locationIds: ['LOC-01'],
        coversDeliverableIds: ['DELIVERABLE-01'],
        usageScopes: ['PAID_CAMPAIGN'],
      },
    ],
    priorities: {
      profile: 'CREATIVE_FIRST',
      rankedObjectives: [
        'EXTERIOR_CREATIVE_INTENT',
        'DAYLIGHT',
        'STUDIO_COMPLETION',
        'DELAY_MINIMIZATION',
        'CREW_CONVENIENCE',
        'COST',
      ],
    },
    hardGates: [
      {
        id: 'LOCATION_ACCESS',
        subjectType: 'LOCATION',
        subjectIds: ['LOC-01'],
      },
      {
        id: 'CRITICAL_TALENT',
        subjectType: 'PERSON',
        subjectIds: ['PERSON-01'],
      },
      {
        id: 'RIGHTS',
        subjectType: 'DOCUMENT',
        subjectIds: ['DOC-01'],
      },
      {
        id: 'CRITICAL_CAPTURE_KIT',
        subjectType: 'EQUIPMENT_PATH',
        subjectIds: ['PATH-01'],
      },
      {
        id: 'STUDIO_AVAILABILITY',
        subjectType: 'LOCATION',
        subjectIds: ['LOC-01'],
      },
    ],
    evidence: [
      {
        id: 'EVD-01',
        kind: 'DOCUMENT',
        trustState: 'MISSING',
        subjectType: 'DOCUMENT',
        subjectId: 'DOC-01',
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
  it('accepts a canonical-shaped Task-5-ready minimal pack', () => {
    const result = validateProductionPack(makeMinimalValidPack());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.production.id).toBe('BCN-DEMO-01');
    expect(result.pack.policyVersion).toBe('SR-POLICY-v1');
    expect(result.pack.syntheticDataDeclaration).toBe(true);
    expect(result.pack.crew[0]?.critical).toBe(true);
    expect(result.pack.locations[0]?.kind).toBe('STUDIO');
    expect(result.pack.equipment[0]?.operationalState).toBe('READY');
    expect(result.pack.hardGates).toHaveLength(5);
  });

  it('retains syntheticDataDeclaration true on a valid pack', () => {
    const result = validateProductionPack(makeMinimalValidPack());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.syntheticDataDeclaration).toBe(true);
  });

  it('accepts a MODEL_RELEASE record with DOCUMENT evidence in MISSING trust state', () => {
    const result = validateProductionPack(makeMinimalValidPack());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.rights[0]?.kind).toBe('MODEL_RELEASE');
    expect(result.pack.evidence[0]).toEqual({
      id: 'EVD-01',
      kind: 'DOCUMENT',
      trustState: 'MISSING',
      subjectType: 'DOCUMENT',
      subjectId: 'DOC-01',
    });
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

  it('rejects unknown deliverable person, location, and equipment references', () => {
    const pack = makeMinimalValidPack();
    const deliverables = pack.deliverables as JsonObject[];
    deliverables[0]!.requiredPersonIds = ['PERSON-UNKNOWN'];
    deliverables[0]!.requiredLocationIds = ['LOC-UNKNOWN'];
    deliverables[0]!.requiredEquipmentIds = ['EQ-UNKNOWN'];

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('UNKNOWN_PERSON_REFERENCE');
    expect(codes).toContain('UNKNOWN_LOCATION_REFERENCE');
    expect(codes).toContain('UNKNOWN_EQUIPMENT_REFERENCE');
  });

  it('rejects an unknown hard-gate subject with the matching UNKNOWN_* code', () => {
    const locationGate = makeMinimalValidPack();
    const locationGates = locationGate.hardGates as JsonObject[];
    locationGates[0]!.subjectIds = ['LOC-UNKNOWN'];
    expect(issueCodes(locationGate)).toContain('UNKNOWN_LOCATION_REFERENCE');

    const talentGate = makeMinimalValidPack();
    const talentGates = talentGate.hardGates as JsonObject[];
    talentGates[1]!.subjectIds = ['PERSON-UNKNOWN'];
    expect(issueCodes(talentGate)).toContain('UNKNOWN_PERSON_REFERENCE');

    const rightsGate = makeMinimalValidPack();
    const rightsGates = rightsGate.hardGates as JsonObject[];
    rightsGates[2]!.subjectIds = ['DOC-UNKNOWN'];
    expect(issueCodes(rightsGate)).toContain('UNKNOWN_DOCUMENT_REFERENCE');

    const captureGate = makeMinimalValidPack();
    const captureGates = captureGate.hardGates as JsonObject[];
    captureGates[3]!.subjectIds = ['PATH-UNKNOWN'];
    expect(issueCodes(captureGate)).toContain('UNKNOWN_EQUIPMENT_REFERENCE');
  });

  it('rejects an unknown evidence subject with the matching UNKNOWN_* code', () => {
    const personEvidence = makeMinimalValidPack();
    const personItems = personEvidence.evidence as JsonObject[];
    personItems[0]!.subjectType = 'PERSON';
    personItems[0]!.subjectId = 'PERSON-UNKNOWN';
    expect(issueCodes(personEvidence)).toContain('UNKNOWN_PERSON_REFERENCE');

    const pathEvidence = makeMinimalValidPack();
    const pathItems = pathEvidence.evidence as JsonObject[];
    pathItems[0]!.subjectType = 'EQUIPMENT_PATH';
    pathItems[0]!.subjectId = 'PATH-UNKNOWN';
    expect(issueCodes(pathEvidence)).toContain('UNKNOWN_EQUIPMENT_REFERENCE');

    const activityEvidence = makeMinimalValidPack();
    const activityItems = activityEvidence.evidence as JsonObject[];
    activityItems[0]!.subjectType = 'ACTIVITY';
    activityItems[0]!.subjectId = 'ACT-UNKNOWN';
    expect(issueCodes(activityEvidence)).toContain('UNKNOWN_ACTIVITY_REFERENCE');
  });

  it('rejects duplicate entity ids', () => {
    const pack = makeMinimalValidPack();
    const crew = pack.crew as JsonObject[];
    crew.push({
      id: 'PERSON-01',
      role: 'PHOTOGRAPHER',
      name: 'Synthetic Photographer',
      critical: false,
    });

    expect(issueCodes(pack)).toContain('DUPLICATE_ID');
  });

  it('rejects a duplicate priority objective', () => {
    const pack = makeMinimalValidPack();
    const priorities = pack.priorities as JsonObject;
    priorities.rankedObjectives = [
      'EXTERIOR_CREATIVE_INTENT',
      'DAYLIGHT',
      'STUDIO_COMPLETION',
      'DELAY_MINIMIZATION',
      'CREW_CONVENIENCE',
      'EXTERIOR_CREATIVE_INTENT',
    ];

    expect(issueCodes(pack)).toEqual(['SCHEMA_INVALID']);
  });

  it('rejects a DEPENDENT activity with no dependency', () => {
    const pack = makeMinimalValidPack();
    const schedule = pack.schedule as JsonObject[];
    schedule[0]!.constraint = 'DEPENDENT';
    schedule[0]!.dependsOn = [];

    expect(issueCodes(pack)).toEqual(['SCHEMA_INVALID']);
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

  it('rejects a calendar-invalid date as schema-invalid rather than temporal ambiguity', () => {
    const pack = makeMinimalValidPack();
    (pack.production as JsonObject).date = '2026-02-30';

    const result = validateProductionPack(pack);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.map((issue) => issue.code)).toEqual(['SCHEMA_INVALID']);
    expect(result.issues.some((issue) => issue.code === 'TEMPORAL_AMBIGUITY')).toBe(false);
  });

  it('rejects a schedule that is not chronological by resolved instant', () => {
    const pack = makeMinimalValidPack();
    pack.schedule = [
      {
        id: 'ACT-01',
        name: 'Synthetic activity',
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
        name: 'Synthetic overlap',
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
        name: 'Synthetic setup',
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
        name: 'Synthetic shoot',
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
        name: 'Synthetic activity',
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
        name: 'Synthetic overlap',
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
      critical: false,
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
      critical: false,
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

  it('requires solarCreativeIntent on EXTERIOR locations and forbids it on STUDIO', () => {
    const missingExterior = makeMinimalValidPack();
    const missingLocations = missingExterior.locations as JsonObject[];
    missingLocations[0] = {
      ...missingLocations[0],
      kind: 'EXTERIOR',
    };
    expect(issueCodes(missingExterior)).toEqual(['SCHEMA_INVALID']);

    const studioEnvelope = makeMinimalValidPack();
    const studioLocations = studioEnvelope.locations as JsonObject[];
    studioLocations[0] = {
      ...studioLocations[0],
      solarCreativeIntent: {
        envelopeId: 'ENVELOPE-STUDIO',
        preferredLocalTimeStart: '10:45',
        preferredLocalTimeEnd: '16:30',
        acceptableLocalTimeStart: '10:25',
        acceptableLocalTimeEnd: '16:30',
        preferredAzimuthDegrees: { min: 0, max: 360 },
        acceptableAzimuthDegrees: { min: 0, max: 360 },
        preferredElevationDegrees: { min: 0, max: 90 },
        acceptableElevationDegrees: { min: 0, max: 90 },
        shadowIntent: 'Controlled continuous lighting',
        importance: 'CRITICAL',
      },
    };
    expect(issueCodes(studioEnvelope)).toEqual(['SCHEMA_INVALID']);
  });

  it('rejects unknown creative-intent envelope fields and unknown envelope references', () => {
    const extraField = makeMinimalValidPack();
    const extraLocations = extraField.locations as JsonObject[];
    extraLocations[0] = {
      ...extraLocations[0],
      kind: 'EXTERIOR',
      solarCreativeIntent: {
        envelopeId: 'ENVELOPE-GOTHIC-LOOK',
        preferredLocalTimeStart: '07:20',
        preferredLocalTimeEnd: '08:10',
        acceptableLocalTimeStart: '07:10',
        acceptableLocalTimeEnd: '08:30',
        preferredAzimuthDegrees: { min: 70, max: 120 },
        acceptableAzimuthDegrees: { min: 50, max: 150 },
        preferredElevationDegrees: { min: -1, max: 18 },
        acceptableElevationDegrees: { min: -2, max: 28 },
        shadowIntent: 'Narrow-street shadow geometry',
        importance: 'CRITICAL',
        hiddenDefault: true,
      },
    };
    expect(issueCodes(extraField)).toEqual(['SCHEMA_INVALID']);

    const unknownEnvelope = makeMinimalValidPack();
    const unknownLocations = unknownEnvelope.locations as JsonObject[];
    unknownLocations[0] = {
      ...unknownLocations[0],
      kind: 'EXTERIOR',
      solarCreativeIntent: {
        envelopeId: 'ENVELOPE-GOTHIC-LOOK',
        preferredLocalTimeStart: '07:20',
        preferredLocalTimeEnd: '08:10',
        acceptableLocalTimeStart: '07:10',
        acceptableLocalTimeEnd: '08:30',
        preferredAzimuthDegrees: { min: 70, max: 120 },
        acceptableAzimuthDegrees: { min: 50, max: 150 },
        preferredElevationDegrees: { min: -1, max: 18 },
        acceptableElevationDegrees: { min: -2, max: 28 },
        shadowIntent: 'Narrow-street shadow geometry',
        importance: 'CRITICAL',
      },
    };
    const unknownDeliverables = unknownEnvelope.deliverables as JsonObject[];
    unknownDeliverables[0] = {
      ...unknownDeliverables[0],
      requiredLocationIds: ['LOC-01'],
      creativeIntentEnvelopeId: 'ENVELOPE-DOES-NOT-EXIST',
    };
    expect(issueCodes(unknownEnvelope)).toEqual(['SCHEMA_INVALID']);
  });
});
