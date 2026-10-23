/**
 * Datto RMM site sync: mirrors /v2/account/sites into rmm_organization_mappings.
 *
 * Like the device engine this is a plain lib module (not a server-actions file) so the
 * settings action can wrap it with a permission check and a job could call it
 * without an acting user.
 *
 * A site becomes one mapping row keyed by its uid. The admin chooses the Alga
 * client; the sync only ever *suggests* one, in metadata, from the site's
 * Autotask company name and then its own name. Re-syncing refreshes the name
 * and metadata but never touches client_id, auto_sync_assets or the other
 * columns an admin owns. A mapping whose site no longer appears in Datto is
 * flagged (metadata.missing_in_datto) and never deleted; the flag clears when
 * the site comes back.
 */
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';

import { tenantScopedTable } from './db';
import { buildDattoClientForTenant, getDattoIntegrationRow } from './buildClient';
import { DattoSyncConfigError, dattoErrorMessage, publishRmmSyncEvent, type DattoSyncResult } from './deviceSync';
import { DATTO_RMM_PROVIDER } from './shared';
import type { DattoSite } from './types';

const PROVIDER = DATTO_RMM_PROVIDER;

interface ClientCandidate {
  clientId: string;
  clientName: string;
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Legal-form words that differ between how a PSA and an RMM name the same
// company ("Acme, Inc." vs "Acme"). Stripped only from the end of a name.
const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'pllc', 'pc', 'pa', 'gmbh', 'ag', 'bv', 'sa', 'srl', 'pty',
]);

/**
 * Looser key for suggestions: lower-cased, "&" read as "and", punctuation
 * dropped, a leading "the" and trailing legal suffixes removed. "The Acme
 * Company, LLC" and "Acme" share a key. Never used to assign a client.
 */
export function looseClientNameKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const words = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

export interface ClientNameIndex {
  exact: Map<string, ClientCandidate>;
  loose: Map<string, ClientCandidate>;
}

function addUnambiguous(
  index: Map<string, ClientCandidate>,
  ambiguous: Set<string>,
  key: string,
  candidate: ClientCandidate
): void {
  if (!key || ambiguous.has(key)) return;
  const existing = index.get(key);
  if (existing && existing.clientId !== candidate.clientId) {
    index.delete(key);
    ambiguous.add(key);
    return;
  }
  index.set(key, candidate);
}

/**
 * Client lookup by exact (case-insensitive) name and by looseClientNameKey. A
 * key shared by several clients is ambiguous, so it is dropped rather than
 * guessed at.
 */
export function buildClientNameIndex(
  clients: Array<{ client_id: unknown; client_name?: unknown }>
): ClientNameIndex {
  const exact = new Map<string, ClientCandidate>();
  const loose = new Map<string, ClientCandidate>();
  const ambiguousExact = new Set<string>();
  const ambiguousLoose = new Set<string>();
  for (const row of clients) {
    if (row.client_id == null || typeof row.client_name !== 'string') continue;
    const candidate = { clientId: String(row.client_id), clientName: row.client_name.trim() };
    addUnambiguous(exact, ambiguousExact, normalizeName(row.client_name), candidate);
    addUnambiguous(loose, ambiguousLoose, looseClientNameKey(row.client_name), candidate);
  }
  return { exact, loose };
}

/**
 * Case-insensitive exact match of the site's Autotask company name, then its
 * own name; failing both, the same two on their loose keys. Suggestion only:
 * callers must not assign.
 */
