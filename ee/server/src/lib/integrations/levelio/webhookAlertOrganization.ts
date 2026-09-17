/**
 * Level.io webhook organization resolution.
 *
 * Level alert automations copied before this integration shipped do not include
 * a `group_id` in their webhook payload (the generated template omits it and
 * existing copies stay untouched). Org-scoped alert rules therefore could not
 * match: the pipeline only saw `event.externalOrganizationId` derived from
 * `body.group_id`.
 *
 * This resolver backfills the event's organization before rule evaluation using
 * the approved precedence chain:
 *
 *   (a) explicit `body.group_id` when the payload carries one;
 *   (b) the device mapping's `external_realm_id` in
 *       `tenant_external_entity_mappings` — already canonicalized to the
 *       deepest mapped Level group by the sync engine;
 *   (c) a bounded Level API hierarchy lookup (device group + group parents vs.
 *       the client-mapped groups the sync engine syncs) when no stored realm id
 *       exists;
 *   (d) otherwise `null` — group-scoped rules simply do not match (never
 *       broadened).
 *
 * Tenant isolation is preserved: every read goes through the tenant-scoped
 * facade, and the fallback only consults groups mapped for this integration.
 * The API fallback is best-effort: any failure yields `null`.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { LevelIoApiClient } from './levelApiClient';
import { buildGroupParentMap, resolveDeepestMappedGroup } from './mappers/deviceMapper';

const PROVIDER = 'levelio' as const;

export interface LevelIoWebhookOrganizationDeps {
  knex: Knex;
  /**
   * Creates a Level API client. Only invoked for the bounded hierarchy
   * fallback (c); when absent the fallback is skipped and resolution stays
   * `null`.
   */
  createClient?: () => Promise<LevelIoApiClient>;
  /**
   * The device mapping row already fetched by the caller (integration_type
   * levelio, alga_entity_type asset, external_entity_id = device). When
   * provided its `external_realm_id` is trusted for step (b) and the duplicate
   * read is skipped.
   */
  deviceMapping?: { external_realm_id?: string | null } | null;
}

export interface ResolveLevelIoWebhookOrganizationArgs {
  tenant: string;
  integrationId: string;
  deviceId: string;
  /** Level copy of `body.group_id` when the automation included one. */
  explicitGroupId?: string | null;
}

export async function resolveLevelIoWebhookOrganization(
  deps: LevelIoWebhookOrganizationDeps,
  args: ResolveLevelIoWebhookOrganizationArgs,
): Promise<string | null> {
  // (a) Explicit group id wins when the payload carries one. This is also the
  // path for any future automation that includes {{group_id}}.
  if (args.explicitGroupId) {
    return String(args.explicitGroupId);
  }

  if (!args.deviceId) {
    return null;
  }

  // (b) The sync engine canonicalizes each ingested device's scope to the
  // deepest mapped Level group and stores it on the device mapping row. Trust
  // it: it is DB-local, tenant-scoped, and needs no Level API call.
  const realmId =
    deps.deviceMapping?.external_realm_id ??
    (await readDeviceRealmId(deps.knex, args.tenant, args.deviceId));
  if (realmId) {
    return String(realmId);
  }

  // (c) No stored realm (device never ingested, or ingested before any group
  // was mapped): ask Level where the device sits and walk up to the deepest
  // client-mapped ancestor — mirroring how the sync engine scopes devices.
  if (!deps.createClient) {
    return null;
  }
  try {
    const client = await deps.createClient();
    return await resolveFromLevelHierarchy(deps, client, args);
  } catch {
    // (d) Unavailable metadata or a failed lookup must not break alert
    // processing: leave the organization unresolved so org-scoped rules do not
    // broaden (they simply don't match) and the alert is recorded only.
    return null;
  }
}

async function readDeviceRealmId(
  knex: Knex,
  tenant: string,
  deviceId: string,
): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const mapping = await db.table('tenant_external_entity_mappings')
    .where({
      integration_type: PROVIDER,
      alga_entity_type: 'asset',
      external_entity_id: deviceId,
    })
    .first<{ external_realm_id?: string | null }>('external_realm_id');
  return mapping?.external_realm_id ? String(mapping.external_realm_id) : null;
}

async function resolveFromLevelHierarchy(
  deps: LevelIoWebhookOrganizationDeps,
  client: LevelIoApiClient,
  args: ResolveLevelIoWebhookOrganizationArgs,
): Promise<string | null> {
  const db = tenantDb(deps.knex, args.tenant);
  const [device, groups, mappedRows] = await Promise.all([
    client.getDevice(args.deviceId),
    client.listGroups(),
    db.table('rmm_organization_mappings')
      .where({ integration_id: args.integrationId })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select<Array<{ external_organization_id: string }>>('external_organization_id'),
  ]);

  const mappedGroupIds = new Set(
    mappedRows.map((row) => String(row.external_organization_id)),
  );
  if (mappedGroupIds.size === 0) {
    return null;
  }

  return resolveDeepestMappedGroup(
    device.group_id ?? null,
    buildGroupParentMap(groups),
    mappedGroupIds,
  );
}
