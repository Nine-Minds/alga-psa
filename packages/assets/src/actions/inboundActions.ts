import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import type { NormalizedRmmExternalDeviceSnapshot } from '@alga-psa/shared/rmm/contracts';
import type { RmmProvider } from '@alga-psa/types';

import { registerAction, type InboundActionDefinition } from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId, writeEntityMapping } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

const KNOWN_RMM_PROVIDERS = new Set<RmmProvider>([
  'ninjaone',
  'tacticalrmm',
  'tanium',
  'levelio',
  'datto',
  'connectwise_automate',
  'huntress',
]);

interface UpsertAssetByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  client_id?: string;
  client_external_id?: string;
  // Any asset_type_registry slug (built-in or custom tenant type).
  asset_type?: string;
  name?: string;
  asset_tag?: string;
  serial_number?: string;
  status?: string;
  location?: string;
  rmm_snapshot?: Record<string, unknown>;
  external_scope_id?: string;
}

const upsertAssetByExternalIdAction: InboundActionDefinition<UpsertAssetByExternalIdMappedValues> = {
  name: 'upsertAssetByExternalId',
  entityType: 'asset',
  displayName: 'Upsert Asset by External ID',
  description: 'Create or update an asset using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External asset identifier' },
    { name: 'client_id', type: 'ref', required: false, refEntityType: 'client', description: 'Client ID' },
    { name: 'client_external_id', type: 'string', required: false, description: 'External client ID to resolve' },
    {
      name: 'asset_type',
      type: 'string',
      required: false,
      description: 'Asset type slug for plain asset upsert (any registry type, built-in or custom)',
    },
    { name: 'name', type: 'string', required: false, description: 'Asset display name' },
    { name: 'asset_tag', type: 'string', required: false, description: 'Asset tag' },
    { name: 'serial_number', type: 'string', required: false, description: 'Serial number' },
    { name: 'status', type: 'string', required: false, description: 'Asset status' },
    { name: 'location', type: 'string', required: false, description: 'Asset location' },
    { name: 'rmm_snapshot', type: 'json', required: false, description: 'Normalized RMM device snapshot' },
    { name: 'external_scope_id', type: 'string', required: false, description: 'External RMM scope or organization ID' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    const resolvedClientId = await resolveMappedClientId({
      tenant: ctx.tenant,
      webhookSlug: ctx.webhookSlug,
      clientId: mappedValues.client_id,
      clientExternalId: mappedValues.client_external_id,
      knex,
    });

    if (isRmmSnapshot(mappedValues.rmm_snapshot)) {
      const rawProvider = mappedValues.rmm_snapshot.provider;
      if (typeof rawProvider !== 'string' || !KNOWN_RMM_PROVIDERS.has(rawProvider as RmmProvider)) {
        return {
          success: false,
          entityType: 'asset',
          externalId: mappedValues.external_id,
          message: `RMM snapshot provider "${String(rawProvider)}" is not a supported provider. ` +
            `Set provider to one of: ${[...KNOWN_RMM_PROVIDERS].join(', ')}.`,
          metadata: { reason: 'unsupported_rmm_provider' },
        };
      }
      const snapshot: NormalizedRmmExternalDeviceSnapshot = {
        ...(mappedValues.rmm_snapshot as unknown as NormalizedRmmExternalDeviceSnapshot),
        provider: rawProvider as RmmProvider,
        integrationId: ctx.webhookSlug,
        externalDeviceId: mappedValues.external_id,
        externalScopeId: mappedValues.external_scope_id ?? String(mappedValues.rmm_snapshot.externalScopeId ?? 'default'),
      };
      const result = await ingestNormalizedRmmDeviceSnapshot({
        tenant: ctx.tenant,
        snapshot,
        resolvedClientId,
        knex,
      });

      if (result.action === 'skipped' || result.action === 'failed') {
        return {
          success: false,
          entityType: 'asset',
          externalId: mappedValues.external_id,
          message: result.error ?? `RMM asset ingestion ${result.action}`,
          metadata: { action: result.action },
        };
      }

      return {
        success: true,
        entityType: 'asset',
        entityId: result.assetId,
        externalId: mappedValues.external_id,
        metadata: {
          action: result.action,
          rmm: true,
        },
      };
    }

    const asset = await withTransaction(knex, async (trx) => {
      const lookup = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        'asset',
        mappedValues.external_id,
        { knex: trx },
      );
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        asset_type: mappedValues.asset_type ?? 'unknown',
        client_id: resolvedClientId ?? null,
        serial_number: mappedValues.serial_number ?? '',
        name: mappedValues.name ?? mappedValues.external_id,
        status: mappedValues.status ?? 'active',
        location: mappedValues.location ?? '',
        updated_at: now,
      };
      if (mappedValues.asset_tag !== undefined) {
        payload.asset_tag = mappedValues.asset_tag;
      }

      if (lookup) {
        const [updated] = await tenantDb(trx, ctx.tenant).table('assets')
          .where({ asset_id: lookup.algaEntityId })
          .update(payload)
          .returning<{ asset_id: string; name: string }[]>(['asset_id', 'name']);
        return updated;
      }

      const [created] = await tenantDb(trx, ctx.tenant).table('assets')
        .insert({
          tenant: ctx.tenant,
          ...payload,
          created_at: now,
        })
        .returning<{ asset_id: string; name: string }[]>(['asset_id', 'name']);

      await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'asset', created.asset_id, mappedValues.external_id, {
        knex: trx,
        metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
      });

      return created;
    });

    return {
      success: true,
      entityType: 'asset',
      entityId: asset.asset_id,
      externalId: mappedValues.external_id,
      metadata: {
        name: asset.name,
        rmm: false,
      },
    };
  },
};

registerAction(upsertAssetByExternalIdAction);

export const assetInboundActions = [upsertAssetByExternalIdAction];

function isRmmSnapshot(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function resolveMappedClientId(args: {
  tenant: string;
  webhookSlug: string;
  clientId?: string;
  clientExternalId?: string;
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'];
}): Promise<string | null> {
  if (args.clientId) {
    return args.clientId;
  }

  if (!args.clientExternalId) {
    return null;
  }

  const lookup = await lookupAlgaEntityByExternalId(args.tenant, args.webhookSlug, 'client', args.clientExternalId, {
    knex: args.knex,
  });

  return lookup?.algaEntityId ?? null;
}
