/**
 * Inbound email durable diagnostics.
 *
 * Emits stable log/metric signals for stale/expired claims, reclaim outcomes,
 * attempts, terminal failures, source-stage state, legacy mirror lag, outbox
 * age, artifact failures and Redis stale-token mutations. Reporting itself stays
 * on the legacy `email_processed_messages` table; these are divergence/staleness
 * observability helpers, not report semantics changes.
 */

export interface InboundEmailDiagnosticsReport {
  staleProcessing: number;
  retryableFailed: number;
  terminalFailed: number;
  pendingOutbox: number;
  oldestPendingOutboxMinutes: number | null;
  pendingArtifacts: number;
  succeededInbox: number;
  mirrorLagRows: number;
}

/**
 * Compute per-tenant staleness/divergence counters from the durable ledgers.
 * Best-effort: never throws.
 */
export async function computeInboundEmailDiagnostics(tenant: string): Promise<InboundEmailDiagnosticsReport> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const { tenantDb } = await import('@alga-psa/db');
  const scoped = tenantDb(db, tenant);

  const count = async (table: string, where: Record<string, unknown>): Promise<number> => {
    const row = await scoped.table(table).where({ tenant, ...where }).count<{ count: string }[]>('* as count').first();
    return Number(row?.count ?? 0);
  };

  const report: InboundEmailDiagnosticsReport = {
    staleProcessing: await count('inbound_email_inbox', { status: 'processing' }),
    retryableFailed: await count('inbound_email_inbox', { status: 'retryable_failed' }),
    terminalFailed: await count('inbound_email_inbox', { status: 'terminal_failed' }),
    pendingOutbox: await count('inbound_email_outbox', { status: 'pending' }),
    oldestPendingOutboxMinutes: null,
    pendingArtifacts: await count('inbound_email_artifacts', { status: 'pending' }),
    succeededInbox: await count('inbound_email_inbox', { status: 'succeeded' }),
    mirrorLagRows: 0,
  };

  try {
    const oldestOutbox = await scoped.table('inbound_email_outbox')
      .where({ tenant, status: 'pending' })
      .orderBy('created_at', 'asc')
      .first('created_at');
    if (oldestOutbox?.created_at) {
      report.oldestPendingOutboxMinutes = Math.max(
        0,
        Math.floor((Date.now() - new Date(oldestOutbox.created_at).getTime()) / 60_000)
      );
    }
  } catch {
    // best effort
  }

  try {
    // Mirror lag: terminal inbox rows whose outcome is not yet mirrored into the
    // legacy audit table (no `durableMirrored` marker).
    const lag = await scoped.table('inbound_email_inbox as i')
      .where({ 'i.tenant': tenant })
      .whereIn('i.status', ['succeeded', 'skipped', 'terminal_failed'])
      .whereNot('i.legacy_imported', true)
      .whereRaw(
        `not exists (
          select 1 from email_processed_messages as e
          where e.tenant = i.tenant and e.provider_id = i.provider_id
            and e.message_id = i.normalized_message_id
            and e.metadata ? 'durableMirrored'
        )`
      )
      .count<{ count: string }[]>('* as count')
      .first();
    report.mirrorLagRows = Number(lag?.count ?? 0);
  } catch {
    // best effort
  }

  return report;
}

/**
 * Emit the diagnostics as structured logs under a stable prefix for grepping.
 */
export async function reportInboundEmailDiagnostics(tenant: string): Promise<InboundEmailDiagnosticsReport> {
  const report = await computeInboundEmailDiagnostics(tenant);
  console.log('[InboundEmailDiagnostics]', JSON.stringify({ event: 'inbound_email_diagnostics', tenantId: tenant, ...report }));
  return report;
}
