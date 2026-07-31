import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IClient } from '@alga-psa/types';
import { ContactModel, type CreateContactInput, type UpdateContactInput } from '@alga-psa/shared/models/contactModel';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildClientCreatedPayload,
  buildClientStatusChangedPayload,
} from '@alga-psa/workflow-streams';
import { ensureDefaultContractForClientIfBillingConfigured } from '@alga-psa/shared/billingClients/defaultContract';

import { createDefaultTaxSettingsAsync } from '../lib/billingHelpers';

import {
  registerAction,
  type InboundActionDefinition,
  type InboundActionResult,
} from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId, writeEntityMapping } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

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

interface UpsertContactByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  full_name: string;
  email: string;
  client_id?: string;
  client_external_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
  phone?: string;
}

class ExpectedInboundActionFailure extends Error {
  constructor(readonly result: InboundActionResult) {
    super(result.message ?? 'Inbound action failed');
  }
}

function inboundFailure(
  code: 'VALIDATION_ERROR' | 'LOOKUP_MISS',
  message: string,
  entityType: string,
  externalId?: string,
  metadata: Record<string, unknown> = {},
): InboundActionResult {
  return {
    success: false,
    entityType,
    externalId,
    message,
    metadata: { code, ...metadata },
  };
}

function throwInboundFailure(
  code: 'VALIDATION_ERROR' | 'LOOKUP_MISS',
  message: string,
  entityType: string,
  externalId?: string,
  metadata: Record<string, unknown> = {},
): never {
  throw new ExpectedInboundActionFailure(inboundFailure(code, message, entityType, externalId, metadata));
}

