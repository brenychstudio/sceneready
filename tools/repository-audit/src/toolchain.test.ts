import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

interface RootPackage {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readRootPackage(): RootPackage {
  return JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as RootPackage;
}

function compilerDependencyNames(devDependencies: Record<string, string>): string[] {
  return Object.keys(devDependencies)
    .filter(
      (name) =>
        name === 'typescript' ||
        name === 'typescript-7' ||
        name === '@typescript/typescript6' ||
        name === '@typescript/native' ||
        /^typescript-\d/.test(name),
    )
    .sort();
}

describe('TypeScript toolchain identity', () => {
  it('pins exactly one official TypeScript compiler package', () => {
    const devDependencies = readRootPackage().devDependencies ?? {};

    expect(compilerDependencyNames(devDependencies)).toEqual(['typescript']);
    expect(devDependencies.typescript).toMatch(/^\d+\.\d+\.\d+$/);
    expect(devDependencies.typescript).not.toMatch(/^npm:/);
  });

  it('does not declare a typescript-7 compiler alias', () => {
    const devDependencies = readRootPackage().devDependencies ?? {};

    expect(devDependencies['typescript-7']).toBeUndefined();
  });

  it('does not relink tsc during postinstall', () => {
    const postinstall = readRootPackage().scripts?.postinstall;

    expect(postinstall).toBeUndefined();
  });

  it('does not ship scripts/link-native-tsc.mjs', () => {
    expect(existsSync(join(repositoryRoot, 'scripts', 'link-native-tsc.mjs'))).toBe(false);
  });

  it('locks the official typescript tarball, not a compiler alias', () => {
    const lock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8')) as {
      packages?: Record<
        string,
        {
          name?: string;
          version?: string;
          resolved?: string;
          devDependencies?: Record<string, string>;
        }
      >;
    };
    const rootSpec = lock.packages?.['']?.devDependencies?.typescript;
    const installed = lock.packages?.['node_modules/typescript'];

    expect(rootSpec).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed?.resolved ?? '').toMatch(/\/typescript\/-\/typescript-\d+\.\d+\.\d+\.tgz$/);
    expect(installed?.resolved ?? '').not.toContain('@typescript/typescript6');
  });
});
