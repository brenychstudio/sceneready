const textEncoder = new TextEncoder();

export class AuthorityContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthorityContractError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AuthorityContractError(code, message);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index] ?? 0;
    const rightByte = rightBytes[index] ?? 0;
    if (leftByte !== rightByte) {
      return leftByte - rightByte;
    }
  }
  return leftBytes.length - rightBytes.length;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encode(value: unknown, stack: WeakSet<object>): string {
  if (value === undefined) {
    fail('UNDEFINED', 'undefined is not a canonical value');
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      fail('NAN', 'NaN is not a canonical value');
    }
    if (!Number.isFinite(value)) {
      fail('INFINITY', 'non-finite numbers are not canonical values');
    }
    if (Object.is(value, -0)) {
      return '0';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    fail('BIGINT', 'BigInt is not a canonical value');
  }
  if (typeof value === 'symbol') {
    fail('SYMBOL', 'symbols are not canonical values');
  }
  if (typeof value === 'function') {
    fail('FUNCTION', 'functions are not canonical values');
  }
  if (typeof value !== 'object') {
    fail('UNSUPPORTED_VALUE', 'value has no canonical form');
  }
  if (stack.has(value)) {
    fail('CYCLE', 'cyclic structures are not canonical values');
  }
  if (Array.isArray(value)) {
    stack.add(value);
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        fail('UNDEFINED', 'array holes are not canonical values');
      }
      parts.push(encode(value[index], stack));
    }
    stack.delete(value);
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(value)) {
    fail('UNSUPPORTED_VALUE', 'only plain objects have a canonical form');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('SYMBOL', 'symbol keys are not canonical values');
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor !== undefined && !descriptor.enumerable) {
      fail('UNSUPPORTED_VALUE', 'non-enumerable properties are not canonical values');
    }
  }
  stack.add(value);
  const keys = Object.keys(value).sort(compareUtf8);
  const parts = keys.map((key) => `${JSON.stringify(key)}:${encode(value[key], stack)}`);
  stack.delete(value);
  return `{${parts.join(',')}}`;
}

/** Deterministic UTF-8 canonical JSON. Object key order is insignificant; array order is not. */
export function canonicalize(value: unknown): string {
  return encode(value, new WeakSet());
}
