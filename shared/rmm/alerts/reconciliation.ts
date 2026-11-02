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

export interface RmmActiveAlertSnapshot {
  /** Alerts to ingest as triggered events. */
  events: NormalizedRmmAlertEvent[];
  /**
   * Ids of alerts still open in the RMM that the fetcher deliberately left out
   * of `events` (muted, or from a site the tenant does not manage). They are
   * not ingested, but they have not cleared either, so the stale pass must not
   * synthesize a reset for them.
   */
  heldExternalAlertIds: string[];
}

export interface RmmActiveAlertFetcher {
  /** Returns every currently-active alert in the RMM as a triggered event. */
  fetchActiveAlerts(args: { tenantId: string; integrationId: string }): Promise<NormalizedRmmAlertEvent[]>;
  /**
   * Optional richer form for fetchers that filter what they ingest. When
   * present, reconciliation uses it instead of fetchActiveAlerts so filtered
   * alerts still count as active for stale detection.
   */
  fetchActiveAlertSnapshot?(args: { tenantId: string; integrationId: string }): Promise<RmmActiveAlertSnapshot>;
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
 *    tickets. Alerts the fetcher held back from ingestion still count as
 *    active here: filtered out is not the same as cleared.
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

  const fetchArgs = { tenantId: args.tenantId, integrationId: args.integrationId };
  const snapshot: RmmActiveAlertSnapshot = fetcher.fetchActiveAlertSnapshot
    ? await fetcher.fetchActiveAlertSnapshot(fetchArgs)
    : { events: await fetcher.fetchActiveAlerts(fetchArgs), heldExternalAlertIds: [] };
  const remote = snapshot.events;

  let ingested = 0;
  for (const event of remote) {
    const stamped: NormalizedRmmAlertEvent = {
      ...event,
      raw: { ...event.raw, [RECONCILIATION_INGEST_MARKER]: 'reconciliation' },
    };
    // One bad alert must not abort the cycle for every alert behind it.
    try {
      const result = await processRmmAlertEvent(ctx, stamped, { reprocessSuppressed: true });
      warnings.push(...result.warnings);
      if (result.outcome !== 'skipped') ingested += 1;
    } catch (error) {
      warnings.push(`Failed to ingest alert ${event.externalAlertId}: ${errorMessage(error)}`);
    }
  }

  const remoteIds = new Set([
    ...remote.map((event) => event.externalAlertId),
    ...snapshot.heldExternalAlertIds,
  ]);
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

    try {
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
    } catch (error) {
      warnings.push(`Failed to reset alert ${row.external_alert_id}: ${errorMessage(error)}`);
    }
  }

  return { skipped: false, remoteActive: remote.length, ingested, resetsSynthesized, warnings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
