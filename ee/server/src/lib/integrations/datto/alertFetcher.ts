import type { Knex } from 'knex';
import type { NormalizedRmmAlertEvent, RmmActiveAlertFetcher } from '@alga-psa/shared/rmm/alerts';
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
 * to an Alga client are returned: an unmapped site is one the tenant has not
 * chosen to manage, and its alerts would otherwise open client-less tickets.
 * Muted alerts are dropped: muting is how a Datto admin says "stop notifying
 * about this", so they should not raise tickets either.
 * Throws when the integration is not connected: an empty list would tell
 * reconciliation every alert has cleared. With no site mapped the open set is
 * empty, the same as for alerts from any site that is not mapped.
 */
export const dattoRmmAlertFetcher: RmmActiveAlertFetcher = {
  async fetchActiveAlerts({ tenantId, integrationId }) {
    const client = await buildDattoClientForTenant(tenantId);
    if (!client) throw new Error('Datto RMM integration is not connected');

    const { knex } = await createTenantKnex();
    const mappedSiteUids = await loadMappedDattoSiteUids(knex, tenantId, integrationId);
    if (mappedSiteUids.size === 0) return [];

    const alerts = await client.listOpenAlerts();

    return alerts
      .filter((alert) => alert?.resolved !== true)
      .filter((alert) => alert?.muted !== true)
      .filter((alert) => mappedSiteUids.has(String(alert?.alertSourceInfo?.siteUid ?? '')))
      .map((alert) => mapDattoAlertToEvent(alert, tenantId, integrationId))
      .filter((event): event is NormalizedRmmAlertEvent => event !== null);
  },
};

// Registration is a module side effect so any importer (the reconciliation
// dispatcher, the manual backfill) gets the fetcher wired.
registerRmmAlertFetcher(DATTO_RMM_PROVIDER, dattoRmmAlertFetcher);