export function suggestClientForDattoSite(
  site: Pick<DattoSite, 'name' | 'autotaskCompanyName'>,
  index: ClientNameIndex
): ClientCandidate | null {
  const candidates = [site.autotaskCompanyName, site.name];
  for (const candidate of candidates) {
    const match = index.exact.get(normalizeName(candidate));
    if (match) return match;
  }
  for (const candidate of candidates) {
    const key = looseClientNameKey(candidate);
    const match = key ? index.loose.get(key) : undefined;
    if (match) return match;
  }
  return null;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export interface DattoSiteSyncResult extends DattoSyncResult {
  /** Uids of sites this run saw for the first time. */
  created_site_uids?: string[];
}

/** Whether every key in `next` already holds the same value in `prior`. */
function metadataUnchanged(prior: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return Object.entries(next).every(([key, value]) => JSON.stringify(prior[key] ?? null) === JSON.stringify(value ?? null));
}

export async function runDattoRmmSiteSync(args: {
  tenant: string;
  actorUserId?: string;
}): Promise<DattoSiteSyncResult> {
  const { tenant, actorUserId } = args;
  const errors: string[] = [];
  // Used for emitting failure events in the catch block.
  let integrationId: string | undefined;

  try {
    const { knex } = await createTenantKnex();
    const integration = await getDattoIntegrationRow(knex, tenant);

    if (!integration?.integration_id) {
      return {
        success: false,
        error: 'Datto RMM is not configured yet. Save settings first.',
        items_processed: 0,
        items_created: 0,
        items_updated: 0,
        items_failed: 0,
      };
    }

    const integrationIdForEvents = String(integration.integration_id);
    integrationId = integrationIdForEvents;

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'organizations',
    });

    const client = await buildDattoClientForTenant(tenant, { allowInactive: true });
    if (!client) {
      throw new DattoSyncConfigError('Datto RMM credentials are not configured. Save and test the connection first.');
    }

    const sites = await client.listSites();

    const existingRows: any[] = await tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
      .where({ integration_id: integration.integration_id })
      .select(['external_organization_id', 'external_organization_name', 'metadata']);
    const existing = new Map<string, Record<string, unknown>>(
      existingRows.map((row) => [String(row.external_organization_id), parseMetadata(row.metadata)])
    );
    const existingNames = new Map<string, string | null>(
      existingRows.map((row) => [String(row.external_organization_id), row.external_organization_name ?? null])
    );

    const clientRows: any[] = await tenantScopedTable(knex, 'clients', tenant).select(['client_id', 'client_name']);
    const clientIndex = buildClientNameIndex(clientRows);

    let created = 0;
    let updated = 0;
    const seenSiteUids = new Set<string>();
    const createdSiteUids: string[] = [];

    for (const site of sites) {
      const siteUid = String(site?.uid ?? '').trim();
      if (!siteUid) {
        errors.push('Site record missing uid');
        continue;
      }

      seenSiteUids.add(siteUid);
      const name = String(site.name ?? '').trim() || siteUid;
      const suggestion = suggestClientForDattoSite(site, clientIndex);
      const metadata = {
        datto_site_id: site.id ?? null,
        autotask_company_id: site.autotaskCompanyId ?? null,
        autotask_company_name: site.autotaskCompanyName ?? null,
        on_demand: site.onDemand === true,
        portal_url: site.portalUrl ?? null,
        // Lets device sync work out whether one account-wide listing is
        // cheaper than a walk per site.
        device_count: typeof site.devicesStatus?.numberOfDevices === 'number'
          ? site.devicesStatus.numberOfDevices
          : null,
        missing_in_datto: false,
        suggested_client_id: suggestion?.clientId ?? null,
        suggested_client_name: suggestion?.clientName ?? null,
      };

      const prior = existing.get(siteUid);
      // Site sync runs ahead of every scheduled device sync; a site with
      // nothing new is not rewritten.
      if (prior && existingNames.get(siteUid) === name && metadataUnchanged(prior, metadata)) continue;
      if (prior) updated += 1;
      else created += 1;

      try {
        await tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
          .insert({
            tenant,
            integration_id: integration.integration_id,
            external_organization_id: siteUid,
            external_organization_name: name,
            // On-demand sites are not managed estates; start with sync off.
            // Other new sites keep the column default.
            ...(site.onDemand === true ? { auto_sync_assets: false } : {}),
            metadata,
          })
          .onConflict(['tenant', 'integration_id', 'external_organization_id'])
          // Only what the provider owns. client_id, auto_sync_assets, contact
          // and billing settings belong to the admin and are never merged.
          .merge({
            external_organization_name: name,
            metadata: { ...(prior ?? {}), ...metadata },
            updated_at: new Date().toISOString(),
          });
        if (!prior) createdSiteUids.push(siteUid);
      } catch (err) {
        if (prior) updated -= 1;
        else created -= 1;
        errors.push(`${siteUid}: ${dattoErrorMessage(err)}`);
      }
    }

    // A site that vanished from Datto keeps its mapping (assets and billing
    // hang off it); it is only flagged so the UI and device sync can tell.
    let missing = 0;
    // An empty listing for an account that had sites is far likelier a
    // permissions or API problem than every site being deleted at once, and
    // flagging them all would stop device sync for the whole estate.
    const listingLooksBroken = sites.length === 0 && existing.size > 0;
    if (listingLooksBroken) {
      errors.push('Datto RMM returned no sites; existing site mappings were left unchanged.');
    }
    for (const [siteUid, prior] of existing) {
      if (listingLooksBroken) break;
      if (seenSiteUids.has(siteUid)) continue;
      missing += 1;
      if (prior.missing_in_datto === true) continue;
      try {
        await tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
          .where({ integration_id: integration.integration_id, external_organization_id: siteUid })
          .update({ metadata: { ...prior, missing_in_datto: true }, updated_at: new Date().toISOString() });
      } catch (err) {
        errors.push(`${siteUid}: ${dattoErrorMessage(err)}`);
      }
    }
    if (missing) {
      logger.warn('[DattoRmmSiteSync] mapped sites no longer listed by Datto', { tenant, provider: PROVIDER, missing });
    }

    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'organizations',
      itemsProcessed: sites.length,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: errors.length,
    });

    return {
      success: true,
      items_processed: sites.length,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
      created_site_uids: createdSiteUids,
    };
  } catch (err) {
    const message = dattoErrorMessage(err);
    logger.warn('[DattoRmmSiteSync] run failed', { tenant, provider: PROVIDER, error: message });
    if (integrationId) {
      await publishRmmSyncEvent({
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'organizations',
        errorMessage: message,
      });
    }
    return {
      success: false,
      error: message,
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  }
}
