/**
 * Database helpers shared by the incident and escalation processors: org
 * mapping lookup (with on-demand discovery), asset matching, and the
 * agent → asset entity mapping.
 */

import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  HuntressAgent,
  HuntressOrganization,
} from '../../../interfaces/huntress.interfaces';

export interface ResolveOrgMappingOptions {
  integrationId: string;
  organizationId: number;
  /** Used for the discovered row's name when the org lookup fails. */
  organizationNameHint?: string | null;
  getOrganization: (orgId: number) => Promise<HuntressOrganization | null>;
  discoveredVia: 'incident_poll' | 'escalation_poll';
}

/**
 * Returns the org's mapping row. An org created in Huntress after the last
 * org sync is discovered on demand (inserted unmapped) so the mapping screen
 * stays current and the caller falls through to fallback routing.
 */
export async function resolveOrgMapping(
  knex: Knex,
  tenantId: string,
  options: ResolveOrgMappingOptions
): Promise<any> {
  const db = tenantDb(knex, tenantId);
  const where = {
    integration_id: options.integrationId,
    external_organization_id: String(options.organizationId),
  };

  const existing = await db.table('rmm_organization_mappings').where(where).first();
  if (existing) return existing;

  const org = await options.getOrganization(options.organizationId).catch(() => null);
  const [inserted] = await db.table('rmm_organization_mappings')
    .insert({
      tenant: tenantId,
      mapping_id: knex.raw('gen_random_uuid()'),
      integration_id: options.integrationId,
      external_organization_id: String(options.organizationId),
      external_organization_name:
        org?.name ?? options.organizationNameHint ?? `Huntress org ${options.organizationId}`,
      client_id: null,
      auto_sync_assets: false,
      auto_create_tickets: true,
      metadata: JSON.stringify({ discoveredVia: options.discoveredVia }),
    })
    .onConflict(['tenant', 'integration_id', 'external_organization_id'])
    .ignore()
    .returning('*');

  return inserted ?? (await db.table('rmm_organization_mappings').where(where).first());
}

/** Unique hostname match within the mapped client; serial number tie-breaks. */
export async function matchAsset(
  knex: Knex,
  tenantId: string,
  clientId: string,
  agent: HuntressAgent
): Promise<string | null> {
  const candidates = await tenantDb(knex, tenantId).table('assets')
    .where({ client_id: clientId })
    .whereRaw('LOWER(name) = ?', [String(agent.hostname).toLowerCase()])
    .select('asset_id', 'serial_number');

  if (candidates.length === 1) return candidates[0].asset_id;
  if (candidates.length > 1 && agent.serial_number) {
    const bySerial = candidates.filter((c) => c.serial_number === agent.serial_number);
    if (bySerial.length === 1) return bySerial[0].asset_id;
  }
  return null;
}

export async function upsertEntityMapping(
  trx: Knex.Transaction,
  tenantId: string,
  organizationId: number | null,
  agent: HuntressAgent,
  assetId: string
): Promise<void> {
  const db = tenantDb(trx, tenantId);
  const existing = await db.table('tenant_external_entity_mappings')
    .where({
      integration_type: 'huntress',
      external_entity_id: String(agent.id),
    })
    .first();
  if (existing) {
    await db.table('tenant_external_entity_mappings')
      .where({ id: existing.id })
      .update({
        alga_entity_id: assetId,
        sync_status: 'synced',
        last_synced_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    return;
  }
  await db.table('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    integration_type: 'huntress',
    alga_entity_type: 'asset',
    alga_entity_id: assetId,
    external_entity_id: String(agent.id),
    external_realm_id: organizationId != null ? String(organizationId) : null,
    sync_status: 'synced',
    last_synced_at: trx.fn.now(),
    metadata: JSON.stringify({ hostname: agent.hostname }),
  });
}
