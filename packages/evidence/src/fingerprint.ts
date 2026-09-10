import { createHash } from 'node:crypto';

export class EvidenceCanonicalizationError extends Error {
  constructor(detail: string) {
    super(`canonical JSON rejected: ${detail}`);
    this.name = 'EvidenceCanonicalizationError';
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeValue(value: unknown, path: string): unknown {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return value;
  }
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new EvidenceCanonicalizationError(`non-finite number at ${path}`);
    }
    return value;
  }
  if (
    valueType === 'undefined' ||
    valueType === 'function' ||
    valueType === 'symbol' ||
    valueType === 'bigint'
  ) {
    throw new EvidenceCanonicalizationError(`non-JSON ${valueType} at ${path}`);
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new EvidenceCanonicalizationError(`sparse array at ${path}.${index}`);
      }
      items.push(canonicalizeValue(value[index], `${path}.${index}`));
    }
    return items;
  }

  if (typeof value !== 'object' || value === null) {
    throw new EvidenceCanonicalizationError(`unsupported value at ${path}`);
  }

  if (!isPlainObject(value)) {
    throw new EvidenceCanonicalizationError(`non-plain object at ${path}`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new EvidenceCanonicalizationError(`symbol key at ${path}`);
  }

  const canonical: Record<string, unknown> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    const property = value[key];
    if (property === undefined) {
      throw new EvidenceCanonicalizationError(`undefined property '${key}' at ${path}`);
    }
    canonical[key] = canonicalizeValue(property, `${path}.${key}`);
  }
  return canonical;
}

export function canonicalizeEvidenceJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, '$'));
}

export function fingerprintEvidenceContent(value: unknown): string {
  return createHash('sha256').update(canonicalizeEvidenceJson(value), 'utf8').digest('hex');
}
