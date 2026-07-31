/**
 * Huntress organization discovery: upsert one mapping row per org, refresh
 * names on every sync, and auto-link only exact normalized name matches.
 */

import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { HuntressOrganization } from '../../../../interfaces/huntress.interfaces';
import { findExactNameMatch } from './nameMatch';

export interface OrgSyncClient {
  listOrganizations: () => Promise<HuntressOrganization[]>;
}

export interface OrgSyncResult {
  total: number;
  created: number;
  updated: number;
  autoMatched: number;
}

export async function syncHuntressOrganizations(
  knex: Knex,
  tenantId: string,
  integrationId: string,
  client: OrgSyncClient
): Promise<OrgSyncResult> {
  const organizations = await client.listOrganizations();
  const db = tenantDb(knex, tenantId);
  let created = 0;
  let updated = 0;

  for (const org of organizations) {
    const externalId = String(org.id);
    const existing = await db.table('rmm_organization_mappings')
      .where({
        integration_id: integrationId,
        external_organization_id: externalId,
      })
      .first();

    if (existing) {
      await db.table('rmm_organization_mappings')
        .where({ mapping_id: existing.mapping_id })
        .update({
          external_organization_name: org.name,
          last_synced_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      updated += 1;
    } else {
      await db.table('rmm_organization_mappings').insert({
        tenant: tenantId,
        mapping_id: knex.raw('gen_random_uuid()'),
        integration_id: integrationId,
        external_organization_id: externalId,
        external_organization_name: org.name,
        client_id: null,
        auto_sync_assets: false,
        auto_create_tickets: true,
        last_synced_at: knex.fn.now(),
      });
      created += 1;
    }
  }

  const autoMatched = await autoMatchUnmapped(knex, tenantId, integrationId);

  logger.info('[Huntress] Organization sync completed', {
    tenantId,
    total: organizations.length,
    created,
    updated,
    autoMatched,
  });

  return { total: organizations.length, created, updated, autoMatched };
}

async function autoMatchUnmapped(
  knex: Knex,
  tenantId: string,
  integrationId: string
): Promise<number> {
  const db = tenantDb(knex, tenantId);
  const clients = await db.table('clients')
    .where({ is_inactive: false })
    .select('client_id', 'client_name');

  const unmapped = await db.table('rmm_organization_mappings')
    .where({ integration_id: integrationId })
    .whereNull('client_id')
    .select('mapping_id', 'external_organization_name', 'metadata');

  let matched = 0;
  for (const mapping of unmapped) {
    if (!mapping.external_organization_name) continue;
    const clientId = findExactNameMatch(mapping.external_organization_name, clients);
    if (!clientId) continue;

    const existingMetadata =
      typeof mapping.metadata === 'string'
        ? JSON.parse(mapping.metadata || '{}')
        : mapping.metadata ?? {};
    await db.table('rmm_organization_mappings')
      .where({ mapping_id: mapping.mapping_id })
      .update({
        client_id: clientId,
        metadata: JSON.stringify({ ...existingMetadata, auto_matched: true }),
        updated_at: knex.fn.now(),
      });
    matched += 1;
  }
  return matched;
}
