export const CRITICAL_CAPTURE_CATEGORIES = ['BODY', 'LENS', 'MEDIA', 'POWER'] as const;

export type EquipmentOperationalState = 'READY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';

export interface EquipmentFact {
  readonly id: string;
  readonly category:
    (typeof CRITICAL_CAPTURE_CATEGORIES)[number] | 'LIGHTING' | 'TETHERING' | 'MOTION' | 'OTHER';
  readonly operationalState: EquipmentOperationalState;
}

export interface CapturePathFact {
  readonly id: string;
  readonly primaryEquipmentIds: readonly string[];
  readonly backupEquipmentIds: readonly string[];
}

export type PathReadiness = 'READY' | 'FAILED' | 'UNRESOLVED' | 'INCOMPLETE';

function assetById(
  equipment: readonly EquipmentFact[],
  equipmentId: string,
): EquipmentFact | undefined {
  return equipment.find((asset) => asset.id === equipmentId);
}

export function evaluateEquipmentList(
  equipmentIds: readonly string[],
  equipment: readonly EquipmentFact[],
): PathReadiness {
  const assets: EquipmentFact[] = [];
  for (const equipmentId of equipmentIds) {
    const asset = assetById(equipment, equipmentId);
    if (asset === undefined) {
      return 'UNRESOLVED';
    }
    assets.push(asset);
  }

  for (const category of CRITICAL_CAPTURE_CATEGORIES) {
    const inCategory = assets.filter((asset) => asset.category === category);
    if (inCategory.length === 0) {
      return 'INCOMPLETE';
    }
    if (inCategory.some((asset) => asset.operationalState === 'READY')) {
      continue;
    }
    if (inCategory.some((asset) => asset.operationalState === 'UNKNOWN')) {
      return 'UNRESOLVED';
    }
    return 'FAILED';
  }

  return 'READY';
}

export function evaluateApprovedCapturePath(
  path: CapturePathFact,
  equipment: readonly EquipmentFact[],
): PathReadiness {
  const primary = evaluateEquipmentList(path.primaryEquipmentIds, equipment);
  const backup = evaluateEquipmentList(path.backupEquipmentIds, equipment);
  if (primary === 'READY' || backup === 'READY') {
    return 'READY';
  }
  if (primary === 'UNRESOLVED' || backup === 'UNRESOLVED') {
    return 'UNRESOLVED';
  }
  return 'FAILED';
}
