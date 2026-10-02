import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  generateSr04EvidenceReport,
  serializeSr04EvidenceReport,
  sha256Sr04EvidenceReport,
  type Sr04CertificationReport,
} from './sr04-report.js';

const ATTACK_REASONS = {
  ASSISTANT_ROLE: 'ROLE_NOT_AUTHORIZED',
  CROSS_PRODUCTION: 'PRODUCTION_SCOPE_MISMATCH',
  CROSS_NAMESPACE: 'AUTHORITY_NAMESPACE_MISMATCH',
  TAMPERED_FINGERPRINT: 'PROPOSAL_FINGERPRINT_MISMATCH',
  EXPIRED_TOKEN: 'APPROVAL_EXPIRED',
  REPLAYED_TOKEN: 'APPROVAL_ALREADY_CONSUMED',
  GRAPH_DRIFT: 'BASE_REVISION_STALE',
  PAYLOAD_DRIFT: 'PROPOSAL_FINGERPRINT_MISMATCH',
} as const;

function attack(report: Sr04CertificationReport, id: keyof typeof ATTACK_REASONS) {
  const found = report.attacks.find((item) => item.id === id);
  expect(found, id).toBeDefined();
  if (found === undefined) {
    throw new Error(id);
  }
  return found;
}

describe('sr04 evidence report', () => {
  it('serializes two executions as the same bytes and sha256', async () => {
    const firstReport = await generateSr04EvidenceReport();
    const secondReport = await generateSr04EvidenceReport();
    const first = await serializeSr04EvidenceReport(firstReport);
    const second = await serializeSr04EvidenceReport(secondReport);
    expect(first).toBe(second);
    expect(sha256Sr04EvidenceReport(first)).toBe(
      createHash('sha256').update(second, 'utf8').digest('hex'),
    );
    expect(first).not.toMatch(/"timestamp"/);
    expect(first).not.toMatch(/Date\.now/);
  }, 120000);

  it('records the executed authority and delivery proofs', async () => {
    const report = await generateSr04EvidenceReport();
    expect(report.reportVersion).toBe('SR-04-CERTIFICATION-v1');
    expect(report.identity.executionCoreCommit).toBe('963be6d0825713505a3a3144c11faeb9d6e827d3');
    expect(report.policies.authorityRoleNamespace).toBe('SR-AUTHORITY-ROLE-NAMESPACE-v1.0');
    expect(report.policies.communicationAudience).toBe('SR-COMMUNICATION-AUDIENCE-v1.0');
    expect(report.invariants.every((item) => item.pass)).toBe(true);
    expect(report.invariantCount).toBe(report.invariants.length);
    expect(report.successfulBypasses).toBe(0);
    expect(report.attackCount).toBe(8);
    for (const [id, reason] of Object.entries(ATTACK_REASONS)) {
      const item = attack(report, id as keyof typeof ATTACK_REASONS);
      expect(item.status).toBe('DENIED');
      expect(item.reason).toBe(reason);
      expect(item.mutations).toBe(0);
      expect(item.pass).toBe(true);
    }
    expect(attack(report, 'ASSISTANT_ROLE').executionReason).toBe('TOKEN_REJECTED');
    expect(report.ambiguousSpeech).toEqual({
      status: 'NOT_APPROVED',
      reason: 'NO_EXPLICIT_APPROVAL',
      token: null,
      signatures: 0,
    });
    expect(report.atomicTransaction.pass).toBe(true);
    expect(report.atomicTransaction.rollbackPass).toBe(true);
    expect(report.atomicTransaction.appliedRevision).toBe(15);
    expect(report.singleUse).toEqual({ pass: true, reason: 'APPROVAL_ALREADY_CONSUMED' });
    expect(report.staleDrift).toEqual({
      pass: true,
      graphReason: 'BASE_REVISION_STALE',
      productionReason: 'BASE_REVISION_STALE',
    });
    expect(report.canonical.outboxCount).toBe(4);
    expect(report.canonical.criticalCount).toBe(3);
    expect(report.canonical.informationalCount).toBe(1);
    expect(report.canonical.faultDelivery).toBe('3/4');
    expect(report.canonical.recoveredDelivery).toBe('4/4');
    expect(report.canonical.criticalAcknowledgements).toBe('3/3');
    expect(report.canonical.partialCompletionPass).toBe(true);
    expect(report.canonical.idempotentRetryPass).toBe(true);
    expect(report.canonical.deliveredIsNotConfirmed).toBe(true);
    expect(report.canonical.cannotComplyPass).toBe(true);
    expect(report.canonical.cannotComplyRequiresRecompute).toBe(true);
    expect(report.canonical.forwardRecoveryPass).toBe(true);
    expect(report.canonical.immutableHistoryPass).toBe(true);
    expect(report.canonical.historyEvents).toBe(1);
    expect(report.canonical.compensationBaseProductionRevision).toBe(15);
    expect(report.canonical.compensationFingerprintBound).toBe(true);
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'sr04-report.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
    expect(source).not.toMatch(/\bMath\.random\s*\(/);
    expect(source).not.toMatch(/\brandomUUID\s*\(/);
  }, 120000);
});
