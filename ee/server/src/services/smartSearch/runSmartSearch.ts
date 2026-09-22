/**
 * The smart search runner: enumerate the scoped set, build candidate JSON,
 * score batches through TypeSafe with bounded concurrency, and yield events as
 * batches complete. The SSE route turns each event into a frame. Everything
 * entity-specific comes through the definition.
 *
 * Failure policy: one batch failing after the SDK's retries does not end the
 * search. Its rows are reported as unscored and the rest continue. Errors
 * before the first batch (permission, key, database) throw so the route can
 * answer with a status code instead of a half-open stream. A client that goes
 * away aborts every pending request and ends the generator silently.
 */

import { randomUUID } from 'node:crypto';
import { APIUserAbortError } from '@typesafe-ai/sdk';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import type { SmartSearchEvent, SmartSearchScoredItem } from '@alga-psa/ui/lib/smartSearch/types';
import { isActionMessageError, isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';

import { SMART_SEARCH_BUDGETS } from './budgets';
import type { SmartSearchCandidate } from './candidate';
import type { SmartSearchEntityDefinition } from './entityDefinition';
import { packCandidateBatches, scoreBatch, type ScoredBatch } from './scoreBatch';
import { resolveTypeSafeClient } from './typesafeClient';

export class SmartSearchNotConfiguredError extends Error {
  readonly code = 'SMART_SEARCH_NOT_CONFIGURED' as const;
  constructor() {
    super('Smart search is not configured: TYPESAFE_API_KEY is not set.');
    this.name = 'SmartSearchNotConfiguredError';
  }
}

export class SmartSearchForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SmartSearchForbiddenError';
  }
}

export interface RunSmartSearchInput<TScope, TRow, TMetadata> {
  definition: SmartSearchEntityDefinition<TScope, TRow, TMetadata>;
  tenant: string;
  user: IUserWithRoles;
  scope: TScope;
  query: string;
  signal: AbortSignal;
}

/**
 * A counting semaphore. One instance per process caps TypeSafe requests across
 * every concurrent search so a single tenant cannot spend the account's whole
 * request budget. Per-pod in a multi-replica deployment; the SDK's Retry-After
 * handling is the true backstop, this smooths bursts.
 */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly capacity: number) {
    this.available = capacity;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new APIUserAbortError();
    }
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(wake);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new APIUserAbortError());
      };
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(wake);
    });
    this.available -= 1;
    return () => this.release();
  }

  private release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }

  get inUse(): number {
    return this.capacity - this.available;
  }
}

const processSemaphore = new Semaphore(SMART_SEARCH_BUDGETS.inflightPerProcess);

/** Test seam: how many TypeSafe requests the process currently holds open. */
export function smartSearchInflightRequests(): number {
  return processSemaphore.inUse;
}

type BatchOutcome =
  | { kind: 'scored'; batch: SmartSearchCandidate[]; result: ScoredBatch }
  | { kind: 'failed'; ids: string[]; reason: string };

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? `${error.name} (${status}): ${error.message}` : `${error.name}: ${error.message}`;
  }
  return String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof APIUserAbortError || (error instanceof Error && error.name === 'AbortError');
}

