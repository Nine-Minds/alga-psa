import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IClient } from '@alga-psa/types';

import { registerAction, type InboundActionDefinition } from '@/lib/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId, writeEntityMapping } from '@/lib/inboundWebhooks/externalEntityMappings';

interface UpsertClientByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  client_name: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  default_currency_code?: string;
  notes?: string;
  is_inactive?: boolean;
  properties?: Record<string, unknown>;
}

interface SetClientActiveByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  active: boolean;
}

const clientFields = [
  { name: 'client_name', type: 'string' as const, required: true, description: 'Client name' },
  {
    name: 'client_type',
    type: 'enum' as const,
    required: false,
    description: 'Client type',
    enumValues: ['company', 'individual'],
  },
  { name: 'url', type: 'string' as const, required: false, description: 'Website URL' },
  { name: 'phone_no', type: 'string' as const, required: false, description: 'Phone number' },
  { name: 'email', type: 'string' as const, required: false, description: 'Email address' },
  { name: 'address', type: 'string' as const, required: false, description: 'Address line 1' },
  { name: 'address_2', type: 'string' as const, required: false, description: 'Address line 2' },
  { name: 'city', type: 'string' as const, required: false, description: 'City' },
  { name: 'state', type: 'string' as const, required: false, description: 'State or province' },
  { name: 'zip', type: 'string' as const, required: false, description: 'Postal code' },
  { name: 'country', type: 'string' as const, required: false, description: 'Country' },
  { name: 'default_currency_code', type: 'string' as const, required: false, description: 'Default currency code' },
  { name: 'notes', type: 'string' as const, required: false, description: 'Client notes' },
  { name: 'is_inactive', type: 'boolean' as const, required: false, description: 'Inactive flag' },
  { name: 'properties', type: 'json' as const, required: false, description: 'Additional client properties' },
];

const upsertClientByExternalIdAction: InboundActionDefinition<UpsertClientByExternalIdMappedValues> = {
  name: 'upsertClientByExternalId',
  entityType: 'client',
  displayName: 'Upsert Client by External ID',
  description: 'Create or update a client using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External client identifier' },
    ...clientFields,
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    const client = await withTransaction(knex, async (trx) => {
      const existingMapping = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        'client',
        mappedValues.external_id,
        { knex: trx },
      );
      const payload = buildClientPayload(mappedValues);

      if (existingMapping) {
        const current = await trx<IClient>('clients')
          .where({ tenant: ctx.tenant, client_id: existingMapping.algaEntityId })
          .first();

        if (!current) {
          throw new Error(`lookup_miss: mapped client "${existingMapping.algaEntityId}" no longer exists`);
        }

        const [updated] = await trx<IClient>('clients')
          .where({ tenant: ctx.tenant, client_id: existingMapping.algaEntityId })
          .update({
            ...payload,
            properties: {
              ...(current.properties ?? {}),
              ...(payload.properties ?? {}),
            },
            updated_at: new Date().toISOString(),
          })
          .returning('*');
        return updated;
      }

      const [created] = await trx<IClient>('clients')
        .insert({
          ...payload,
          tenant: ctx.tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'client', created.client_id, mappedValues.external_id, {
        knex: trx,
        metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
      });

      return created;
    });

    return {
      success: true,
      entityType: 'client',
      entityId: client.client_id,
      externalId: mappedValues.external_id,
      metadata: {
        client_name: client.client_name,
      },
    };
  },
};

const setClientActiveByExternalIdAction: InboundActionDefinition<SetClientActiveByExternalIdMappedValues> = {
  name: 'setClientActiveByExternalId',
  entityType: 'client',
  displayName: 'Set Client Active by External ID',
  description: 'Set active/inactive state for a mapped client using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External client identifier to resolve' },
    { name: 'active', type: 'boolean', required: true, description: 'Whether the client should be active' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    const updated = await withTransaction(knex, async (trx) => {
      const lookup = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        'client',
        mappedValues.external_id,
        { knex: trx },
      );

      if (!lookup) {
        return null;
      }

      const [client] = await trx<IClient>('clients')
        .where({ tenant: ctx.tenant, client_id: lookup.algaEntityId })
        .update({
          is_inactive: !mappedValues.active,
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      return client ?? null;
    });

    if (!updated) {
      return {
        success: false,
        entityType: 'client',
        externalId: mappedValues.external_id,
        message: `lookup_miss: client external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
      };
    }

    return {
      success: true,
      entityType: 'client',
      entityId: updated.client_id,
      externalId: mappedValues.external_id,
      metadata: {
        active: !updated.is_inactive,
      },
    };
  },
};

registerAction(upsertClientByExternalIdAction);
registerAction(setClientActiveByExternalIdAction);

export const clientInboundActions = [upsertClientByExternalIdAction, setClientActiveByExternalIdAction];

function buildClientPayload(mappedValues: UpsertClientByExternalIdMappedValues): Partial<IClient> {
  const payload: Partial<IClient> = {
    client_name: mappedValues.client_name,
    client_type: mappedValues.client_type ?? 'company',
    is_inactive: mappedValues.is_inactive ?? false,
    properties: {
      ...(mappedValues.properties ?? {}),
      inbound_webhook_external_id: mappedValues.external_id,
    },
  };

  assignIfPresent(payload, 'url', mappedValues.url);
  assignIfPresent(payload, 'phone_no', mappedValues.phone_no);
  assignIfPresent(payload, 'email', mappedValues.email);
  assignIfPresent(payload, 'address', mappedValues.address);
  assignIfPresent(payload, 'address_2', mappedValues.address_2);
  assignIfPresent(payload, 'city', mappedValues.city);
  assignIfPresent(payload, 'state', mappedValues.state);
  assignIfPresent(payload, 'zip', mappedValues.zip);
  assignIfPresent(payload, 'country', mappedValues.country);
  assignIfPresent(payload, 'default_currency_code', mappedValues.default_currency_code);
  assignIfPresent(payload, 'notes', mappedValues.notes);

  return payload;
}

function assignIfPresent<T extends object>(target: T, key: string, value: unknown): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}
