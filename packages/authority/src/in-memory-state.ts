import {
  authorizeMutation,
  authoritativeScopeKey,
  readAuthoritativeScope,
  readAuthoritativeSnapshot,
} from './concurrency.js';
import {
  deriveDurableOutboxJobs,
  type DurableOutboxJob,
  type RevisionAppliedEvent,
} from './ledger.js';
import { AuthorityBoundaryError, readCanonicalInstant } from './session.js';
import type {
  ApprovedRevisionCommand,
  ApprovedRevisionResult,
  AuthoritativeScope,
  AuthoritativeSnapshot,
  AuthoritativeStateRepository,
  ConditionalRevisionCommand,
  ConditionalRevisionResult,
  MutationDenialReason,
} from './state-ports.js';

interface StoredProduction {
  readonly snapshot: AuthoritativeSnapshot;
  readonly consumedTokenIds: ReadonlySet<string>;
  readonly ledger: readonly RevisionAppliedEvent[];
  readonly outbox: readonly DurableOutboxJob[];
}

interface CommitEffects {
  readonly ledgerEvent: RevisionAppliedEvent | null;
  readonly outboxJobs: readonly DurableOutboxJob[];
}

function fail(code: string, message: string): never {
  throw new AuthorityBoundaryError(code, message);
}

