/**
 * Read-only error detection for Citus/Patroni HA setups behind PgBouncer.
 *
 * PgBouncer transaction-pooling occasionally hands out a backend connection
 * that has become read-only (e.g., after a Patroni failover the backend is
 * now attached to what used to be the leader and is now a standby). The
 * process-cached pool's own probe can pass on those connections, so the
 * actual write fails later with one of these errors:
 *   - "cannot execute UPDATE in a read-only transaction"
 *   - "writing to worker nodes is not currently allowed" (Citus distributed table)
 *   - any other "... in a read-only ..." variant
 *
 * Callers use isReadOnlyError() to detect the pattern, then refresh their
 * connection pool and retry once.
 */

export const READ_ONLY_ERROR_RE =
  /read-only transaction|writing to worker nodes|cannot execute [A-Z]+ in a read-only/i;

export function isReadOnlyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return READ_ONLY_ERROR_RE.test(msg);
}

/**
 * Run an operation, and if it fails with a read-only error refresh the
 * tenant pool and retry once. For tenant-pool callers that don't fit the
 * single-transaction shape of withTenantTransactionRetryReadOnly (e.g.
 * code that issues multiple separate queries inside runWithTenant).
 *
 * The refresh callback is injected so the helper has no static dependency
 * on the tenant module; @alga-psa/db's index re-exports a wired-up
 * `retryOnTenantReadOnly` that uses refreshTenantConnection.
 */
export async function retryOnReadOnly<T>(
  op: () => Promise<T>,
  refresh: () => Promise<unknown>,
  context?: { logLabel?: string; logger?: { warn: (msg: string, meta?: unknown) => void } }
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isReadOnlyError(err)) throw err;
    context?.logger?.warn(
      `[${context.logLabel ?? 'pool'}] connection pool returned a read-only connection; refreshing and retrying once`,
      { error: err instanceof Error ? err.message : String(err) }
    );
    await refresh();
    return await op();
  }
}
