import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateSr02EvidenceReport } from './sr02-report.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const reportSource = join(repositoryRoot, 'tools/evidence-report/src/sr02-report.ts');
const tsxCli = join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');

describe('SR-02 evidence report', () => {
  it('computes protected R0/R1/R2 assessments from real evaluation output', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const report = await generateSr02EvidenceReport();

    expect(report.reportSchemaVersion).toBe('SR-02-EVIDENCE-REPORT-v1');
    expect(report.assessments.R0.readinessScore).toBe(78);
    expect(report.assessments.R0.confidenceScore).toBe(94);
    expect(report.assessments.R0.status).toBe('BLOCKED');
    expect(report.assessments.R0.certification).toBe('CERTIFIED');
    expect(report.assessments.R0.failedGateIds).toEqual(['RIGHTS']);
    expect(report.assessments.R1.readinessScore).toBe(86);
    expect(report.assessments.R1.confidenceScore).toBe(96);
    expect(report.assessments.R1.status).toBe('READY');
    expect(report.assessments.R1.certification).toBe('CERTIFIED');
    expect(report.assessments.R2.readinessScore).toBe(74);
    expect(report.assessments.R2.confidenceScore).toBe(96);
    expect(report.assessments.R2.status).toBe('AT_RISK');
    expect(report.assessments.R2.certification).toBe('CERTIFIED');
    expect(report.metrics.protectedCriticalDeliverables).toBe(2);
    expect(report.metrics.predictedStudioDelayReductionMinutes).toBe(15);
    expect(report.metrics.monetaryImpact).toBeNull();
    expect(report.lifecycle.reasonCodes).toContain('ACTIVITY_IMMUTABLE_AFTER_COMPLETION');
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('includes the Task-6 weather-to-D2 causal path and compound evidence provenance', async () => {
    const report = await generateSr02EvidenceReport();
    const gothic = report.assessments.R2.risks.find(
      (item) => item.subjectId === 'ACT-GOTHIC-LOOK-03',
    );
    const eixample = report.assessments.R2.risks.find(
      (item) => item.subjectId === 'ACT-EIXAMPLE-LOOK-05',
    );
    const studio = report.assessments.R2.risks.find(
      (item) => item.subjectId === 'ACT-STUDIO-LOAD-IN',
    );
    const weatherPath = report.assessments.R2.impacts.find(
      (item) =>
        item.deliverableId === 'DELIVERABLE-D2' &&
        item.pathNodeIds[0] === 'EVIDENCE-WEATHER-DRIFT' &&
        item.pathNodeIds.at(-1) === 'DELIVERABLE-D2',
    );

    expect(gothic?.severity).toBe('CRITICAL');
    expect(eixample?.severity).toBe('HIGH');
    expect(studio?.severity).toBe('MEDIUM');
    expect(weatherPath).toBeDefined();
    expect(weatherPath?.pathNodeIds).toContain('ACT-GOTHIC-LOOK-03');
    expect(weatherPath?.pathEdgeIds.length).toBeGreaterThan(0);
    expect(weatherPath?.sourceEvidenceIds).toEqual([
      'EVIDENCE-TRAVEL-DRIFT',
      'EVIDENCE-WEATHER-DRIFT',
    ]);
  });

  it('includes stable sorted fingerprints and is byte-equivalent across runs', async () => {
    const first = await generateSr02EvidenceReport();
    const second = await generateSr02EvidenceReport();

    expect(first.fixture.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.policy.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.graph.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.evidence.map((item) => item.evidenceId)).toEqual(
      [...first.evidence.map((item) => item.evidenceId)].sort(),
    );
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first)).not.toMatch(/Date\.now/);
    expect(JSON.stringify(first)).not.toMatch(/generationTimestamp/);
    expect(JSON.stringify(first)).not.toMatch(/hostname/i);
  });

  it('prints JSON only on stdout when invoked as a CLI', () => {
    const result = spawnSync(process.execPath, [tsxCli, reportSource], {
      encoding: 'utf8',
      cwd: repositoryRoot,
      windowsHide: true,
    });
    const parsed: unknown = JSON.parse(result.stdout.trim());

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().startsWith('{')).toBe(true);
    expect(parsed).toEqual(
      expect.objectContaining({
        reportSchemaVersion: 'SR-02-EVIDENCE-REPORT-v1',
      }),
    );
  });
});

describe('SR-02 report source authority', () => {
  it('does not hard-code protected scores by scenario branch', async () => {
    const source = await readFile(reportSource, 'utf8');
    expect(source).not.toMatch(/if\s*\(.*===\s*['"]R0['"]/);
    expect(source).not.toMatch(/return 78/);
    expect(source).not.toMatch(/Date\.now\s*\(/);
    expect(source).not.toMatch(/Math\.random\s*\(/);
    expect(source).not.toMatch(/randomUUID/);
  });
});
