import { describe, expect, it } from 'vitest';

import {
  AssessmentCertificationSchema,
  EvidenceTrustStateSchema,
  ProductionDomainSchema,
  ProductionStatusSchema,
  RiskSeveritySchema,
} from './enums.js';
import { ProductionIdSchema } from './ids.js';
import { err, ok } from './result.js';

describe('ProductionIdSchema', () => {
  it('accepts the canonical Barcelona demo production id', () => {
    expect(ProductionIdSchema.parse('BCN-DEMO-01')).toBe('BCN-DEMO-01');
  });

  it('rejects empty, whitespace, lowercase, and malformed ids', () => {
    expect(ProductionIdSchema.safeParse('').success).toBe(false);
    expect(ProductionIdSchema.safeParse('   ').success).toBe(false);
    expect(ProductionIdSchema.safeParse('bcn-demo-01').success).toBe(false);
    expect(ProductionIdSchema.safeParse('BC').success).toBe(false);
    expect(ProductionIdSchema.safeParse('-BCN-DEMO-01').success).toBe(false);
    expect(ProductionIdSchema.safeParse('BCN_DEMO_01').success).toBe(false);
    expect(ProductionIdSchema.safeParse('BCN DEMO 01').success).toBe(false);
  });
});

describe('ProductionDomainSchema', () => {
  it('accepts the six canonical production domains', () => {
    expect(ProductionDomainSchema.parse('TIME_ENVIRONMENT')).toBe('TIME_ENVIRONMENT');
    expect(ProductionDomainSchema.parse('PEOPLE')).toBe('PEOPLE');
    expect(ProductionDomainSchema.parse('LOCATION')).toBe('LOCATION');
    expect(ProductionDomainSchema.parse('EQUIPMENT')).toBe('EQUIPMENT');
    expect(ProductionDomainSchema.parse('DOCUMENTS_RIGHTS')).toBe('DOCUMENTS_RIGHTS');
    expect(ProductionDomainSchema.parse('LOGISTICS')).toBe('LOGISTICS');
  });

  it('rejects invented and lowercase domain values', () => {
    expect(ProductionDomainSchema.safeParse('CREATIVE').success).toBe(false);
    expect(ProductionDomainSchema.safeParse('time_environment').success).toBe(false);
  });
});

describe('EvidenceTrustStateSchema', () => {
  it('accepts the six canonical evidence trust states', () => {
    expect(EvidenceTrustStateSchema.parse('LIVE')).toBe('LIVE');
    expect(EvidenceTrustStateSchema.parse('CONFIRMED')).toBe('CONFIRMED');
    expect(EvidenceTrustStateSchema.parse('RECORDED')).toBe('RECORDED');
    expect(EvidenceTrustStateSchema.parse('FALLBACK')).toBe('FALLBACK');
    expect(EvidenceTrustStateSchema.parse('STALE')).toBe('STALE');
    expect(EvidenceTrustStateSchema.parse('MISSING')).toBe('MISSING');
  });

  it('rejects VERIFIED and lowercase variants', () => {
    expect(EvidenceTrustStateSchema.safeParse('VERIFIED').success).toBe(false);
    expect(EvidenceTrustStateSchema.safeParse('live').success).toBe(false);
  });
});

describe('risk severity vs production status', () => {
  it('keeps CRITICAL on RiskSeverity and rejects it as ProductionStatus', () => {
    expect(RiskSeveritySchema.parse('CRITICAL')).toBe('CRITICAL');
    expect(ProductionStatusSchema.safeParse('CRITICAL').success).toBe(false);
  });

  it('keeps BLOCKED on ProductionStatus and rejects it as RiskSeverity', () => {
    expect(ProductionStatusSchema.parse('BLOCKED')).toBe('BLOCKED');
    expect(RiskSeveritySchema.safeParse('BLOCKED').success).toBe(false);
  });

  it('accepts the remaining closed severity and status values', () => {
    expect(RiskSeveritySchema.parse('LOW')).toBe('LOW');
    expect(RiskSeveritySchema.parse('MEDIUM')).toBe('MEDIUM');
    expect(RiskSeveritySchema.parse('HIGH')).toBe('HIGH');
    expect(ProductionStatusSchema.parse('READY')).toBe('READY');
    expect(ProductionStatusSchema.parse('AT_RISK')).toBe('AT_RISK');
  });
});

describe('AssessmentCertificationSchema', () => {
  it('accepts CERTIFIED, DEGRADED, and INSUFFICIENT', () => {
    expect(AssessmentCertificationSchema.parse('CERTIFIED')).toBe('CERTIFIED');
    expect(AssessmentCertificationSchema.parse('DEGRADED')).toBe('DEGRADED');
    expect(AssessmentCertificationSchema.parse('INSUFFICIENT')).toBe('INSUFFICIENT');
  });

  it('rejects invented certification values', () => {
    expect(AssessmentCertificationSchema.safeParse('READY').success).toBe(false);
    expect(AssessmentCertificationSchema.safeParse('certified').success).toBe(false);
  });
});

describe('Result', () => {
  it('represents success and failure without throwing', () => {
    expect(ok('BCN-DEMO-01')).toEqual({ ok: true, value: 'BCN-DEMO-01' });
    expect(err('malformed-id')).toEqual({ ok: false, error: 'malformed-id' });
  });
});
