/**
 * Datto RMM site -> Alga client provisioning.
 *
 * Plain lib module (not a server-actions file) for the same reason as siteSync: the
 * settings actions wrap it with permission checks, and the scheduled sync calls
 * it without an acting user when the tenant opted into auto-creation.
 *
 * Each site is handled in its own transaction: the client (when one is made),
 * its billing profile, default contract and tax settings, and the mapping's
 * client_id commit together or not at all. A client whose name already exists
 * (case-insensitively, exactly one) is linked rather than duplicated.
 * CLIENT_CREATED is published after commit, as the client actions do.
 */
import type { Knex } from 'knex';

import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { createClientWithDefaults } from '@alga-psa/shared/models/clientCreation';
import { moveRmmOrganizationAssets } from '@alga-psa/shared/rmm/moveRmmOrganizationAssets';
import { resolveProductCode } from '@alga-psa/types';
import { buildClientCreatedPayload } from '@alga-psa/workflow-streams';

import { tenantScopedTable } from './db';
import { getDattoIntegrationRow } from './buildClient';
import { dattoErrorMessage } from './deviceSync';
import { DATTO_RMM_PROVIDER } from './shared';

const PROVIDER = DATTO_RMM_PROVIDER;

export type DattoSiteClientOutcome = 'created' | 'linked' | 'skipped' | 'failed';

export interface DattoSiteClientResult {
  mappingId: string;
  siteUid: string;
  siteName: string | null;
  outcome: DattoSiteClientOutcome;
  clientId?: string;
  clientName?: string;
  /** Why a site was skipped or failed. */
  reason?: string;
}

export interface DattoSiteClientProvisioningResult {
  success: boolean;
  error?: string;
  results: DattoSiteClientResult[];
  created: number;
  linked: number;
  skipped: number;
  failed: number;
}

