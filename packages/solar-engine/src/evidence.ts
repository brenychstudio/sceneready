import { createEvidenceEnvelope, type EvidenceEnvelope } from '@sceneready/evidence';

export const SOLAR_ALGORITHM_VERSION = 'SR-SOLAR-v1';
export const SOLAR_LIBRARY_NAME = 'astronomy-engine';
export const SOLAR_LIBRARY_VERSION = '2.1.19';
export const SOLAR_LIBRARY_LICENSE = 'MIT';

export interface SolarEvidencePayload {
  readonly sunAzimuthDegrees: number;
  readonly sunElevationDegrees: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly libraryName: string;
  readonly libraryVersion: string;
  readonly libraryLicense: string;
}

export function createSolarEvidenceEnvelope(input: {
  readonly productionId: string;
  readonly evidenceId: string;
  readonly instant: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly sunAzimuthDegrees: number;
  readonly sunElevationDegrees: number;
}): EvidenceEnvelope<SolarEvidencePayload> {
  return createEvidenceEnvelope({
    evidenceId: input.evidenceId,
    productionId: input.productionId,
    kind: 'SOLAR',
    sourceType: 'SYSTEM_DERIVED',
    authorityClass: 'SYSTEM_DERIVED',
    trustState: 'LIVE',
    observedAt: input.instant,
    receivedAt: input.instant,
    algorithmVersion: SOLAR_ALGORITHM_VERSION,
    adapterVersion: `${SOLAR_LIBRARY_NAME}@${SOLAR_LIBRARY_VERSION}`,
    payload: {
      sunAzimuthDegrees: input.sunAzimuthDegrees,
      sunElevationDegrees: input.sunElevationDegrees,
      latitude: input.latitude,
      longitude: input.longitude,
      libraryName: SOLAR_LIBRARY_NAME,
      libraryVersion: SOLAR_LIBRARY_VERSION,
      libraryLicense: SOLAR_LIBRARY_LICENSE,
    },
  });
}
