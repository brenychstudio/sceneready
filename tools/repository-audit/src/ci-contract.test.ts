import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ciWorkflowPath = join(repositoryRoot, '.github/workflows/ci.yml');
const securityWorkflowPath = join(repositoryRoot, '.github/workflows/security.yml');
const releaseAuditWorkflowPath = join(repositoryRoot, '.github/workflows/release-audit.yml');
const claimToEvidencePath = join(repositoryRoot, 'docs/submission/CLAIM-TO-EVIDENCE.md');
const frictionLogPath = join(repositoryRoot, 'docs/submission/FRICTION-LOG.md');
const dependencyRulesPath = join(repositoryRoot, 'docs/architecture/DEPENDENCY-RULES.md');

const MANDATORY_COMMANDS = [
  'npm ci',
  'node scripts/assert-workspace-layout.mjs',
  'npm run typecheck',
  'npm run test',
  'npm run lint',
  'npm run format:check',
  'npm run build',
  'npm run audit:public-boundary',
  'npx vitest run tools/repository-audit/src/dependency-boundaries.test.ts',
  'npm ls --all',
  'npm audit --audit-level=high',
] as const;

const SECURITY_COMMANDS = [
  'npm ci',
  'npm run audit:public-boundary',
  'npx vitest run tools/repository-audit/src/dependency-boundaries.test.ts',
  'npm audit --audit-level=high',
  'npm sbom --sbom-format=cyclonedx > sceneready-sbom.cdx.json',
] as const;

const RELEASE_AUDIT_COMMANDS = [
  'npm ci',
  'node scripts/assert-workspace-layout.mjs',
  'npm run typecheck',
  'npm run test',
  'npm run lint',
  'npm run format:check',
  'npm run build',
  'npm run audit:public-boundary',
  'npx vitest run tools/repository-audit/src/dependency-boundaries.test.ts',
  'npm audit --audit-level=high',
  'npm sbom --sbom-format=cyclonedx > sceneready-sbom.cdx.json',
] as const;

const FUTURE_NOOP_COMMANDS = [
  'audit:claims',
  'eval:all',
  'replay:certify',
  'release:audit',
] as const;

const FRICTION_ENTRY_FIELDS = [
  'Date',
  'Tool / service',
  'Attempted task',
  'Exact steps',
  'Expected behavior',
  'Actual behavior',
  'Severity',
  'Workaround',
  'Actionable suggestion',
] as const;

const WRITE_PERMISSION_KEYS = [
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'packages',
  'pages',
  'pull-requests',
  'repository-projects',
  'security-events',
  'statuses',
] as const;

function readWorkflow(path: string): string {
  return readFileSync(path, 'utf8');
}

function readCiWorkflow(): string {
  return readWorkflow(ciWorkflowPath);
}

function uncommentedSource(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.trimStart().startsWith('#')) {
        return '';
      }
      return line;
    })
    .join('\n');
}

