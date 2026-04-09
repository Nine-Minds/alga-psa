import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import type {
  NormalizedRmmDeviceType,
  NormalizedRmmExternalDeviceSnapshot,
  NormalizedRmmIngestionResult,
} from './contracts';

type SupportedAssetType = Extract<NormalizedRmmDeviceType, 'workstation' | 'server' | 'network_device' | 'mobile_device' | 'unknown'>;

export interface IngestNormalizedRmmDeviceSnapshotInput {
  tenant: string;
  snapshot: NormalizedRmmExternalDeviceSnapshot;
  resolvedClientId?: string | null;
  knex?: Knex;
}

type ExternalMappingRow = {
  id: string;
  alga_entity_id: string;
  external_realm_id?: string | null;
};

type ExistingAssetRow = {
  asset_id: string;
  asset_type: SupportedAssetType;
  client_id?: string | null;
};

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAssetType(assetType: NormalizedRmmDeviceType): SupportedAssetType {
  if (assetType === 'workstation' || assetType === 'server' || assetType === 'network_device' || assetType === 'mobile_device') {
    return assetType;
  }
  return 'unknown';
}

function pickExtensionTable(assetType: SupportedAssetType): 'workstation_assets' | 'server_assets' | null {
  if (assetType === 'server') return 'server_assets';
  if (assetType === 'workstation') return 'workstation_assets';
  return null;
}

async function resolveClientIdForScope(
  trx: Knex.Transaction,
  args: { tenant: string; integrationId: string; externalScopeId: string; resolvedClientId?: string | null; }
): Promise<string | null> {
  if (args.resolvedClientId) return args.resolvedClientId;

  const mapping = await trx('rmm_organization_mappings')
    .where({
      tenant: args.tenant,
      integration_id: args.integrationId,
      external_organization_id: args.externalScopeId,
    })
    .first<{ client_id?: string | null }>('client_id');

  return mapping?.client_id ? String(mapping.client_id) : null;
}

async function upsertAssetExtension(
  trx: Knex.Transaction,
  args: { tenant: string; assetId: string; assetType: SupportedAssetType; snapshot: NormalizedRmmExternalDeviceSnapshot; }
): Promise<void> {
  const table = pickExtensionTable(args.assetType);
  if (!table) return;

  const ext = args.snapshot.extension ?? {};
  const patch = {
    os_type: ext.osType ?? null,
    os_version: ext.osVersion ?? null,
    agent_version: ext.agentVersion ?? null,
    current_user: ext.currentUser ?? null,
    uptime_seconds: ext.uptimeSeconds ?? null,
    lan_ip: ext.lanIp ?? null,
    wan_ip: ext.wanIp ?? null,
    antivirus_status: ext.antivirusStatus ?? null,
    antivirus_product: ext.antivirusProduct ?? null,
    last_reboot_at: parseIsoDate(ext.lastRebootAt),
    pending_patches: ext.pendingPatches ?? null,
    pending_os_patches: ext.pendingOsPatches ?? null,
    pending_software_patches: ext.pendingSoftwarePatches ?? null,
    failed_patches: ext.failedPatches ?? null,
    last_patch_scan_at: parseIsoDate(ext.lastPatchScanAt),
    system_info: ext.systemInfo ?? null,
  };

  await trx(table)
    .insert({
      tenant: args.tenant,
      asset_id: trx.raw('?::uuid', [args.assetId]),
      ...patch,
    })
    .onConflict(['tenant', 'asset_id'])
    .merge(patch);
}