/** Thrown inside a site's transaction to roll it back with a reportable reason. */
class SiteProvisioningAbort extends Error {
  constructor(readonly outcome: 'skipped' | 'failed', reason: string) {
    super(reason);
    this.name = 'SiteProvisioningAbort';
  }
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

/**
 * The client name a site would create: the Datto site name, or failing that its
 * Autotask company name. A site with neither (named by its uid) gets none.
 */
export function clientNameForDattoSite(row: {
  external_organization_id: unknown;
  external_organization_name?: unknown;
  metadata?: unknown;
}): string | null {
  const uid = String(row.external_organization_id ?? '').trim();
  const name = typeof row.external_organization_name === 'string' ? row.external_organization_name.trim() : '';
  if (name && name !== uid) return name;
  const autotask = parseMetadata(row.metadata).autotask_company_name;
  return typeof autotask === 'string' && autotask.trim() ? autotask.trim() : null;
}

async function provisionOne(
  trx: Knex.Transaction,
  args: {
    tenant: string;
    mapping: any;
    clientName: string;
    defaultCurrency: string;
    skipTaxSettings: boolean;
    actorUserId?: string;
  }
): Promise<{ outcome: 'created' | 'linked'; clientId: string; clientName: string; createdAt?: string }> {
  const { tenant, mapping, clientName } = args;
  const db = tenantDb(trx, tenant);

  const matches: any[] = await db.table('clients')
    .whereRaw('lower(client_name) = ?', [clientName.toLowerCase()])
    .limit(2)
    .select(['client_id', 'client_name', 'is_inactive']);
  if (matches.length > 1) {
    throw new SiteProvisioningAbort('failed', `More than one client is named "${clientName}"; map this site by hand.`);
  }
  // Linking would quietly attach live devices to an archived client, and a new
  // client cannot take the name; the admin has to decide.
  if (matches[0]?.is_inactive === true) {
    throw new SiteProvisioningAbort(
      'failed',
      `The client "${matches[0].client_name}" is inactive. Reactivate it or map this site by hand.`
    );
  }

  let outcome: 'created' | 'linked';
  let client: { client_id: string; client_name: string; created_at?: string };
  if (matches.length === 1) {
    outcome = 'linked';
    client = { client_id: String(matches[0].client_id), client_name: String(matches[0].client_name) };
  } else {
    outcome = 'created';
    const now = new Date().toISOString();
    // The shared creation seam does the same provisioning the client actions
    // do, in the same transaction. The batch already resolved the tenant's
    // currency and product code, so both are passed through.
    const inserted = await createClientWithDefaults(
      trx,
      tenant,
      {
        client_name: clientName,
        client_type: 'company',
        is_inactive: false,
      },
      { defaultCurrencyCode: args.defaultCurrency, skipTaxSettings: args.skipTaxSettings }
    );
    client = {
      client_id: String(inserted.client_id),
      client_name: String(inserted.client_name),
      created_at: inserted.created_at ? new Date(inserted.created_at).toISOString() : now,
    };
  }

  // Only claim a site that is still unmapped: an admin may have mapped it
  // while this ran, and their choice wins (the created client rolls back).
  const claimed = await db.table('rmm_organization_mappings')
    .where({ mapping_id: mapping.mapping_id })
    .whereNull('client_id')
    .update({ client_id: client.client_id, updated_at: trx.fn.now() });
  if (!claimed) {
    throw new SiteProvisioningAbort('skipped', 'The site was mapped to a client in the meantime.');
  }

  // Assets left on the site from an earlier mapping follow it, as they do when
  // an admin picks a client.
  await moveRmmOrganizationAssets(trx, tenant, {
    integrationId: String(mapping.integration_id),
    provider: PROVIDER,
    externalOrganizationId: String(mapping.external_organization_id),
    newClientId: client.client_id,
    actorUserId: args.actorUserId ?? null,
  });

  return { outcome, clientId: client.client_id, clientName: client.client_name, createdAt: client.created_at };
}

/**
 * Creates (or links) an Alga client for each unmapped Datto site selected by
 * mappingIds or siteUids, or for every unmapped site when neither is given.
 *
 * On-demand sites and sites Datto no longer lists are left alone, since
 * neither is a managed estate that wants a client, unless an admin picked the
 * site by mappingId. siteUids is the automatic path and keeps both filters.
 */
export async function provisionClientsForDattoSites(args: {
  tenant: string;
  actorUserId?: string;
  mappingIds?: string[];
  siteUids?: string[];
}): Promise<DattoSiteClientProvisioningResult> {
  const { tenant, actorUserId } = args;
  const results: DattoSiteClientResult[] = [];
  const summarize = (extra: Partial<DattoSiteClientProvisioningResult> = {}): DattoSiteClientProvisioningResult => ({
    success: true,
    results,
    created: results.filter((r) => r.outcome === 'created').length,
    linked: results.filter((r) => r.outcome === 'linked').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    ...extra,
  });

  try {
    const { knex } = await createTenantKnex();
    const integration = await getDattoIntegrationRow(knex, tenant);
    if (!integration?.integration_id) {
      return summarize({ success: false, error: 'Datto RMM is not configured yet. Save settings first.' });
    }

    const explicit = Boolean(args.mappingIds?.length);
    let query = tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
      .where({ integration_id: integration.integration_id });
    if (args.mappingIds?.length) query = query.whereIn('mapping_id', args.mappingIds);
    if (args.siteUids?.length) query = query.whereIn('external_organization_id', args.siteUids);
    const mappings: any[] = await query.select([
      'mapping_id',
      'integration_id',
      'external_organization_id',
      'external_organization_name',
      'client_id',
      'metadata',
    ]);

    const billingSettings = await tenantScopedTable(knex, 'default_billing_settings', tenant)
      .first('default_currency_code');
    const defaultCurrency = billingSettings?.default_currency_code || 'USD';
    // AlgaDesk has no billing tax setup; the client actions skip it there too.
    const tenantRow = await tenantDb(knex, tenant).table('tenants').first('product_code');
    const skipTaxSettings = resolveProductCode(tenantRow?.product_code).productCode === 'algadesk';

    for (const mapping of mappings) {
      const metadata = parseMetadata(mapping.metadata);
      const base = {
        mappingId: String(mapping.mapping_id),
        siteUid: String(mapping.external_organization_id),
        siteName: mapping.external_organization_name ? String(mapping.external_organization_name) : null,
      };

      if (mapping.client_id) {
        // Listing an already-mapped site in a bulk run is noise, not a skip.
        if (explicit) results.push({ ...base, outcome: 'skipped', reason: 'The site is already mapped to a client.' });
        continue;
      }
      if (!explicit && metadata.on_demand === true) continue;
      if (!explicit && metadata.missing_in_datto === true) continue;

      const clientName = clientNameForDattoSite(mapping);
      if (!clientName) {
        results.push({ ...base, outcome: 'skipped', reason: 'The site has no name to give a client.' });
        continue;
      }

      try {
        const provisioned = await withTransaction(knex, (trx: Knex.Transaction) =>
          provisionOne(trx, { tenant, mapping, clientName, defaultCurrency, skipTaxSettings, actorUserId })
        );
        results.push({
          ...base,
          outcome: provisioned.outcome,
          clientId: provisioned.clientId,
          clientName: provisioned.clientName,
        });

        if (provisioned.outcome === 'created') {
          const createdAt = provisioned.createdAt ?? new Date().toISOString();
          await publishWorkflowEvent({
            eventType: 'CLIENT_CREATED',
            payload: buildClientCreatedPayload({
              clientId: provisioned.clientId,
              clientName: provisioned.clientName,
              createdByUserId: actorUserId,
              createdAt,
              status: 'active',
            }),
            ctx: {
              tenantId: tenant,
              occurredAt: createdAt,
              actor: actorUserId
                ? { actorType: 'USER' as const, actorUserId }
                : { actorType: 'SYSTEM' as const },
            },
            idempotencyKey: `client_created:${provisioned.clientId}`,
          }).catch((err: unknown) => {
            // The client is committed; a lost event must not report the site as failed.
            logger.warn('[DattoRmmSiteClients] CLIENT_CREATED publish failed', {
              tenant,
              provider: PROVIDER,
              clientId: provisioned.clientId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        if (err instanceof SiteProvisioningAbort) {
          results.push({ ...base, outcome: err.outcome, reason: err.message });
        } else if ((err as { code?: string } | null)?.code === '23505') {
          results.push({
            ...base,
            outcome: 'failed',
            reason: `A client named "${clientName}" was created while this ran. Try again to link it.`,
          });
        } else {
          results.push({ ...base, outcome: 'failed', reason: dattoErrorMessage(err) });
        }
      }
    }

    return summarize();
  } catch (err) {
    const message = dattoErrorMessage(err);
    logger.warn('[DattoRmmSiteClients] provisioning failed', { tenant, provider: PROVIDER, error: message });
    return summarize({ success: false, error: message });
  }
}

/**
 * The opt-in follow-up to a site sync: clients for the sites that sync saw for
 * the first time, when the tenant turned autoCreateClientsForNewSites on. Runs
 * after both the scheduled and the manual sync, so whichever discovers a site
 * gets to act on it. Returns null when there was nothing to do.
 */
export async function provisionClientsForNewDattoSitesIfEnabled(args: {
  tenant: string;
  newSiteUids: string[] | undefined;
  actorUserId?: string;
}): Promise<DattoSiteClientProvisioningResult | null> {
  if (!args.newSiteUids?.length) return null;
  const { knex } = await createTenantKnex();
  const integration = await getDattoIntegrationRow(knex, args.tenant);
  if (parseMetadata(integration?.settings).autoCreateClientsForNewSites !== true) return null;

  // Only the sites this sync discovered: an older unmapped site may have been
  // left unmapped on purpose.
  return provisionClientsForDattoSites({
    tenant: args.tenant,
    actorUserId: args.actorUserId,
    siteUids: args.newSiteUids,
  });
}
