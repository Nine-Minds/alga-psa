import type { NormalizedRmmAlertEvent, RmmAlertProcessingContext } from './contracts';
import { tenantDb } from '@alga-psa/db';
import { processRmmAlertEvent } from './processRmmAlertEvent';

/**
 * Marker stamped into the raw payload of poller-ingested alerts. Stale-alert
 * detection only trusts ids from its own ingest source: provider webhooks may
 * use a different alert id space than the provider's list-alerts API (NinjaOne
 * webhooks carry activity ids; its alerts API returns uids), and a false
 * "stale" verdict would close a ticket whose alert is still firing.
 */
export const RECONCILIATION_INGEST_MARKER = '__alga_ingest_source';

export interface RmmActiveAlertFetcher {
  /** Returns every currently-active alert in the RMM as a triggered event. */
  fetchActiveAlerts(args: { tenantId: string; integrationId: string }): Promise<NormalizedRmmAlertEvent[]>;
}

const fetchers = new Map<string, RmmActiveAlertFetcher>();

export function registerRmmAlertFetcher(provider: string, fetcher: RmmActiveAlertFetcher): void {
  fetchers.set(provider, fetcher);
}

export function getRmmAlertFetcher(provider: string): RmmActiveAlertFetcher | undefined {
  return fetchers.get(provider);
}

export interface ReconciliationResult {
  skipped: boolean;
  remoteActive: number;
  ingested: number;
  resetsSynthesized: number;
  warnings: string[];
}

/**
 * One reconciliation cycle for an integration, all through the normal
 * pipeline so rules, dedup, windows, and ticketing apply identically:
 *
 * 1. Active alerts in the RMM that webhooks missed become triggered events
 *    (dedup absorbs near-duplicates; still-suppressed alerts whose window
 *    ended re-enter processing via reprocessSuppressed).
 * 2. Poller-ingested local alerts no longer active in the RMM get synthesized
 *    resets — catching missed reset webhooks, the main source of stale
 *    tickets.
 */
export async function runRmmAlertReconciliation(
  ctx: RmmAlertProcessingContext,
  args: { tenantId: string; integrationId: string; provider: string }
): Promise<ReconciliationResult> {
  const warnings: string[] = [];
  const fetcher = getRmmAlertFetcher(args.provider);
  if (!fetcher) {
    return { skipped: true, remoteActive: 0, ingested: 0, resetsSynthesized: 0, warnings };
  }

  const remote = await fetcher.fetchActiveAlerts({
    tenantId: args.tenantId,
    integrationId: args.integrationId,
  });

  let ingested = 0;
  for (const event of remote) {
    const stamped: NormalizedRmmAlertEvent = {
      ...event,
      raw: { ...event.raw, [RECONCILIATION_INGEST_MARKER]: 'reconciliation' },
    };
    const result = await processRmmAlertEvent(ctx, stamped, { reprocessSuppressed: true });
    warnings.push(...result.warnings);
    if (result.outcome !== 'skipped') ingested += 1;
  }

  const remoteIds = new Set(remote.map((event) => event.externalAlertId));
  const db = tenantDb(ctx.knex, args.tenantId);
  const locals = await db.table('rmm_alerts')
    .where({ integration_id: args.integrationId })
    .whereIn('status', ['active', 'acknowledged', 'suppressed'])
    .select('external_alert_id', 'metadata');

  let resetsSynthesized = 0;
  const now = new Date().toISOString();
  for (const row of locals) {
    if (remoteIds.has(row.external_alert_id)) continue;
    const metadata = typeof row.metadata === 'string' ? safeParse(row.metadata) : row.metadata;
    const pollerIngested =
      metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>)[RECONCILIATION_INGEST_MARKER];
    if (!pollerIngested) continue;

    const result = await processRmmAlertEvent(ctx, {
      tenantId: args.tenantId,
      integrationId: args.integrationId,
      provider: args.provider as NormalizedRmmAlertEvent['provider'],
      kind: 'reset',
      externalAlertId: row.external_alert_id,
      severity: 'none',
      occurredAt: now,
      raw: { [RECONCILIATION_INGEST_MARKER]: 'reconciliation', reason: 'no_longer_active_in_rmm' },
    });
    warnings.push(...result.warnings);
    if (result.outcome === 'resolved') resetsSynthesized += 1;
  }

  return { skipped: false, remoteActive: remote.length, ingested, resetsSynthesized, warnings };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
