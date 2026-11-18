import type { Knex } from 'knex';
import type {
  NormalizedRmmAlertEvent,
  RmmActiveAlertFetcher,
  RmmActiveAlertSnapshot,
} from '@alga-psa/shared/rmm/alerts';
import { registerRmmAlertFetcher } from '@alga-psa/shared/rmm/alerts';
import { createTenantKnex } from '@alga-psa/db';
import { tenantScopedTable } from './db';
import { buildDattoClientForTenant } from './buildClient';
import { mapDattoAlertToEvent } from './alertMapper';
import { DATTO_RMM_PROVIDER } from './shared';

/**
 * Datto site uids mapped to an Alga client for this integration. Alerts from
 * any other site belong to a site the tenant has not chosen to manage and must
 * not open (client-less) tickets, whether they arrive by poll or by webhook.
 */
export async function loadMappedDattoSiteUids(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  integrationId: string
): Promise<Set<string>> {
  const mappings = await tenantScopedTable(knex, 'rmm_organization_mappings', tenantId)
    .where({ integration_id: integrationId })
    .whereNotNull('client_id')
    .select(['external_organization_id']);
  return new Set<string>(
    (mappings as Array<{ external_organization_id?: unknown }>)
      .map((row) => String(row.external_organization_id ?? ''))
      .filter(Boolean)
  );
}

/** Single-site form of loadMappedDattoSiteUids, for the webhook's per-alert gate. */
export async function isDattoSiteMapped(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  integrationId: string,
  siteUid: string
): Promise<boolean> {
  const row = await tenantScopedTable(knex, 'rmm_organization_mappings', tenantId)
    .where({ integration_id: integrationId, external_organization_id: siteUid })
    .whereNotNull('client_id')
    .first(['external_organization_id']);
  return Boolean(row);
}

/**
 * Lists currently-open Datto RMM alerts for reconciliation
 * (GET /v2/account/alerts/open, paged). Only alerts for sites that are mapped
 * to an Alga client are ingested: an unmapped site is one the tenant has not
 * chosen to manage, and its alerts would otherwise open client-less tickets.
 * Muted alerts are not ingested either: muting is how a Datto admin says
 * "stop notifying about this", so they should not raise tickets.
 *
 * Both kinds are still open in Datto, so they come back as held ids rather
 * than being dropped: otherwise unmapping a site (or the last site) or muting
 * an alert would look like the alert cleared, and the stale pass would reset
 * it locally and auto-resolve its ticket while it is still firing.
 *
 * Throws when the integration is not connected: an empty snapshot would tell
 * reconciliation every alert has cleared.
 */
async function fetchDattoActiveAlertSnapshot({
  tenantId,
  integrationId,
}: {
  tenantId: string;
  integrationId: string;
}): Promise<RmmActiveAlertSnapshot> {
  const client = await buildDattoClientForTenant(tenantId);
  if (!client) throw new Error('Datto RMM integration is not connected');

  const { knex } = await createTenantKnex();
  const mappedSiteUids = await loadMappedDattoSiteUids(knex, tenantId, integrationId);
  const alerts = await client.listOpenAlerts();

  const events: NormalizedRmmAlertEvent[] = [];
  const heldExternalAlertIds: string[] = [];
  for (const alert of alerts) {
    if (alert?.resolved === true) continue;
    const ingest =
      alert?.muted !== true && mappedSiteUids.has(String(alert?.alertSourceInfo?.siteUid ?? ''));
    const event = ingest ? mapDattoAlertToEvent(alert, tenantId, integrationId) : null;
    if (event) {
      events.push(event);
    } else if (alert?.alertUid != null && String(alert.alertUid).trim()) {
      heldExternalAlertIds.push(String(alert.alertUid).trim());
    }
  }
  return { events, heldExternalAlertIds };
}

export const dattoRmmAlertFetcher: RmmActiveAlertFetcher = {
  async fetchActiveAlerts(args) {
    return (await fetchDattoActiveAlertSnapshot(args)).events;
  },
  fetchActiveAlertSnapshot: fetchDattoActiveAlertSnapshot,
};

// Registration is a module side effect so any importer (the reconciliation
// dispatcher, the manual backfill) gets the fetcher wired.
registerRmmAlertFetcher(DATTO_RMM_PROVIDER, dattoRmmAlertFetcher);
