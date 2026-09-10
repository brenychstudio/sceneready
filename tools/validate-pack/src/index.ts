import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAPH_SCHEMA_VERSION,
  activateProductionPack,
  fingerprintProductionPack,
  packOwnedActivationInstant,
  validateProductionPack,
} from '@sceneready/production-pack';

export interface ValidatePackWriter {
  write(chunk: string): unknown;
}

export interface ValidatePackIo {
  readonly stdout: ValidatePackWriter;
  readonly stderr: ValidatePackWriter;
}

const FIXTURE_FLAG = '--fixture';

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function printJson(io: ValidatePackIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(directory: string, fileName: string): Promise<unknown> {
  const raw = await readFile(join(directory, fileName), 'utf8');
  return JSON.parse(raw) as unknown;
}

async function loadFixtureDirectory(directory: string): Promise<unknown> {
  const [
    manifest,
    production,
    crew,
    locations,
    schedule,
    deliverables,
    equipment,
    rights,
    priorities,
  ] = await Promise.all([
    readJson(directory, 'manifest.json'),
    readJson(directory, 'production.json'),
    readJson(directory, 'crew.json'),
    readJson(directory, 'locations.json'),
    readJson(directory, 'schedule.json'),
    readJson(directory, 'deliverables.json'),
    readJson(directory, 'equipment.json'),
    readJson(directory, 'rights.json'),
    readJson(directory, 'priorities.json'),
  ]);

  if (!isRecord(manifest) || !isRecord(equipment) || !isRecord(rights)) {
    throw new Error('fixture sections are malformed');
  }

  return {
    fixtureVersion: manifest.fixtureVersion,
    policyVersion: manifest.policyVersion,
    syntheticDataDeclaration: manifest.syntheticDataDeclaration,
    production,
    crew,
    locations,
    schedule,
    deliverables,
    equipment: equipment.assets,
    capturePaths: equipment.capturePaths,
    rights: rights.documents,
    priorities,
    hardGates: rights.hardGates,
    evidence: rights.evidence,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'invalid pack input';
}

export async function runValidatePack(
  args: readonly string[],
  io: ValidatePackIo,
): Promise<number> {
  try {
    const fixtureArg = flagValue(args, FIXTURE_FLAG);
    if (fixtureArg === undefined || fixtureArg.length === 0 || fixtureArg.startsWith('--')) {
      printJson(io, {
        status: 'INVALID',
        message: 'missing --fixture <directory>',
      });
      return 2;
    }

    const fixtureDir = resolve(fixtureArg);
    const info = await stat(fixtureDir);
    if (!info.isDirectory()) {
      printJson(io, {
        status: 'INVALID',
        message: 'fixture path is not a directory',
      });
      return 2;
    }

    const loaded = await loadFixtureDirectory(fixtureDir);
    const validated = validateProductionPack(loaded);
    if (!validated.ok) {
      printJson(io, {
        status: 'INVALID',
        issues: validated.issues,
      });
      return 2;
    }

    const activatedAt = packOwnedActivationInstant(validated.pack);
    const manifest = activateProductionPack(validated.pack, activatedAt);
    printJson(io, {
      status: 'VALID',
      productionId: manifest.productionId,
      fixtureVersion: manifest.fixtureVersion,
      policyVersion: manifest.policyVersion,
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      packFingerprint: fingerprintProductionPack(validated.pack),
      activatedAt: manifest.activatedAt,
    });
    return 0;
  } catch (error) {
    printJson(io, {
      status: 'INVALID',
      message: errorMessage(error),
    });
    return 2;
  }
}

function isDirectCliInvocation(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

if (isDirectCliInvocation()) {
  const code = await runValidatePack(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exitCode = code;
}