function topLevelBlock(text: string, key: string): string {
  const lines = uncommentedSource(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}:`));
  if (start === -1) {
    return '';
  }

  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
      break;
    }
    collected.push(line);
  }
  return collected.join('\n');
}

function runCommands(text: string): string[] {
  const lines = uncommentedSource(text).split(/\r?\n/);
  const commands: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const block = /^(\s*)run:\s*(>[^|]*|\|[^\s]*)\s*$/.exec(line);
    if (block?.[1] !== undefined && block[2] !== undefined) {
      const indent = block[1].length;
      const marker = block[2];
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const next = lines[index];
        if (next === undefined) {
          break;
        }
        if (next.trim() === '') {
          body.push('');
          index += 1;
          continue;
        }
        const nextIndent = /^\s*/.exec(next)?.[0].length ?? 0;
        if (nextIndent <= indent) {
          index -= 1;
          break;
        }
        body.push(next.slice(Math.min(nextIndent, indent + 2)));
        index += 1;
      }
      const joined = marker.startsWith('>')
        ? body
            .map((part) => part.trim())
            .filter((part) => part !== '')
            .join(' ')
        : body.join('\n');
      commands.push(joined.trim());
      continue;
    }

    const simple = /^\s*run:\s*(.+?)\s*$/.exec(line);
    if (simple?.[1] !== undefined) {
      commands.push(simple[1]);
    }
  }

  return commands;
}

function checkoutWithBlocks(text: string): string[] {
  const lines = uncommentedSource(text).split(/\r?\n/);
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !/^\s+uses:\s+actions\/checkout@v4\s*$/.test(line)) {
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor]?.trim() === '') {
      cursor += 1;
    }

    const withLine = lines[cursor];
    if (withLine === undefined || !/^\s+with:\s*$/.test(withLine)) {
      blocks.push('');
      continue;
    }

    const withIndent = /^\s*/.exec(withLine)?.[0].length ?? 0;
    const body: string[] = [];
    cursor += 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (next === undefined) {
        break;
      }
      if (next.trim() === '') {
        cursor += 1;
        continue;
      }
      const nextIndent = /^\s*/.exec(next)?.[0].length ?? 0;
      if (nextIndent <= withIndent) {
        break;
      }
      body.push(next);
      cursor += 1;
    }
    blocks.push(body.join('\n'));
  }

  return blocks;
}

function expectFullHistoryCheckout(text: string): void {
  const blocks = checkoutWithBlocks(text);
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block).toMatch(/^\s+persist-credentials:\s+false\s*$/m);
    expect(block).toMatch(/^\s+fetch-depth:\s+0\s*$/m);
  }
}

function usesActions(text: string): string[] {
  const actions: string[] = [];
  for (const line of uncommentedSource(text).split(/\r?\n/)) {
    const match = /^\s*uses:\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      actions.push(match[1]);
    }
  }
  return actions;
}

function hasWritePermissions(text: string): boolean {
  const source = uncommentedSource(text);
  if (/permissions:\s*write-all/.test(source)) {
    return true;
  }
  return WRITE_PERMISSION_KEYS.some((key) =>
    new RegExp(`^\\s+${key}:\\s+write\\s*$`, 'm').test(source),
  );
}

describe('CI contract', () => {
  it('has a committed GitHub Actions workflow at .github/workflows/ci.yml', () => {
    expect(existsSync(ciWorkflowPath)).toBe(true);
  });

  it('triggers on pull_request', () => {
    expect(topLevelBlock(readCiWorkflow(), 'on')).toMatch(/^\s+pull_request:\s*(\{\}\s*)?$/m);
  });

  it('triggers on push to main', () => {
    const onBlock = topLevelBlock(readCiWorkflow(), 'on');
    expect(onBlock).toMatch(/^\s+push:\s*$/m);
    expect(onBlock).toMatch(/^\s+-\s+main\s*$/m);
  });

  it('does not use pull_request_target', () => {
    expect(uncommentedSource(readCiWorkflow())).not.toMatch(/pull_request_target/);
  });

  it('runs on ubuntu-latest', () => {
    expect(uncommentedSource(readCiWorkflow())).toMatch(/^\s+runs-on:\s+ubuntu-latest\s*$/m);
  });

  it('sets up Node 22 with official setup-node@v4', () => {
    const source = uncommentedSource(readCiWorkflow());
    expect(source).toMatch(/actions\/setup-node@v4/);
    expect(source).toMatch(/^\s+node-version:\s+['"]?22['"]?\s*$/m);
    expect(source).toMatch(/^\s+cache:\s+npm\s*$/m);
    expect(source).toMatch(/^\s+cache-dependency-path:\s+package-lock\.json\s*$/m);
  });

  it('declares read-only contents permissions', () => {
    expect(topLevelBlock(readCiWorkflow(), 'permissions')).toMatch(/^\s+contents:\s+read\s*$/m);
  });

  it('does not grant write permissions', () => {
    const source = uncommentedSource(readCiWorkflow());
    expect(source).not.toMatch(/permissions:\s*write-all/);
    for (const key of WRITE_PERMISSION_KEYS) {
      expect(source).not.toMatch(new RegExp(`^\\s+${key}:\\s+write\\s*$`, 'm'));
    }
  });

  it('checks out without persisting credentials and with full history', () => {
    const source = uncommentedSource(readCiWorkflow());
    expect(usesActions(source)).toEqual(expect.arrayContaining(['actions/checkout@v4']));
    expectFullHistoryCheckout(source);
  });

  it('runs every mandatory validation command as an independent step', () => {
    const commands = runCommands(readCiWorkflow());
    expect(commands).toEqual(expect.arrayContaining([...MANDATORY_COMMANDS]));
    expect(new Set(commands).size).toBe(commands.length);
  });

  it('does not enable continue-on-error for mandatory validation', () => {
    expect(uncommentedSource(readCiWorkflow())).not.toMatch(/continue-on-error:/);
  });

  it('does not fail-open mandatory commands with || true', () => {
    expect(uncommentedSource(readCiWorkflow())).not.toMatch(/\|\|\s*true/);
  });
});

describe('security workflow contract', () => {
  it('has a committed GitHub Actions workflow at .github/workflows/security.yml', () => {
    expect(existsSync(securityWorkflowPath)).toBe(true);
  });

  it('triggers on pull_request, push to main, and workflow_dispatch', () => {
    const onBlock = topLevelBlock(readWorkflow(securityWorkflowPath), 'on');
    expect(onBlock).toMatch(/^\s+pull_request:\s*(\{\}\s*)?$/m);
    expect(onBlock).toMatch(/^\s+push:\s*$/m);
    expect(onBlock).toMatch(/^\s+-\s+main\s*$/m);
    expect(onBlock).toMatch(/^\s+workflow_dispatch:\s*(\{\}\s*)?$/m);
  });

  it('does not use pull_request_target', () => {
    expect(uncommentedSource(readWorkflow(securityWorkflowPath))).not.toMatch(
      /pull_request_target/,
    );
  });

  it('declares read-only contents permissions and persist-credentials false', () => {
    const source = uncommentedSource(readWorkflow(securityWorkflowPath));
    expect(topLevelBlock(readWorkflow(securityWorkflowPath), 'permissions')).toMatch(
      /^\s+contents:\s+read\s*$/m,
    );
    expect(hasWritePermissions(source)).toBe(false);
    expectFullHistoryCheckout(source);
  });

  it('sets up Node 22 on ubuntu-latest with official actions', () => {
    const source = uncommentedSource(readWorkflow(securityWorkflowPath));
    expect(source).toMatch(/^\s+runs-on:\s+ubuntu-latest\s*$/m);
    expect(usesActions(source)).toEqual(
      expect.arrayContaining(['actions/checkout@v4', 'actions/setup-node@v4']),
    );
    expect(source).toMatch(/^\s+node-version:\s+['"]?22['"]?\s*$/m);
    expect(source).toMatch(/^\s+cache:\s+npm\s*$/m);
    expect(source).toMatch(/^\s+cache-dependency-path:\s+package-lock\.json\s*$/m);
  });

  it('runs public-boundary, dependency-boundary, npm audit, and CycloneDX SBOM commands', () => {
    const commands = runCommands(readWorkflow(securityWorkflowPath));
    expect(commands).toEqual(expect.arrayContaining([...SECURITY_COMMANDS]));
  });

  it('validates the generated CycloneDX SBOM as non-empty JSON', () => {
    const commands = runCommands(readWorkflow(securityWorkflowPath));
    expect(
      commands.some(
        (command) =>
          command.includes('sceneready-sbom.cdx.json') &&
          command.includes('JSON.parse') &&
          command.includes('CycloneDX'),
      ),
    ).toBe(true);
  });

  it('uploads sceneready-security-evidence and fails if the artifact is missing', () => {
    const source = uncommentedSource(readWorkflow(securityWorkflowPath));
    expect(usesActions(source)).toEqual(expect.arrayContaining(['actions/upload-artifact@v4']));
    expect(source).toMatch(/^\s+name:\s+sceneready-security-evidence\s*$/m);
    expect(source).toMatch(/^\s+path:\s+sceneready-sbom\.cdx\.json\s*$/m);
    expect(source).toMatch(/^\s+if-no-files-found:\s+error\s*$/m);
  });

  it('keeps mandatory security gates fail-closed', () => {
    const source = uncommentedSource(readWorkflow(securityWorkflowPath));
    expect(source).not.toMatch(/continue-on-error:/);
    expect(source).not.toMatch(/\|\|\s*true/);
    expect(source).not.toMatch(/if:\s*always\(\)/);
  });
});

describe('release-audit workflow contract', () => {
  it('has a committed GitHub Actions workflow at .github/workflows/release-audit.yml', () => {
    expect(existsSync(releaseAuditWorkflowPath)).toBe(true);
  });

  it('is a manual workflow_dispatch baseline certification workflow', () => {
    const onBlock = topLevelBlock(readWorkflow(releaseAuditWorkflowPath), 'on');
    expect(onBlock).toMatch(/^\s*workflow_dispatch:\s*(\{\}\s*)?$/m);
    expect(onBlock).not.toMatch(/pull_request/);
    expect(onBlock).not.toMatch(/push:/);
  });

  it('declares read-only contents permissions and persist-credentials false', () => {
    const source = uncommentedSource(readWorkflow(releaseAuditWorkflowPath));
    expect(topLevelBlock(readWorkflow(releaseAuditWorkflowPath), 'permissions')).toMatch(
      /^\s+contents:\s+read\s*$/m,
    );
    expect(hasWritePermissions(source)).toBe(false);
    expectFullHistoryCheckout(source);
  });

  it('sets up Node 22 on ubuntu-latest with official actions', () => {
    const source = uncommentedSource(readWorkflow(releaseAuditWorkflowPath));
    expect(source).toMatch(/^\s+runs-on:\s+ubuntu-latest\s*$/m);
    expect(usesActions(source)).toEqual(
      expect.arrayContaining(['actions/checkout@v4', 'actions/setup-node@v4']),
    );
    expect(source).toMatch(/^\s+node-version:\s+['"]?22['"]?\s*$/m);
  });

  it('runs real current validation, boundary, audit, and CycloneDX commands', () => {
    const commands = runCommands(readWorkflow(releaseAuditWorkflowPath));
    expect(commands).toEqual(expect.arrayContaining([...RELEASE_AUDIT_COMMANDS]));
    expect(
      commands.some(
        (command) =>
          command.includes('sceneready-sbom.cdx.json') &&
          command.includes('JSON.parse') &&
          command.includes('CycloneDX'),
      ),
    ).toBe(true);
  });

  it('does not invoke future no-op script names', () => {
    const commands = runCommands(readWorkflow(releaseAuditWorkflowPath)).join('\n');
    for (const command of FUTURE_NOOP_COMMANDS) {
      expect(commands).not.toContain(command);
    }
  });

  it('does not deploy or use AWS credentials', () => {
    const source = uncommentedSource(readWorkflow(releaseAuditWorkflowPath));
    expect(source).not.toMatch(/aws-actions\//);
    expect(source).not.toMatch(/aws\s+deploy/);
    expect(source).not.toMatch(/cdk\s+deploy/);
    expect(usesActions(source).some((action) => action.startsWith('aws-actions/'))).toBe(false);
    expect(runCommands(source).some((command) => /\bdeploy\b/.test(command))).toBe(false);
  });

  it('uploads sceneready-baseline-release-audit and fails if the artifact is missing', () => {
    const source = uncommentedSource(readWorkflow(releaseAuditWorkflowPath));
    expect(usesActions(source)).toEqual(expect.arrayContaining(['actions/upload-artifact@v4']));
    expect(source).toMatch(/^\s+name:\s+sceneready-baseline-release-audit\s*$/m);
    expect(source).toMatch(/^\s+path:\s+sceneready-sbom\.cdx\.json\s*$/m);
    expect(source).toMatch(/^\s+if-no-files-found:\s+error\s*$/m);
  });

  it('keeps mandatory release-audit gates fail-closed', () => {
    const source = uncommentedSource(readWorkflow(releaseAuditWorkflowPath));
    expect(source).not.toMatch(/continue-on-error:/);
    expect(source).not.toMatch(/\|\|\s*true/);
  });
});

describe('submission evidence documents', () => {
  it('has CLAIM-TO-EVIDENCE with the exact required columns', () => {
    expect(existsSync(claimToEvidencePath)).toBe(true);
    const text = readFileSync(claimToEvidencePath, 'utf8');
    expect(text).toMatch(
      /^\| Claim \| Implementation \| Test \| Live proof \| Submission use \|$/m,
    );
  });

  it('does not add unsupported product claims and keeps live proof pending', () => {
    const text = readFileSync(claimToEvidencePath, 'utf8');
    expect(text).not.toMatch(/production readiness graph exists/i);
    expect(text).not.toMatch(/Bedrock reasoning exists/i);
    expect(text).not.toMatch(/Alexa integration exists/i);
    expect(text).not.toMatch(/AWS deployment exists/i);
    expect(text).not.toMatch(/human approval exists/i);
    expect(text).toMatch(/PENDING FIRST PUBLIC CI RUN/);
  });

  it('states clean-room public-ready status without claiming public publication', () => {
    const text = readFileSync(claimToEvidencePath, 'utf8');
    expect(text).toMatch(/clean-room public-ready competition repository/i);
    expect(text).not.toMatch(/SceneReady is a clean-room public project/);
    expect(text).toMatch(/local\/canonical repository/i);
    expect(text).toMatch(/Public GitHub publication/i);
  });

  it('has a friction log with required future entry fields and no invented Amazon/AWS entry', () => {
    expect(existsSync(frictionLogPath)).toBe(true);
    const text = readFileSync(frictionLogPath, 'utf8');
    for (const field of FRICTION_ENTRY_FIELDS) {
      expect(text).toContain(field);
    }
    expect(text).toMatch(/append-only/i);
    expect(text).toMatch(/no qualifying Amazon\/AWS friction entry has yet been recorded/i);
  });
});

describe('dependency rules documentation truth', () => {
  it('documents current GitHub workflows without stale future-CI wording', () => {
    expect(existsSync(dependencyRulesPath)).toBe(true);
    const text = readFileSync(dependencyRulesPath, 'utf8');
    expect(text).toContain('.github/workflows/ci.yml');
    expect(text).toContain('.github/workflows/security.yml');
    expect(text).toContain('.github/workflows/release-audit.yml');
    expect(text).not.toMatch(/SR-00D will wire/i);
    expect(text).not.toMatch(/does not currently claim that those GitHub workflows exist/i);
    expect(text).toMatch(/PENDING FIRST PUBLIC CI RUN/);
    expect(text).not.toMatch(/remote GitHub (?:run|execution) (?:succeeded|success|passed)/i);
    expect(text).not.toMatch(/first public CI run (?:succeeded|passed)/i);
  });
});
