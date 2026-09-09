import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const DESIGN_PATH = 'docs/superpowers/specs/2026-09-04-sceneready-canonical-design-v1.0.md';
const BRIEF_PATH = 'docs/superpowers/specs/2026-09-04-sceneready-competition-brief-v1.0.md';
const INTERPRETATIONS_PATH =
  'docs/superpowers/specs/2026-09-04-sceneready-implementation-interpretations-v1.0.md';
const INDEX_PATH = 'docs/architecture/ARCHITECTURE-INDEX.md';

const DESIGN_BYTES = 11051;
const DESIGN_SHA256 = 'f54b5d562c437c6ea3c342795a1ee264e038fb99f2ebe5f1e7d885827e3e22e5';
const BRIEF_BYTES = 1317;
const BRIEF_SHA256 = '5dadafb25d99fe8e81f7d07cea5083b9bd2e25b00c73bf272d96aa9753963042';
const INTERPRETATIONS_BYTES = 2539;
const INTERPRETATIONS_SHA256 = 'd015befc7a3232d108107fa73c881b249f96d0a64682e5768f9305d809d6f2c6';

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function readRaw(relativePath: string): Buffer {
  const absolutePath = join(repositoryRoot, relativePath);
  expect(existsSync(absolutePath), `missing authority file: ${relativePath}`).toBe(true);
  return readFileSync(absolutePath);
}

describe('approved design authority integrity', () => {
  it('freezes Canonical Design v1.0 at the approved byte identity', () => {
    const bytes = readRaw(DESIGN_PATH);
    expect(bytes.byteLength).toBe(DESIGN_BYTES);
    expect(sha256Hex(bytes)).toBe(DESIGN_SHA256);
  });

  it('freezes Competition Brief v1.0 at the approved byte identity', () => {
    const bytes = readRaw(BRIEF_PATH);
    expect(bytes.byteLength).toBe(BRIEF_BYTES);
    expect(sha256Hex(bytes)).toBe(BRIEF_SHA256);
  });

  it('freezes Implementation Interpretations v1.0 at the approved byte identity', () => {
    const bytes = readRaw(INTERPRETATIONS_PATH);
    expect(bytes.byteLength).toBe(INTERPRETATIONS_BYTES);
    expect(sha256Hex(bytes)).toBe(INTERPRETATIONS_SHA256);
  });
});

describe('architecture authority index', () => {
  it('exists and records all three frozen SHA-256 identities', () => {
    const bytes = readRaw(INDEX_PATH);
    const text = bytes.toString('utf8');
    expect(text).toContain(DESIGN_SHA256);
    expect(text).toContain(BRIEF_SHA256);
    expect(text).toContain(INTERPRETATIONS_SHA256);
  });

  it('identifies Canonical Design v1.0 as the primary normative design authority', () => {
    const text = readRaw(INDEX_PATH).toString('utf8');
    expect(text).toMatch(/PRIMARY NORMATIVE AUTHORITY/i);
    expect(text).toMatch(/Canonical Design v1\.0/);
  });

  it('identifies the Competition Brief as competition framing and evidence context', () => {
    const text = readRaw(INDEX_PATH).toString('utf8');
    expect(text).toMatch(/COMPETITION CONTEXT AUTHORITY/i);
    expect(text).toMatch(/Competition Brief v1\.0/);
    expect(text).toMatch(/competition framing/i);
  });

  it('identifies Implementation Interpretations as bounded clarifications that do not replace the canonical design', () => {
    const text = readRaw(INDEX_PATH).toString('utf8');
    expect(text).toMatch(/IMPLEMENTATION INTERPRETATION AUTHORITY/i);
    expect(text).toMatch(/Implementation Interpretations v1\.0/);
    expect(text).toMatch(/do not replace\s+the canonical design/i);
  });

  it('documents the expected local design baseline tag without requiring the tag yet', () => {
    const text = readRaw(INDEX_PATH).toString('utf8');
    expect(text).toContain('v0.0.0-design');
    expect(text).toMatch(/pending first public repository push/i);
  });
});
