import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  auditDependencyBoundaries,
  DependencyBoundaryAnalysisError,
  type DependencyBoundaryAuditResult,
  type DependencyBoundaryViolation,
} from './dependency-boundaries.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const VIRTUAL_ROOT = '/virtual-sceneready';

async function auditFiles(files: Record<string, string>): Promise<DependencyBoundaryAuditResult> {
  return auditDependencyBoundaries(VIRTUAL_ROOT, { files });
}

function violation(partial: DependencyBoundaryViolation): DependencyBoundaryViolation {
  return partial;
}

function packageManifest(
  name: string,
  fields: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  },
): string {
  return `${JSON.stringify({ name, ...fields }, null, 2)}\n`;
}

describe('auditDependencyBoundaries', () => {
  it('rejects an AWS import from a pure package', async () => {
    const result = await auditFiles({
      'packages/domain/src/index.ts': `import { S3Client } from '@aws-sdk/client-s3';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_AWS',
        path: 'packages/domain/src/index.ts',
        line: 1,
        moduleSpecifier: '@aws-sdk/client-s3',
        message:
          "Pure package @sceneready/domain must not import AWS family module '@aws-sdk/client-s3'.",
      }),
    ]);
  });

  it('rejects a React import from a pure package', async () => {
    const result = await auditFiles({
      'packages/evidence/src/index.ts': `import React from 'react';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_REACT',
        path: 'packages/evidence/src/index.ts',
        line: 1,
        moduleSpecifier: 'react',
        message: "Pure package @sceneready/evidence must not import React family module 'react'.",
      }),
    ]);
  });

  it('rejects an MCP runtime import from a pure package', async () => {
    const result = await auditFiles({
      'packages/replay/src/index.ts': `import { Client } from '@modelcontextprotocol/sdk';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_MCP_RUNTIME',
        path: 'packages/replay/src/index.ts',
        line: 1,
        moduleSpecifier: '@modelcontextprotocol/sdk',
        message:
          "Pure package @sceneready/replay must not import MCP runtime family module '@modelcontextprotocol/sdk'.",
      }),
    ]);
  });

  it('rejects CDK and Strands imports from a pure package', async () => {
    const result = await auditFiles({
      'packages/solar-engine/src/cdk.ts': `import { Stack } from 'aws-cdk-lib';\n`,
      'packages/solar-engine/src/strands.ts': `import { Agent } from '@strands-agents/sdk';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_CDK',
        path: 'packages/solar-engine/src/cdk.ts',
        line: 1,
        moduleSpecifier: 'aws-cdk-lib',
        message:
          "Pure package @sceneready/solar-engine must not import CDK family module 'aws-cdk-lib'.",
      }),
      violation({
        code: 'PURE_PACKAGE_IMPORTS_STRANDS',
        path: 'packages/solar-engine/src/strands.ts',
        line: 1,
        moduleSpecifier: '@strands-agents/sdk',
        message:
          "Pure package @sceneready/solar-engine must not import Strands family module '@strands-agents/sdk'.",
      }),
    ]);
  });

  it('rejects a Bedrock/AgentCore runtime import from a pure package as AWS', async () => {
    const result = await auditFiles({
      'packages/readiness-engine/src/index.ts': `import { Runtime } from '@amazon-bedrock-agentcore/sdk';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_AWS',
        path: 'packages/readiness-engine/src/index.ts',
        line: 1,
        moduleSpecifier: '@amazon-bedrock-agentcore/sdk',
        message:
          "Pure package @sceneready/readiness-engine must not import AWS family module '@amazon-bedrock-agentcore/sdk'.",
      }),
    ]);
  });

  it('rejects an @sceneready deep import', async () => {
    const result = await auditFiles({
      'packages/production-graph/src/index.ts': `import {} from '@sceneready/evidence/src/index.js';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'SCENEREADY_DEEP_IMPORT',
        path: 'packages/production-graph/src/index.ts',
        line: 1,
        moduleSpecifier: '@sceneready/evidence/src/index.js',
        message:
          "Cross-workspace import must use a public @sceneready/* entry point, not deep import '@sceneready/evidence/src/index.js'.",
      }),
    ]);
  });

  it('rejects a cross-workspace relative escape', async () => {
    const result = await auditFiles({
      'packages/domain/src/index.ts': `import {} from '../../evidence/src/index.js';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'CROSS_WORKSPACE_RELATIVE_IMPORT',
        path: 'packages/domain/src/index.ts',
        line: 1,
        moduleSpecifier: '../../evidence/src/index.js',
        message: "Relative import '../../evidence/src/index.js' escapes workspace packages/domain.",
      }),
    ]);
  });

  it('rejects a package → app source import', async () => {
    const result = await auditFiles({
      'packages/domain/src/index.ts': `import {} from '../../../apps/mcp-runtime/src/index.js';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PACKAGE_IMPORTS_APP_LAYER',
        path: 'packages/domain/src/index.ts',
        line: 1,
        moduleSpecifier: '../../../apps/mcp-runtime/src/index.js',
        message:
          "packages/* must not import apps/* source ('../../../apps/mcp-runtime/src/index.js').",
      }),
    ]);
  });

  it('rejects a package → service source import', async () => {
    const result = await auditFiles({
      'packages/production-pack/src/index.ts': `import {} from '../../../services/risk-watch/src/index.js';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PACKAGE_IMPORTS_SERVICE_LAYER',
        path: 'packages/production-pack/src/index.ts',
        line: 1,
        moduleSpecifier: '../../../services/risk-watch/src/index.js',
        message:
          "packages/* must not import services/* source ('../../../services/risk-watch/src/index.js').",
      }),
    ]);
  });

  it('rejects a package → infrastructure source import', async () => {
    const result = await auditFiles({
      'packages/intervention-engine/src/index.ts': `import {} from '../../../infrastructure/cdk/src/index.js';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PACKAGE_IMPORTS_INFRASTRUCTURE_LAYER',
        path: 'packages/intervention-engine/src/index.ts',
        line: 1,
        moduleSpecifier: '../../../infrastructure/cdk/src/index.js',
        message:
          "packages/* must not import infrastructure/* source ('../../../infrastructure/cdk/src/index.js').",
      }),
    ]);
  });

  it('rejects a package importing an app workspace public entry', async () => {
    const result = await auditFiles({
      'packages/shadow-simulation/src/index.ts': `import {} from '@sceneready/mcp-runtime';\n`,
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PACKAGE_IMPORTS_APP_LAYER',
        path: 'packages/shadow-simulation/src/index.ts',
        line: 1,
        moduleSpecifier: '@sceneready/mcp-runtime',
        message: "packages/* must not import apps/* source ('@sceneready/mcp-runtime').",
      }),
    ]);
  });

  it('does not emit a duplicate relative-escape violation when a layer finding fully describes the import', async () => {
    const result = await auditFiles({
      'packages/recovery-ranking/src/index.ts': `import {} from '../../../apps/judge-console/src/index.js';\n`,
    });

    expect(result.violations.map((item) => item.code)).toEqual(['PACKAGE_IMPORTS_APP_LAYER']);
  });

  it('allows a legitimate public @sceneready package import', async () => {
    const result = await auditFiles({
      'packages/domain/src/index.ts': `import {} from '@sceneready/evidence';\n`,
      'apps/mcp-runtime/src/index.ts': `import {} from '@sceneready/domain';\n`,
      'tools/replay-cli/src/index.ts': `import {} from '@sceneready/replay';\n`,
    });

    expect(result.violations).toEqual([]);
  });

  it('treats empty scaffolds as valid', async () => {
    const result = await auditFiles({
      'packages/domain/src/index.ts': 'export {};\n',
      'packages/communications/src/index.ts': 'export {};\n',
      'packages/mcp-human-authority/src/index.ts': 'export {};\n',
      'apps/mcp-runtime/src/index.ts': 'export {};\n',
      'apps/mcp-runtime/ui/src/index.ts': 'export {};\n',
      'services/execution-worker/src/index.ts': 'export {};\n',
      'infrastructure/cdk/src/index.ts': 'export {};\n',
    });

    expect(result.violations).toEqual([]);
  });

  it('allows forbidden families outside locked pure packages', async () => {
    const result = await auditFiles({
      'packages/agent/src/index.ts': `import { S3Client } from '@aws-sdk/client-s3';\n`,
      'packages/presentation/src/index.ts': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\n`,
      'apps/mcp-runtime/src/index.ts': `import { Server } from '@modelcontextprotocol/sdk';\n`,
      'infrastructure/cdk/src/index.ts': `import { Stack } from 'aws-cdk-lib';\nimport { Construct } from 'constructs';\n`,
    });

    expect(result.violations).toEqual([]);
  });

  it('analyzes import type, re-export, dynamic import, and require specifiers', async () => {
    const result = await auditFiles({
      'packages/domain/src/types.ts': `import type { S3Client } from '@aws-sdk/client-s3';\n`,
      'packages/domain/src/reexport.ts': `export { Stack } from 'aws-cdk-lib';\n`,
      'packages/domain/src/dynamic.ts': `export const load = () => import('react');\n`,
      'packages/domain/src/cjs.ts': `const sdk = require('@modelcontextprotocol/sdk');\nexport { sdk };\n`,
    });

    expect(result.violations.map((item) => [item.path, item.code, item.moduleSpecifier])).toEqual([
      [
        'packages/domain/src/cjs.ts',
        'PURE_PACKAGE_IMPORTS_MCP_RUNTIME',
        '@modelcontextprotocol/sdk',
      ],
      ['packages/domain/src/dynamic.ts', 'PURE_PACKAGE_IMPORTS_REACT', 'react'],
      ['packages/domain/src/reexport.ts', 'PURE_PACKAGE_IMPORTS_CDK', 'aws-cdk-lib'],
      ['packages/domain/src/types.ts', 'PURE_PACKAGE_IMPORTS_AWS', '@aws-sdk/client-s3'],
    ]);
  });

  it('sorts violations by path, then line, then code, then moduleSpecifier', async () => {
    const result = await auditFiles({
      'packages/evidence/src/index.ts': `import React from 'react';\n`,
      'packages/domain/src/index.ts': `import 'react'; import '@aws-sdk/client-s3';\n`,
    });

    expect(
      result.violations.map((item) => [item.path, item.line, item.code, item.moduleSpecifier]),
    ).toEqual([
      ['packages/domain/src/index.ts', 1, 'PURE_PACKAGE_IMPORTS_AWS', '@aws-sdk/client-s3'],
      ['packages/domain/src/index.ts', 1, 'PURE_PACKAGE_IMPORTS_REACT', 'react'],
      ['packages/evidence/src/index.ts', 1, 'PURE_PACKAGE_IMPORTS_REACT', 'react'],
    ]);
  });

  it('fails closed when a dynamic import specifier cannot be analyzed statically', async () => {
    await expect(
      auditFiles({
        'packages/domain/src/index.ts': `const name = 'react';\nexport const load = () => import(name);\n`,
      }),
    ).rejects.toBeInstanceOf(DependencyBoundaryAnalysisError);
  });

  it('rejects an unused AWS dependency declared in a pure package manifest', async () => {
    const result = await auditFiles({
      'packages/domain/package.json': packageManifest('@sceneready/domain', {
        dependencies: { '@aws-sdk/client-s3': '3.0.0' },
      }),
      'packages/domain/src/index.ts': 'export {};\n',
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_AWS',
        path: 'packages/domain/package.json',
        line: null,
        moduleSpecifier: '@aws-sdk/client-s3',
        message:
          "Pure package @sceneready/domain must not declare AWS family module '@aws-sdk/client-s3' in dependencies.",
      }),
    ]);
  });

  it('rejects an unused React dependency declared in a pure package manifest', async () => {
    const result = await auditFiles({
      'packages/evidence/package.json': packageManifest('@sceneready/evidence', {
        dependencies: { react: '19.0.0' },
      }),
      'packages/evidence/src/index.ts': 'export {};\n',
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_REACT',
        path: 'packages/evidence/package.json',
        line: null,
        moduleSpecifier: 'react',
        message:
          "Pure package @sceneready/evidence must not declare React family module 'react' in dependencies.",
      }),
    ]);
  });

  it('rejects an unused MCP runtime dependency declared in a pure package manifest', async () => {
    const result = await auditFiles({
      'packages/replay/package.json': packageManifest('@sceneready/replay', {
        dependencies: { '@modelcontextprotocol/sdk': '1.0.0' },
      }),
      'packages/replay/src/index.ts': 'export {};\n',
    });

    expect(result.violations).toEqual([
      violation({
        code: 'PURE_PACKAGE_IMPORTS_MCP_RUNTIME',
        path: 'packages/replay/package.json',
        line: null,
        moduleSpecifier: '@modelcontextprotocol/sdk',
        message:
          "Pure package @sceneready/replay must not declare MCP runtime family module '@modelcontextprotocol/sdk' in dependencies.",
      }),
    ]);
  });

  it('rejects unused forbidden families in every relevant pure-package manifest field', async () => {
    const result = await auditFiles({
      'packages/production-pack/package.json': packageManifest('@sceneready/production-pack', {
        dependencies: { '@aws-sdk/client-s3': '3.0.0' },
        devDependencies: { 'aws-cdk-lib': '2.0.0' },
        peerDependencies: { react: '19.0.0' },
        optionalDependencies: { '@modelcontextprotocol/sdk': '1.0.0' },
      }),
      'packages/production-pack/src/index.ts': 'export {};\n',
    });

    expect(
      result.violations.map((item) => [item.code, item.moduleSpecifier, item.message]),
    ).toEqual([
      [
        'PURE_PACKAGE_IMPORTS_AWS',
        '@aws-sdk/client-s3',
        "Pure package @sceneready/production-pack must not declare AWS family module '@aws-sdk/client-s3' in dependencies.",
      ],
      [
        'PURE_PACKAGE_IMPORTS_CDK',
        'aws-cdk-lib',
        "Pure package @sceneready/production-pack must not declare CDK family module 'aws-cdk-lib' in devDependencies.",
      ],
      [
        'PURE_PACKAGE_IMPORTS_MCP_RUNTIME',
        '@modelcontextprotocol/sdk',
        "Pure package @sceneready/production-pack must not declare MCP runtime family module '@modelcontextprotocol/sdk' in optionalDependencies.",
      ],
      [
        'PURE_PACKAGE_IMPORTS_REACT',
        'react',
        "Pure package @sceneready/production-pack must not declare React family module 'react' in peerDependencies.",
      ],
    ]);
  });

  it('does not emit a duplicate manifest finding when source already reports the same forbidden family', async () => {
    const result = await auditFiles({
      'packages/domain/package.json': packageManifest('@sceneready/domain', {
        dependencies: { '@aws-sdk/client-s3': '3.0.0' },
      }),
      'packages/domain/src/index.ts': `import { S3Client } from '@aws-sdk/client-s3';\n`,
    });

    expect(result.violations.map((item) => [item.path, item.code, item.moduleSpecifier])).toEqual([
      ['packages/domain/src/index.ts', 'PURE_PACKAGE_IMPORTS_AWS', '@aws-sdk/client-s3'],
    ]);
  });

  it('does not flag repository root toolchain dependencies', async () => {
    const result = await auditFiles({
      'package.json': packageManifest('@sceneready/root', {
        devDependencies: {
          react: '19.0.0',
          '@aws-sdk/client-s3': '3.0.0',
          '@modelcontextprotocol/sdk': '1.0.0',
          typescript: '6.0.2',
        },
      }),
      'packages/domain/src/index.ts': 'export {};\n',
    });

    expect(result.violations).toEqual([]);
  });

  it('allows forbidden families declared in a non-pure package manifest', async () => {
    const result = await auditFiles({
      'packages/agent/package.json': packageManifest('@sceneready/agent', {
        dependencies: { '@aws-sdk/client-s3': '3.0.0' },
      }),
      'packages/presentation/package.json': packageManifest('@sceneready/presentation', {
        dependencies: { react: '19.0.0', 'react-dom': '19.0.0' },
      }),
      'apps/mcp-runtime/package.json': packageManifest('@sceneready/mcp-runtime', {
        dependencies: { '@modelcontextprotocol/sdk': '1.0.0' },
      }),
      'packages/agent/src/index.ts': 'export {};\n',
      'packages/presentation/src/index.ts': 'export {};\n',
      'apps/mcp-runtime/src/index.ts': 'export {};\n',
    });

    expect(result.violations).toEqual([]);
  });

  it('reports zero violations for the current repository', async () => {
    const result = await auditDependencyBoundaries(repositoryRoot);

    expect(result.violations).toEqual([]);
  });
});
