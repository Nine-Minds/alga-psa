/**
 * @alga-psa/db - After-commit hooks
 *
 * registerAfterCommit(trx, hook) queues work (event publishing, backend
 * scheduling — anything that must not run inside an open transaction) to run
 * once the transaction that owns `trx` commits. The owning withTransaction /
 * withTenantTransactionRetryReadOnly frame flushes the queue after
 * knex.transaction() resolves and before returning to its caller; on
 * rollback the queue is dropped untouched.
 *
 * Hooks may use the root connection supplied by the owning wrapper for durable
 * post-commit work. A manually flushed hook may omit it; durable recovery must
 * remain possible without an immediate dispatch.
 *
 * Nested withTransaction frames share the caller's `trx` object, so hooks
 * registered anywhere in the nesting attach to the same queue and flush
 * exactly once, when the outermost (owning) frame commits.
 */

import type { Knex as KnexType } from './knex-turbopack';
import logger from '@alga-psa/core/logger';

export type AfterCommitHook = () => void | Promise<void>;

type HookEntry = ({ hook: AfterCommitHook } | { connectionHook: (rootConnection: KnexType) => void | Promise<void> }) & { label?: string };

const afterCommitHooks = new WeakMap<object, HookEntry[]>();

/**
 * `label` identifies the hook in the failure log (e.g. "TICKET_CLOSED
 * ticket=<id>"); without it a failed hook is untraceable.
 */
export function registerAfterCommit(
  trx: KnexType.Transaction,
  hook: AfterCommitHook,
  label?: string
): void {
  addHook(trx, { hook, label });
}

/** Explicit opt-in: ordinary hooks keep their zero-argument contract. A
 * manual flush without a root connection leaves immediate delivery to recovery. */
export function registerAfterCommitWithConnection(trx: KnexType.Transaction, connectionHook: (rootConnection: KnexType) => void | Promise<void>, label?: string): void {
  addHook(trx, { connectionHook, label });
}

function addHook(trx: object, entry: HookEntry): void {
  const hooks = afterCommitHooks.get(trx);
  if (hooks) {
    hooks.push(entry);
  } else {
    afterCommitHooks.set(trx, [entry]);
  }
}

/** A released savepoint is not a commit. Transfer its hooks to the transaction
 * that owns the eventual commit; omit parent to discard rolled-back work. */
export function settleSavepointHooks(savepoint: object, parent?: object): void {
  const hooks = afterCommitHooks.get(savepoint);
  afterCommitHooks.delete(savepoint);
  if (parent && hooks) for (const entry of hooks) addHook(parent, entry);
}

/**
 * Run and clear the hooks queued on `trx`, in registration order. Only the
 * transaction-owning frame may call this, and only after a successful
 * commit. Hook failures are logged and swallowed: the transaction is already
 * committed, so a failing hook must not fail the operation or stop the
 * remaining hooks.
 */
export async function flushAfterCommitHooks(trx: object, rootConnection?: KnexType): Promise<void> {
  const hooks = afterCommitHooks.get(trx);
  if (!hooks?.length) {
    return;
  }
  afterCommitHooks.delete(trx);

  for (const entry of hooks) {
    try {
      if ('connectionHook' in entry) { if (rootConnection) await entry.connectionHook(rootConnection); }
      else await entry.hook();
    } catch (error) {
      logger.error('[db/afterCommit] after-commit hook failed', {
        label: entry.label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
