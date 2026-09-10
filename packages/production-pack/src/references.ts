import type { ProductionPackValidationIssue } from './errors.js';
import type { ProductionPack } from './schema.js';

export interface PackReferenceIndex {
  readonly personIds: ReadonlySet<string>;
  readonly locationIds: ReadonlySet<string>;
  readonly activityIds: ReadonlySet<string>;
  readonly equipmentIds: ReadonlySet<string>;
  readonly documentIds: ReadonlySet<string>;
}

function pushUnknown(
  issues: ProductionPackValidationIssue[],
  code: ProductionPackValidationIssue['code'],
  path: string,
  id: string,
  kind: string,
): void {
  issues.push({
    code,
    path,
    message: `Unknown ${kind} reference '${id}'.`,
  });
}

export function indexPackReferences(pack: ProductionPack): PackReferenceIndex {
  return {
    personIds: new Set(pack.crew.map((person) => person.id)),
    locationIds: new Set(pack.locations.map((location) => location.id)),
    activityIds: new Set(pack.schedule.map((activity) => activity.id)),
    equipmentIds: new Set(pack.equipment.map((asset) => asset.id)),
    documentIds: new Set(pack.rights.map((document) => document.id)),
  };
}

export function collectDuplicateIdIssues(pack: ProductionPack): ProductionPackValidationIssue[] {
  const issues: ProductionPackValidationIssue[] = [];
  const seen = new Set<string>();

  const note = (id: string, path: string): void => {
    if (seen.has(id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        path,
        message: `Duplicate id '${id}'.`,
      });
      return;
    }
    seen.add(id);
  };

  note(pack.production.id, 'production.id');
  for (const [index, person] of pack.crew.entries()) {
    note(person.id, `crew.${index}.id`);
  }
  for (const [index, location] of pack.locations.entries()) {
    note(location.id, `locations.${index}.id`);
  }
  for (const [index, activity] of pack.schedule.entries()) {
    note(activity.id, `schedule.${index}.id`);
  }
  for (const [index, deliverable] of pack.deliverables.entries()) {
    note(deliverable.id, `deliverables.${index}.id`);
  }
  for (const [index, asset] of pack.equipment.entries()) {
    note(asset.id, `equipment.${index}.id`);
  }
  for (const [index, path] of pack.capturePaths.entries()) {
    note(path.id, `capturePaths.${index}.id`);
  }
  for (const [index, document] of pack.rights.entries()) {
    note(document.id, `rights.${index}.id`);
  }
  for (const [index, gate] of pack.hardGates.entries()) {
    note(gate.id, `hardGates.${index}.id`);
  }
  for (const [index, item] of pack.evidence.entries()) {
    note(item.id, `evidence.${index}.id`);
  }

  return issues;
}

export function collectUnknownReferenceIssues(
  pack: ProductionPack,
  index: PackReferenceIndex,
): ProductionPackValidationIssue[] {
  const issues: ProductionPackValidationIssue[] = [];

  for (const [activityIndex, activity] of pack.schedule.entries()) {
    if (!index.locationIds.has(activity.locationId)) {
      pushUnknown(
        issues,
        'UNKNOWN_LOCATION_REFERENCE',
        `schedule.${activityIndex}.locationId`,
        activity.locationId,
        'location',
      );
    }
    for (const [personIndex, personId] of activity.assignedPersonIds.entries()) {
      if (!index.personIds.has(personId)) {
        pushUnknown(
          issues,
          'UNKNOWN_PERSON_REFERENCE',
          `schedule.${activityIndex}.assignedPersonIds.${personIndex}`,
          personId,
          'person',
        );
      }
    }
    for (const [dependencyIndex, activityId] of activity.dependsOn.entries()) {
      if (!index.activityIds.has(activityId)) {
        pushUnknown(
          issues,
          'UNKNOWN_ACTIVITY_REFERENCE',
          `schedule.${activityIndex}.dependsOn.${dependencyIndex}`,
          activityId,
          'activity',
        );
      }
    }
    for (const [equipmentIndex, equipmentId] of activity.equipmentIds.entries()) {
      if (!index.equipmentIds.has(equipmentId)) {
        pushUnknown(
          issues,
          'UNKNOWN_EQUIPMENT_REFERENCE',
          `schedule.${activityIndex}.equipmentIds.${equipmentIndex}`,
          equipmentId,
          'equipment',
        );
      }
    }
    for (const [documentIndex, documentId] of activity.documentIds.entries()) {
      if (!index.documentIds.has(documentId)) {
        pushUnknown(
          issues,
          'UNKNOWN_DOCUMENT_REFERENCE',
          `schedule.${activityIndex}.documentIds.${documentIndex}`,
          documentId,
          'document',
        );
      }
    }
  }

  for (const [deliverableIndex, deliverable] of pack.deliverables.entries()) {
    for (const [activityIndex, activityId] of deliverable.requiredActivityIds.entries()) {
      if (!index.activityIds.has(activityId)) {
        pushUnknown(
          issues,
          'UNKNOWN_ACTIVITY_REFERENCE',
          `deliverables.${deliverableIndex}.requiredActivityIds.${activityIndex}`,
          activityId,
          'activity',
        );
      }
    }
    for (const [documentIndex, documentId] of deliverable.requiredDocumentIds.entries()) {
      if (!index.documentIds.has(documentId)) {
        pushUnknown(
          issues,
          'UNKNOWN_DOCUMENT_REFERENCE',
          `deliverables.${deliverableIndex}.requiredDocumentIds.${documentIndex}`,
          documentId,
          'document',
        );
      }
    }
  }

  for (const [pathIndex, capturePath] of pack.capturePaths.entries()) {
    for (const [equipmentIndex, equipmentId] of capturePath.primaryEquipmentIds.entries()) {
      if (!index.equipmentIds.has(equipmentId)) {
        pushUnknown(
          issues,
          'UNKNOWN_EQUIPMENT_REFERENCE',
          `capturePaths.${pathIndex}.primaryEquipmentIds.${equipmentIndex}`,
          equipmentId,
          'equipment',
        );
      }
    }
    for (const [equipmentIndex, equipmentId] of capturePath.backupEquipmentIds.entries()) {
      if (!index.equipmentIds.has(equipmentId)) {
        pushUnknown(
          issues,
          'UNKNOWN_EQUIPMENT_REFERENCE',
          `capturePaths.${pathIndex}.backupEquipmentIds.${equipmentIndex}`,
          equipmentId,
          'equipment',
        );
      }
    }
  }

  for (const [rightsIndex, document] of pack.rights.entries()) {
    for (const [locationIndex, locationId] of document.locationIds.entries()) {
      if (!index.locationIds.has(locationId)) {
        pushUnknown(
          issues,
          'UNKNOWN_LOCATION_REFERENCE',
          `rights.${rightsIndex}.locationIds.${locationIndex}`,
          locationId,
          'location',
        );
      }
    }
  }

  for (const [evidenceIndex, item] of pack.evidence.entries()) {
    for (const [documentIndex, documentId] of item.documentIds.entries()) {
      if (!index.documentIds.has(documentId)) {
        pushUnknown(
          issues,
          'UNKNOWN_DOCUMENT_REFERENCE',
          `evidence.${evidenceIndex}.documentIds.${documentIndex}`,
          documentId,
          'document',
        );
      }
    }
  }

  return issues;
}
