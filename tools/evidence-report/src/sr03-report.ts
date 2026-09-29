import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { certifyCanonicalRecovery, type CanonicalRecoveryCertification } from '@sceneready/agent';
import { format } from 'prettier';

import { r2Input } from './sr02-scenarios.js';

export function sr03EvidencePath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../docs/evidence/SR-03-CERTIFICATION.json',
  );
}

export async function generateSr03EvidenceReport(): Promise<CanonicalRecoveryCertification> {
  return certifyCanonicalRecovery(r2Input());
}

export async function serializeSr03EvidenceReport(
  report: CanonicalRecoveryCertification,
): Promise<string> {
  return format(JSON.stringify(report), { filepath: sr03EvidencePath() });
}

export function sha256Sr03EvidenceReport(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function isDirectCliInvocation(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

async function runCli(): Promise<number> {
  try {
    const serialized = await serializeSr03EvidenceReport(await generateSr03EvidenceReport());
    const path = sr03EvidencePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialized, 'utf8');
    process.stdout.write(serialized);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sr03 evidence report failed';
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

if (isDirectCliInvocation()) {
  process.exitCode = await runCli();
}
