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
    expect(report.lifecycle.reasonCodes).toEqual([
      'PHASE_SEQUENCE_MONOTONIC',
      'COMPLETE_IS_TERMINAL',
      'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
      'PRODUCTION_COMPLETE_IMMUTABLE',
    ]);
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
    const serialized = JSON.stringify(first);
    expect(JSON.stringify(second)).toBe(serialized);
    expect(serialized).not.toMatch(/Date\.now/);
    expect(serialized).not.toMatch(/generationTimestamp/);
    expect(serialized).not.toMatch(/hostname/i);
    expect(serialized).not.toMatch(/[A-Za-z]:\\/);
    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/sceneready/i);
    expect(serialized).not.toMatch(/"timestamp"/);
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
    expect(source).not.toMatch(/os\.hostname/);
    expect(source).not.toMatch(/new Date\s*\(/);
  });

  it('keeps canonical scenario construction out of report assembly', async () => {
    const scenarioSource = join(repositoryRoot, 'tools/evidence-report/src/sr02-scenarios.ts');
    const report = await readFile(reportSource, 'utf8');
    const scenarios = await readFile(scenarioSource, 'utf8');
    const scenarioFunctions = [
      'function fixtureDirectory',
      'function loadCanonicalPack',
      'function baseInput',
      'function r0Input',
      'function r1Input',
      'function r2Input',
      'function r2Risks',
      'function r2Impacts',
      'function overlayCompoundEvidence',
      'function recoveredComparison',
    ];

    for (const signature of scenarioFunctions) {
      expect(scenarios).toContain(signature);
      expect(report).not.toContain(signature);
    }
    expect(scenarios).toContain('windowCompressionMinutes');
    expect(scenarios).toContain('loadInDelayMinutes');
    expect(report).not.toContain('windowCompressionMinutes');
    expect(report).not.toContain('loadInDelayMinutes');
    expect(report).toContain("from './sr02-scenarios.js'");
    expect(report).toContain('function generateSr02EvidenceReport');
    expect(report).toContain('function assertProtected');
    expect(report).toContain('function runCli');
    expect(report).toContain('SR-02-EVIDENCE-REPORT-v1');
    expect(scenarios).not.toContain('SR-02-EVIDENCE-REPORT-v1');
    expect(scenarios).not.toContain('process.stdout');
    expect(scenarios).not.toContain('process.stderr');
    expect(report).not.toMatch(/Date\.now\s*\(/);
    expect(scenarios).not.toMatch(/Date\.now\s*\(/);
    expect(scenarios).not.toMatch(/Math\.random\s*\(/);
    expect(scenarios).not.toMatch(/os\.hostname/);
    expect(scenarios).not.toMatch(/new Date\s*\(/);
  });
});