function deepFreeze(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

export function cloneAuthoritativeState(state: unknown): unknown {
  if (state === undefined) {
    fail('INVALID_STATE', 'production state is required');
  }
  try {
    return deepFreeze(structuredClone(state), new WeakSet());
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown clone failure';
    fail('INVALID_STATE', `production state must be a structured cloneable value: ${detail}`);
  }
}

function freezeSnapshot(snapshot: AuthoritativeSnapshot): AuthoritativeSnapshot {
  const read = readAuthoritativeSnapshot(snapshot);
  return Object.freeze({
    ...read,
    productionState: cloneAuthoritativeState(read.productionState),
  });
}

function denial(reason: MutationDenialReason): ConditionalRevisionResult {
  return Object.freeze({
    status: 'DENIED',
    reason,
    productionRevision: null,
    graphRevision: null,
    productionState: null,
    tokenId: null,
  });
}

const NO_OUTBOX_JOBS: readonly [] = Object.freeze([]);

function denyApproved(reason: MutationDenialReason): ApprovedRevisionResult {
  return Object.freeze({
    status: 'DENIED',
    reason,
    productionRevision: null,
    graphRevision: null,
    productionState: null,
    tokenId: null,
    ledgerEvent: null,
    outboxJobs: NO_OUTBOX_JOBS,
  });
}

export class InMemoryAuthoritativeState implements AuthoritativeStateRepository {
  private readonly records = new Map<string, StoredProduction>();
  private readonly tails = new Map<string, Promise<void>>();
  private commitFailure: Error | null = null;

  failBeforeNextCommit(error: Error): void {
    this.commitFailure = error;
  }

  async read(scope: AuthoritativeScope): Promise<AuthoritativeSnapshot | null> {
    const read = readAuthoritativeScope(scope);
    const key = authoritativeScopeKey(read);
    return this.exclusive(key, async () => this.records.get(key)?.snapshot ?? null);
  }

  async seed(snapshot: AuthoritativeSnapshot): Promise<void> {
    const frozen = freezeSnapshot(snapshot);
    const key = authoritativeScopeKey(frozen);
    await this.exclusive(key, async () => {
      if (this.records.has(key)) {
        fail('PRODUCTION_ALREADY_SEEDED', 'production scope is already seeded');
      }
      this.records.set(
        key,
        Object.freeze({
          snapshot: frozen,
          consumedTokenIds: new Set<string>(),
          ledger: Object.freeze([]),
          outbox: Object.freeze([]),
        }),
      );
    });
  }

  async noteGraphRevision(scope: AuthoritativeScope, graphRevision: number): Promise<void> {
    const read = readAuthoritativeScope(scope);
    if (!Number.isSafeInteger(graphRevision) || graphRevision < 0) {
      fail('INVALID_REVISION', 'graph revision must be a non-negative safe integer');
    }
    const key = authoritativeScopeKey(read);
    await this.exclusive(key, async () => {
      const stored = this.records.get(key);
      if (stored === undefined) {
        fail('UNKNOWN_PRODUCTION', 'production is not seeded');
      }
      if (graphRevision < stored.snapshot.graphRevision) {
        fail('GRAPH_REVISION_REGRESSION', 'graph revision cannot move backwards');
      }
      if (graphRevision === stored.snapshot.graphRevision) {
        return;
      }
      this.records.set(
        key,
        Object.freeze({
          snapshot: Object.freeze({
            ...stored.snapshot,
            graphRevision,
          }),
          consumedTokenIds: stored.consumedTokenIds,
          ledger: stored.ledger,
          outbox: stored.outbox,
        }),
      );
    });
  }

  async consumedTokenIds(scope: AuthoritativeScope): Promise<readonly string[]> {
    const read = readAuthoritativeScope(scope);
    const key = authoritativeScopeKey(read);
    return this.exclusive(key, async () => {
      const stored = this.records.get(key);
      return Object.freeze(stored === undefined ? [] : [...stored.consumedTokenIds]);
    });
  }

  async readLedger(scope: AuthoritativeScope): Promise<readonly RevisionAppliedEvent[]> {
    const read = readAuthoritativeScope(scope);
    const key = authoritativeScopeKey(read);
    return this.exclusive(key, async () => this.records.get(key)?.ledger ?? Object.freeze([]));
  }

  async readOutbox(scope: AuthoritativeScope): Promise<readonly DurableOutboxJob[]> {
    const read = readAuthoritativeScope(scope);
    const key = authoritativeScopeKey(read);
    return this.exclusive(key, async () => this.records.get(key)?.outbox ?? Object.freeze([]));
  }

  async applyApprovedProductionRevision(
    command: ApprovedRevisionCommand,
  ): Promise<ApprovedRevisionResult> {
    const scope = readAuthoritativeScope(command.scope);
    const key = authoritativeScopeKey(scope);
    return this.exclusive(key, async () => {
      const decision = await authorizeMutation({ ...command, scope });
      if (!decision.ok) {
        return denyApproved(decision.reason);
      }
      if (
        typeof command.executionId !== 'string' ||
        command.executionId.length === 0 ||
        typeof command.ledgerEventId !== 'string' ||
        command.ledgerEventId.length === 0
      ) {
        return denyApproved('INVALID_EXECUTION_IDENTITY');
      }
      const planned = deriveDurableOutboxJobs(
        command.executionId,
        command.proposal.notificationPayloads,
      );
      if (!planned.ok) {
        return denyApproved(planned.reason);
      }
      const productionRevision = decision.claims.baseProductionRevision + 1;
      if (!Number.isSafeInteger(productionRevision)) {
        fail('INVALID_REVISION', 'production revision cannot advance past the safe integer range');
      }
      const ledgerEvent = Object.freeze({
        ledgerEventId: command.ledgerEventId,
        kind: 'REVISION_APPLIED' as const,
        executionId: command.executionId,
        accountId: scope.accountId,
        productionId: scope.productionId,
        authorityNamespace: scope.authorityNamespace,
        proposalId: decision.claims.proposalId,
        proposalFingerprint: decision.claims.proposalFingerprint,
        tokenId: decision.claims.tokenId,
        previousProductionRevision: decision.claims.baseProductionRevision,
        productionRevision,
        graphRevision: decision.claims.baseGraphRevision,
        appliedAt: readCanonicalInstant(command.now),
      });
      const committed = this.commitUnlocked(
        key,
        scope,
        {
          expectedProductionRevision: decision.claims.baseProductionRevision,
          expectedGraphRevision: decision.claims.baseGraphRevision,
          tokenId: decision.claims.tokenId,
          nextProductionState: command.nextProductionState,
        },
        { ledgerEvent, outboxJobs: planned.jobs },
      );
      if (committed.status === 'DENIED') {
        return denyApproved(committed.reason);
      }
      return Object.freeze({
        status: 'APPLIED',
        reason: null,
        productionRevision: committed.productionRevision,
        graphRevision: committed.graphRevision,
        productionState: committed.productionState,
        tokenId: committed.tokenId,
        ledgerEvent,
        outboxJobs: planned.jobs,
      });
    });
  }

  async applyConditionalRevision(
    command: ConditionalRevisionCommand,
  ): Promise<ConditionalRevisionResult> {
    const scope = readAuthoritativeScope(command.scope);
    const key = authoritativeScopeKey(scope);
    return this.exclusive(key, async () => {
      const decision = await authorizeMutation({ ...command, scope });
      if (!decision.ok) {
        return denial(decision.reason);
      }
      return this.commitUnlocked(key, scope, {
        expectedProductionRevision: decision.claims.baseProductionRevision,
        expectedGraphRevision: decision.claims.baseGraphRevision,
        tokenId: decision.claims.tokenId,
        nextProductionState: command.nextProductionState,
      });
    });
  }

  private commitUnlocked(
    key: string,
    scope: AuthoritativeScope,
    commit: {
      readonly expectedProductionRevision: number;
      readonly expectedGraphRevision: number;
      readonly tokenId: string;
      readonly nextProductionState: unknown;
    },
    effects: CommitEffects = { ledgerEvent: null, outboxJobs: [] },
  ): ConditionalRevisionResult {
    if (typeof commit.tokenId !== 'string' || commit.tokenId.length === 0) {
      fail('INVALID_TOKEN', 'tokenId must be a non-empty string');
    }
    if (
      !Number.isSafeInteger(commit.expectedProductionRevision) ||
      commit.expectedProductionRevision < 0 ||
      !Number.isSafeInteger(commit.expectedGraphRevision) ||
      commit.expectedGraphRevision < 0
    ) {
      fail('INVALID_REVISION', 'expected revisions must be non-negative safe integers');
    }
    const stored = this.records.get(key);
    if (stored === undefined) {
      return denial('UNKNOWN_PRODUCTION');
    }
    if (
      stored.snapshot.accountId !== scope.accountId ||
      stored.snapshot.productionId !== scope.productionId ||
      stored.snapshot.authorityNamespace !== scope.authorityNamespace
    ) {
      fail('INVALID_SCOPE', 'stored production scope does not match the commit scope');
    }
    if (stored.consumedTokenIds.has(commit.tokenId)) {
      return denial('APPROVAL_ALREADY_CONSUMED');
    }
    if (
      stored.snapshot.productionRevision !== commit.expectedProductionRevision ||
      stored.snapshot.graphRevision !== commit.expectedGraphRevision
    ) {
      return denial('BASE_REVISION_STALE');
    }
    const productionRevision = stored.snapshot.productionRevision + 1;
    if (!Number.isSafeInteger(productionRevision)) {
      fail('INVALID_REVISION', 'production revision cannot advance past the safe integer range');
    }
    if (
      effects.ledgerEvent !== null &&
      stored.ledger.some((event) => event.ledgerEventId === effects.ledgerEvent?.ledgerEventId)
    ) {
      return denial('LEDGER_EVENT_ID_REUSED');
    }
    const existingJobIds = new Set(stored.outbox.map((job) => job.idempotencyKey));
    if (effects.outboxJobs.some((job) => existingJobIds.has(job.idempotencyKey))) {
      return denial('OUTBOX_IDENTITY_REUSED');
    }
    if (this.commitFailure !== null) {
      const error = this.commitFailure;
      this.commitFailure = null;
      throw error;
    }
    const nextState = cloneAuthoritativeState(commit.nextProductionState);
    const consumedTokenIds = new Set(stored.consumedTokenIds);
    consumedTokenIds.add(commit.tokenId);
    const snapshot = Object.freeze({
      accountId: stored.snapshot.accountId,
      productionId: stored.snapshot.productionId,
      authorityNamespace: stored.snapshot.authorityNamespace,
      productionRevision,
      graphRevision: stored.snapshot.graphRevision,
      productionState: nextState,
    });
    this.records.set(
      key,
      Object.freeze({
        snapshot,
        consumedTokenIds,
        ledger:
          effects.ledgerEvent === null
            ? stored.ledger
            : Object.freeze([...stored.ledger, effects.ledgerEvent]),
        outbox:
          effects.outboxJobs.length === 0
            ? stored.outbox
            : Object.freeze([...stored.outbox, ...effects.outboxJobs]),
      }),
    );
    return Object.freeze({
      status: 'APPLIED',
      reason: null,
      productionRevision,
      graphRevision: snapshot.graphRevision,
      productionState: snapshot.productionState,
      tokenId: commit.tokenId,
    });
  }

  private async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}
