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
 * Nested withTransaction frames share the caller's `trx` object, so hooks
 * registered anywhere in the nesting attach to the same queue and flush
 * exactly once, when the outermost (owning) frame commits.
 */

import type { Knex as KnexType } from './knex-turbopack';
import logger from '@alga-psa/core/logger';

export type AfterCommitHook = () => void | Promise<void>;

interface HookEntry {
  hook: AfterCommitHook;
  label?: string;
}

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
  const entry: HookEntry = { hook, label };
  const hooks = afterCommitHooks.get(trx);
  if (hooks) {
    hooks.push(entry);
  } else {
    afterCommitHooks.set(trx, [entry]);
  }
}

/**
 * Run and clear the hooks queued on `trx`, in registration order. Only the
 * transaction-owning frame may call this, and only after a successful
 * commit. Hook failures are logged and swallowed: the transaction is already
 * committed, so a failing hook must not fail the operation or stop the
 * remaining hooks.
 */
export async function flushAfterCommitHooks(trx: object): Promise<void> {
  const hooks = afterCommitHooks.get(trx);
  if (!hooks?.length) {
    return;
  }
  afterCommitHooks.delete(trx);

  for (const { hook, label } of hooks) {
    try {
      await hook();
    } catch (error) {
      logger.error('[db/afterCommit] after-commit hook failed', {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
