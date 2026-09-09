import { z } from 'zod';

export const ProductionDomainSchema = z.enum([
  'PEOPLE',
  'LOCATION',
  'TIME_ENVIRONMENT',
  'EQUIPMENT',
  'DOCUMENTS_RIGHTS',
  'LOGISTICS',
]);

export const EvidenceTrustStateSchema = z.enum([
  'LIVE',
  'CONFIRMED',
  'RECORDED',
  'FALLBACK',
  'STALE',
  'MISSING',
]);

export const RiskSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ProductionStatusSchema = z.enum(['READY', 'AT_RISK', 'BLOCKED']);

export const AssessmentCertificationSchema = z.enum(['CERTIFIED', 'DEGRADED', 'INSUFFICIENT']);

export type ProductionDomain = z.infer<typeof ProductionDomainSchema>;
export type EvidenceTrustState = z.infer<typeof EvidenceTrustStateSchema>;
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;
export type ProductionStatus = z.infer<typeof ProductionStatusSchema>;
export type AssessmentCertification = z.infer<typeof AssessmentCertificationSchema>;
