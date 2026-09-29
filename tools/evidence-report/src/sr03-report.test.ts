import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  generateSr03EvidenceReport,
  serializeSr03EvidenceReport,
  sha256Sr03EvidenceReport,
} from './sr03-report.js';

describe('sr03 evidence report', () => {
  it('serializes two generations as the same bytes and sha256', async () => {
    const first = await serializeSr03EvidenceReport(await generateSr03EvidenceReport());
    const second = await serializeSr03EvidenceReport(await generateSr03EvidenceReport());
    expect(first).toBe(second);
    expect(sha256Sr03EvidenceReport(first)).toBe(
      createHash('sha256').update(second, 'utf8').digest('hex'),
    );
    expect(first).not.toMatch(/"timestamp"/);
    expect(first).not.toMatch(/Date\.now/);
    const parsed = JSON.parse(first) as {
      schemaVersion: string;
      fixtureVersion: string;
      graphSchemaVersion: string;
      policyVersion: string;
      scoringVersion: string;
      producers: {
        creativePreservation: string;
        scheduleStability: string;
        logisticsImpact: string;
        crewDisruption: string;
        newRiskIntroduced: string;
      };
    };
    expect(parsed.schemaVersion).toBe('SR-03-EVIDENCE-REPORT-v1');
    expect(parsed.fixtureVersion).toBe('BCN-DEMO-v1');
    expect(parsed.graphSchemaVersion).toBe('SR-GRAPH-v1');
    expect(parsed.policyVersion).toBe('SR-POLICY-v1');
    expect(parsed.scoringVersion).toBe('SR-SCORE-v1');
    expect(parsed.producers.creativePreservation).toBe('SR-CREATIVE-PRESERVATION-v1');
    expect(parsed.producers.scheduleStability).toBe('SR-SCHEDULE-STABILITY-v1');
    expect(parsed.producers.logisticsImpact).toBe('SR-LOGISTICS-IMPACT-v1');
    expect(parsed.producers.crewDisruption).toBe('SR-CREW-DISRUPTION-v1');
    expect(parsed.producers.newRiskIntroduced).toBe('SR-NEW-RISK-INTRODUCED-v1');
  }, 120000);
});