function toExpectedInboundActionResult(error: unknown): InboundActionResult | null {
  return error instanceof ExpectedInboundActionFailure ? error.result : null;
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
    let result;
    try {
      result = await withTransaction(knex, async (trx) => {
        const existingMapping = await lookupAlgaEntityByExternalId(
          ctx.tenant,
          ctx.webhookSlug,
          'client',
          mappedValues.external_id,
          { knex: trx },
        );
        const payload = buildClientPayload(mappedValues);

        if (existingMapping) {
          const current = await tenantDb(trx, ctx.tenant).table<IClient>('clients')
            .where({ client_id: existingMapping.algaEntityId })
            .first();

          if (!current) {
            throwInboundFailure(
              'LOOKUP_MISS',
              `lookup_miss: mapped client "${existingMapping.algaEntityId}" no longer exists`,
              'client',
              mappedValues.external_id,
              { entity_id: existingMapping.algaEntityId },
            );
          }

          const [updated] = await tenantDb(trx, ctx.tenant).table<IClient>('clients')
            .where({ client_id: existingMapping.algaEntityId })
            .update({
              ...payload,
              properties: {
                ...(current.properties ?? {}),
                ...(payload.properties ?? {}),
              },
              updated_at: new Date().toISOString(),
            })
            .returning('*');
          return { client: updated, wasCreated: false };
        }

        const [created] = await tenantDb(trx, ctx.tenant).table<IClient>('clients')
          .insert({
            ...payload,
            tenant: ctx.tenant,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .returning('*');

        await ensureDefaultContractForClientIfBillingConfigured(trx, {
          tenant: ctx.tenant,
          clientId: created.client_id,
        });

        await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'client', created.client_id, mappedValues.external_id, {
          knex: trx,
          metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
        });

        return { client: created, wasCreated: true };
      });
    } catch (error) {
      const expectedResult = toExpectedInboundActionResult(error);
      if (expectedResult) {
        return expectedResult;
      }
      throw error;
    }

    const { client, wasCreated } = result;

    if (wasCreated) {
      // Mirror createClient post-commit side effects (tax settings, workflow event).
      try {
        await createDefaultTaxSettingsAsync(client.client_id);
      } catch (taxError) {
        // Tax settings are best-effort for inbound webhooks; surface in delivery outcome metadata.
        console.error(`Failed to create default tax settings for inbound client ${client.client_id}:`, taxError);
      }

      const createdAt = client.created_at ?? new Date().toISOString();
      const status =
        (client as any)?.properties?.status ?? (client.is_inactive ? 'inactive' : 'active');
      await publishWorkflowEvent({
        eventType: 'CLIENT_CREATED',
        payload: buildClientCreatedPayload({
          clientId: client.client_id,
          clientName: client.client_name,
          createdAt: String(createdAt),
          status,
        }),
        ctx: {
          tenantId: ctx.tenant,
          occurredAt: String(createdAt),
        },
        idempotencyKey: `client_created:${client.client_id}`,
      });
    }

    return {
      success: true,
      entityType: 'client',
      entityId: client.client_id,
      externalId: mappedValues.external_id,
      metadata: {
        client_name: client.client_name,
        created: wasCreated,
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
    const result = await withTransaction(knex, async (trx) => {
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

      const previous = await tenantDb(trx, ctx.tenant).table<IClient>('clients')
        .where({ client_id: lookup.algaEntityId })
        .first('is_inactive');

      const [client] = await tenantDb(trx, ctx.tenant).table<IClient>('clients')
        .where({ client_id: lookup.algaEntityId })
        .update({
          is_inactive: !mappedValues.active,
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      const previousStatus = previous?.is_inactive ? 'inactive' : 'active';

      return client ? { client, previousStatus } : null;
    });

    if (!result) {
      return {
        success: false,
        entityType: 'client',
        externalId: mappedValues.external_id,
        message: `lookup_miss: client external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
        metadata: { code: 'LOOKUP_MISS' },
      };
    }

    const { client: updated, previousStatus } = result;
    const newStatus = updated.is_inactive ? 'inactive' : 'active';
    if (previousStatus !== newStatus) {
      const updatedAt = updated.updated_at ?? new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'CLIENT_STATUS_CHANGED',
        payload: buildClientStatusChangedPayload({
          clientId: updated.client_id,
          previousStatus,
          newStatus,
          changedAt: String(updatedAt),
        }),
        ctx: {
          tenantId: ctx.tenant,
          occurredAt: String(updatedAt),
        },
        idempotencyKey: `client_status_changed:${updated.client_id}:${ctx.deliveryId}`,
      });
    }

    return {
      success: true,
      entityType: 'client',
      entityId: updated.client_id,
      externalId: mappedValues.external_id,
      metadata: {
        active: !updated.is_inactive,
        status_changed: previousStatus !== newStatus,
      },
    };
  },
};

const upsertContactByExternalIdAction: InboundActionDefinition<UpsertContactByExternalIdMappedValues> = {
  name: 'upsertContactByExternalId',
  entityType: 'contact',
  displayName: 'Upsert Contact by External ID',
  description: 'Create or update a contact using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External contact identifier' },
    { name: 'full_name', type: 'string', required: true, description: 'Contact full name' },
    { name: 'email', type: 'string', required: true, description: 'Contact email address' },
    { name: 'client_id', type: 'ref', required: false, refEntityType: 'client', description: 'Client ID' },
    { name: 'client_external_id', type: 'string', required: false, description: 'External client ID to resolve' },
    { name: 'role', type: 'string', required: false, description: 'Contact role or job title' },
    { name: 'notes', type: 'string', required: false, description: 'Contact notes' },
    { name: 'is_inactive', type: 'boolean', required: false, description: 'Inactive flag' },
    { name: 'phone', type: 'string', required: false, description: 'Primary phone number' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    let contact;
    try {
      contact = await withTransaction(knex, async (trx) => {
        const existingMapping = await lookupAlgaEntityByExternalId(
          ctx.tenant,
          ctx.webhookSlug,
          'contact',
          mappedValues.external_id,
          { knex: trx },
        );
        const clientId = mappedValues.client_id || (
          mappedValues.client_external_id
            ? (await lookupAlgaEntityByExternalId(
              ctx.tenant,
              ctx.webhookSlug,
              'client',
              mappedValues.client_external_id,
              { knex: trx },
            ))?.algaEntityId
            : undefined
        );

        if (!clientId && !existingMapping) {
          throwInboundFailure(
            'VALIDATION_ERROR',
            'VALIDATION_ERROR: upsertContactByExternalId requires client_id or resolvable client_external_id when creating a contact',
            'contact',
            mappedValues.external_id,
            { field: 'client_id', client_external_id: mappedValues.client_external_id },
          );
        }

        if (existingMapping) {
          const input: UpdateContactInput = {
            full_name: mappedValues.full_name,
            email: mappedValues.email,
            client_id: clientId,
            role: mappedValues.role,
            notes: mappedValues.notes,
            is_inactive: mappedValues.is_inactive,
            phone_numbers: mappedValues.phone
              ? [{ phone_number: mappedValues.phone, canonical_type: 'work', is_default: true, display_order: 0 }]
              : undefined,
          };

          return ContactModel.updateContact(existingMapping.algaEntityId, input, ctx.tenant, trx);
        }

        const input: CreateContactInput = {
          full_name: mappedValues.full_name,
          email: mappedValues.email,
          client_id: clientId,
          role: mappedValues.role,
          notes: mappedValues.notes,
          is_inactive: mappedValues.is_inactive,
          phone_numbers: mappedValues.phone
            ? [{ phone_number: mappedValues.phone, canonical_type: 'work', is_default: true, display_order: 0 }]
            : undefined,
        };
        const created = await ContactModel.createContact(input, ctx.tenant, trx);

        await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'contact', created.contact_name_id, mappedValues.external_id, {
          knex: trx,
          metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
        });

        return created;
      });
    } catch (error) {
      const expectedResult = toExpectedInboundActionResult(error);
      if (expectedResult) {
        return expectedResult;
      }
      throw error;
    }

    return {
      success: true,
      entityType: 'contact',
      entityId: contact.contact_name_id,
      externalId: mappedValues.external_id,
      metadata: {
        email: contact.email,
        client_id: contact.client_id,
      },
    };
  },
};

registerAction(upsertClientByExternalIdAction);
registerAction(setClientActiveByExternalIdAction);
registerAction(upsertContactByExternalIdAction);

export const clientInboundActions = [
  upsertClientByExternalIdAction,
  setClientActiveByExternalIdAction,
  upsertContactByExternalIdAction,
];

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