async function markMappedAssetDeleted(
  trx: Knex.Transaction,
  args: {
    tenant: string;
    provider: string;
    mappingId: string;
    assetId: string;
    externalDeviceId: string;
    externalScopeId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<NormalizedRmmIngestionResult> {
  const now = new Date().toISOString();

  await trx('assets')
    .where({ tenant: args.tenant, asset_id: args.assetId })
    .update({
      status: 'inactive',
      agent_status: 'offline',
      last_rmm_sync_at: trx.fn.now(),
      updated_at: now,
    });

  await trx('tenant_external_entity_mappings')
    .where({ tenant: args.tenant, id: args.mappingId })
    .update({
      sync_status: 'error',
      last_synced_at: trx.fn.now(),
      metadata: {
        ...(args.metadata ?? {}),
        deleted: true,
        deletedAt: now,
      },
      updated_at: now,
    });

  return {
    externalDeviceId: args.externalDeviceId,
    assetId: args.assetId,
    action: 'marked_deleted',
  };
}

export async function ingestNormalizedRmmDeviceSnapshot(
  input: IngestNormalizedRmmDeviceSnapshotInput
): Promise<NormalizedRmmIngestionResult> {
  const { tenant, snapshot } = input;
  const knex = input.knex ?? (await createTenantKnex()).knex;
  const assetType = normalizeAssetType(snapshot.assetType);

  return knex.transaction(async (trx) => {
    const exactMapping = await trx('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: snapshot.provider,
        alga_entity_type: 'asset',
        external_entity_id: snapshot.externalDeviceId,
        external_realm_id: snapshot.externalScopeId,
      })
      .first<ExternalMappingRow>('id', 'alga_entity_id', 'external_realm_id');

    const anyRealmMapping = exactMapping
      ? null
      : await trx('tenant_external_entity_mappings')
          .where({
            tenant,
            integration_type: snapshot.provider,
            alga_entity_type: 'asset',
            external_entity_id: snapshot.externalDeviceId,
          })
          .first<ExternalMappingRow>('id', 'alga_entity_id', 'external_realm_id');

    const existingMapping = exactMapping ?? anyRealmMapping;

    if (snapshot.lifecycleState === 'deleted' || snapshot.lifecycleState === 'tombstoned') {
      if (!existingMapping?.alga_entity_id) {
        return {
          externalDeviceId: snapshot.externalDeviceId,
          action: 'skipped',
          error: 'No existing mapping to mark as deleted',
        };
      }

      return markMappedAssetDeleted(trx, {
        tenant,
        provider: snapshot.provider,
        mappingId: existingMapping.id,
        assetId: String(existingMapping.alga_entity_id),
        externalDeviceId: snapshot.externalDeviceId,
        externalScopeId: snapshot.externalScopeId,
        metadata: snapshot.metadata,
      });
    }

    let existingAsset: ExistingAssetRow | null = null;
    let mappingId: string | null = null;

    if (existingMapping?.alga_entity_id) {
      existingAsset = await trx('assets')
        .where({ tenant, asset_id: existingMapping.alga_entity_id })
        .first<ExistingAssetRow>('asset_id', 'asset_type', 'client_id');
      mappingId = existingMapping.id;
    }

    if (!existingAsset) {
      existingAsset = await trx('assets')
        .where({
          tenant,
          rmm_provider: snapshot.provider,
          rmm_device_id: snapshot.externalDeviceId,
        })
        .first<ExistingAssetRow>('asset_id', 'asset_type', 'client_id');
    }

    if (!mappingId && existingAsset?.asset_id) {
      const assetScopedMapping = await trx('tenant_external_entity_mappings')
        .where({
          tenant,
          integration_type: snapshot.provider,
          alga_entity_type: 'asset',
          alga_entity_id: existingAsset.asset_id,
        })
        .first<ExternalMappingRow>('id', 'alga_entity_id', 'external_realm_id');

      if (assetScopedMapping?.id) {
        mappingId = assetScopedMapping.id;
      }
    }

    const lastSeenAt = parseIsoDate(snapshot.lastSeenAt);
    const assetStatus = snapshot.status || (snapshot.lifecycleState === 'offline' ? 'inactive' : 'active');
    const agentStatus = snapshot.agentStatus ?? (snapshot.lifecycleState === 'offline' ? 'offline' : 'online');
    const resolvedClientId = await resolveClientIdForScope(trx, {
      tenant,
      integrationId: snapshot.integrationId,
      externalScopeId: snapshot.externalScopeId,
      resolvedClientId: input.resolvedClientId,
    });

    if (existingAsset?.asset_id) {
      const assetId = String(existingAsset.asset_id);
      const assetPatch: Record<string, unknown> = {
        name: snapshot.displayName,
        serial_number: snapshot.serialNumber ?? '',
        status: assetStatus,
        location: snapshot.location ?? '',
        rmm_provider: snapshot.provider,
        rmm_device_id: snapshot.externalDeviceId,
        rmm_organization_id: snapshot.externalScopeId,
        agent_status: agentStatus,
        last_seen_at: lastSeenAt,
        last_rmm_sync_at: trx.fn.now(),
      };

      if (resolvedClientId) {
        assetPatch.client_id = resolvedClientId;
      }

      await trx('assets')
        .where({ tenant, asset_id: assetId })
        .update(assetPatch);

      await upsertAssetExtension(trx, {
        tenant,
        assetId,
        assetType: normalizeAssetType(existingAsset.asset_type),
        snapshot,
      });

      if (mappingId) {
        await trx('tenant_external_entity_mappings')
          .where({ tenant, id: mappingId })
          .update({
            external_realm_id: snapshot.externalScopeId,
            sync_status: 'synced',
            last_synced_at: trx.fn.now(),
            metadata: snapshot.metadata ?? {},
          });
      } else {
        await trx('tenant_external_entity_mappings').insert({
          tenant,
          integration_type: snapshot.provider,
          alga_entity_type: 'asset',
          alga_entity_id: assetId,
          external_entity_id: snapshot.externalDeviceId,
          external_realm_id: snapshot.externalScopeId,
          sync_status: 'synced',
          last_synced_at: trx.fn.now(),
          metadata: snapshot.metadata ?? {},
        });
      }

      return {
        externalDeviceId: snapshot.externalDeviceId,
        assetId,
        action: 'updated',
      };
    }

    if (!resolvedClientId) {
      return {
        externalDeviceId: snapshot.externalDeviceId,
        action: 'skipped',
        error: `No mapped client for external scope ${snapshot.externalScopeId}`,
      };
    }

    const now = new Date().toISOString();
    const [createdAsset] = await trx('assets')
      .insert({
        tenant,
        asset_type: assetType,
        client_id: resolvedClientId,
        asset_tag: snapshot.assetTag || `${snapshot.provider}:${snapshot.externalDeviceId}`,
        serial_number: snapshot.serialNumber ?? '',
        name: snapshot.displayName,
        status: assetStatus,
        location: snapshot.location ?? '',
        rmm_provider: snapshot.provider,
        rmm_device_id: snapshot.externalDeviceId,
        rmm_organization_id: snapshot.externalScopeId,
        agent_status: agentStatus,
        last_seen_at: lastSeenAt,
        last_rmm_sync_at: now,
        created_at: now,
        updated_at: now,
      })
      .returning<{ asset_id: string }[]>('asset_id');

    const createdAssetId = String(createdAsset.asset_id);

    await upsertAssetExtension(trx, {
      tenant,
      assetId: createdAssetId,
      assetType,
      snapshot,
    });

    await trx('tenant_external_entity_mappings').insert({
      tenant,
      integration_type: snapshot.provider,
      alga_entity_type: 'asset',
      alga_entity_id: createdAssetId,
      external_entity_id: snapshot.externalDeviceId,
      external_realm_id: snapshot.externalScopeId,
      sync_status: 'synced',
      last_synced_at: trx.fn.now(),
      metadata: snapshot.metadata ?? {},
      created_at: now,
      updated_at: now,
    });

    return {
      externalDeviceId: snapshot.externalDeviceId,
      assetId: createdAssetId,
      action: 'created',
    };
  });
}