export async function* runSmartSearch<TScope, TRow, TMetadata>(
  input: RunSmartSearchInput<TScope, TRow, TMetadata>
): AsyncGenerator<SmartSearchEvent<TRow, TMetadata>> {
  const { definition, tenant, user, query, signal } = input;
  const label = `[smart-search:${definition.entity}]`;
  const startedAt = Date.now();
  const searchId = randomUUID();

  const client = await resolveTypeSafeClient();
  if (!client) {
    throw new SmartSearchNotConfiguredError();
  }

  // The typed text is the Jev query only; the candidate set is the scope alone.
  const scope = definition.normalizeScope(input.scope);
  const enumerated = await definition.enumerate(scope);
  if (isActionPermissionError(enumerated)) {
    throw new SmartSearchForbiddenError(getErrorMessage(enumerated));
  }
  if (isActionMessageError(enumerated)) {
    throw new Error(getErrorMessage(enumerated));
  }
  const ids = enumerated as string[];
  const total = ids.length;

  yield { type: 'started', searchId, total };

  let scored = 0;
  let failed = 0;
  let requests = 0;
  let inputTokens = 0;
  let model: string | null = null;

  if (total === 0) {
    yield { type: 'done', total, scored, failed, requests, inputTokens, model, durationMs: Date.now() - startedAt };
    return;
  }

  const { knex } = await createTenantKnex();

  // Candidate loading happens in chunks so the first TypeSafe request leaves
  // before the last row's text has been read from the database.
  const loadChunk = async (chunk: string[]): Promise<SmartSearchCandidate[]> =>
    withTransaction(knex, (trx) => definition.loadCandidates(trx, tenant, user, chunk));

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += SMART_SEARCH_BUDGETS.candidateLoadChunk) {
    chunks.push(ids.slice(i, i + SMART_SEARCH_BUDGETS.candidateLoadChunk));
  }

  // Outcomes are delivered through a queue so the generator can yield them in
  // completion order while the pool keeps `inflightPerSearch` requests open.
  const outcomes: BatchOutcome[] = [];
  let pendingBatches = 0;
  let producerDone = false;
  let producerError: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const waitForOutcome = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });

  const searchSemaphore = new Semaphore(SMART_SEARCH_BUDGETS.inflightPerSearch);

  const runBatch = async (batch: SmartSearchCandidate[]): Promise<void> => {
    let releaseSearch: (() => void) | null = null;
    let releaseProcess: (() => void) | null = null;
    try {
      releaseSearch = await searchSemaphore.acquire(signal);
      releaseProcess = await processSemaphore.acquire(signal);
      requests += 1;
      const result = await scoreBatch(client, definition.relevance, query, batch, signal);
      outcomes.push({ kind: 'scored', batch, result });
    } catch (error) {
      if (isAbort(error) || signal.aborted) {
        return;
      }
      logger.error(`${label} batch failed`, {
        tenant,
        searchId,
        candidates: batch.length,
        approxTokens: batch.reduce((sum, candidate) => sum + candidate.approxTokens, 0),
        error: describeError(error),
      });
      outcomes.push({ kind: 'failed', ids: batch.map((candidate) => candidate.id), reason: describeError(error) });
    } finally {
      releaseProcess?.();
      releaseSearch?.();
      pendingBatches -= 1;
      notify();
    }
  };

  const producer = (async () => {
    try {
      const seen = new Set<string>();
      for (const chunk of chunks) {
        if (signal.aborted) {
          return;
        }
        const candidates = await loadChunk(chunk);
        for (const candidate of candidates) {
          seen.add(candidate.id);
        }
        const missing = chunk.filter((id) => !seen.has(id));
        if (missing.length > 0) {
          outcomes.push({ kind: 'failed', ids: missing, reason: `${capitalize(definition.entity)} text could not be loaded` });
          notify();
        }
        for (const batch of packCandidateBatches(candidates)) {
          pendingBatches += 1;
          void runBatch(batch);
        }
      }
    } catch (error) {
      producerError = error;
    } finally {
      producerDone = true;
      notify();
    }
  })();

  try {
    while (true) {
      if (signal.aborted) {
        return;
      }
      const outcome = outcomes.shift();
      if (outcome) {
        if (outcome.kind === 'scored') {
          model = outcome.result.model;
          inputTokens += outcome.result.inputTokens;
          const hydrated = await definition.hydrateRows(
            scope,
            outcome.result.scores.map((entry) => entry.id)
          );
          if (isActionMessageError(hydrated) || isActionPermissionError(hydrated)) {
            throw new Error(getErrorMessage(hydrated));
          }
          const byId = new Map(hydrated.rows.map((row) => [definition.rowId(row), row] as const));
          const items: SmartSearchScoredItem<TRow>[] = [];
          const missing: string[] = [];
          for (const entry of outcome.result.scores) {
            const row = byId.get(entry.id);
            if (row) {
              items.push({ row, score: entry.score, bucket: entry.bucket });
            } else {
              missing.push(entry.id);
            }
          }
          if (items.length > 0) {
            scored += items.length;
            yield { type: 'scored', items, metadata: hydrated.metadata, scored };
          }
          if (missing.length > 0) {
            failed += missing.length;
            yield { type: 'batch_failed', ids: missing, reason: `${capitalize(definition.entity)} row no longer visible`, failed };
          }
        } else {
          failed += outcome.ids.length;
          yield { type: 'batch_failed', ids: outcome.ids, reason: outcome.reason, failed };
        }
        continue;
      }
      if (producerError) {
        throw producerError;
      }
      if (producerDone && pendingBatches === 0) {
        break;
      }
      await waitForOutcome();
    }
  } finally {
    await producer.catch(() => undefined);
  }

  const durationMs = Date.now() - startedAt;
  logger.info(`${label} completed`, {
    tenant,
    userId: user.user_id,
    searchId,
    queryLength: query.length,
    total,
    scored,
    failed,
    requests,
    inputTokens,
    model,
    durationMs,
  });
  yield { type: 'done', total, scored, failed, requests, inputTokens, model, durationMs };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
