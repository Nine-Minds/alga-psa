import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { queueContactCreated, queueContactUpdated } from '../lib/contactEvents';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IClient } from '@alga-psa/types';
import { ContactModel, type CreateContactInput, type UpdateContactInput } from '@alga-psa/shared/models/contactModel';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildClientCreatedPayload,
  buildClientStatusChangedPayload,
} from '@alga-psa/workflow-streams';
import {
  createClientWithDefaults,
  type CreateClientWithDefaultsData,
} from '@alga-psa/shared/models/clientCreation';

import { CLIENT_SINCE_FORMAT_MESSAGE, toClientSinceDate } from '../lib/clientSince';

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
  client_since?: string | null;
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
  // The registry has no date type; the handler validates the shape.
  { name: 'client_since', type: 'string' as const, required: false, description: 'Date the client relationship began (YYYY-MM-DD)' },
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

          // An update refreshes an existing default location but does not
          // invent one, matching the clients.update business operation.
          await upsertDefaultLocationFromMappedValues(trx, ctx.tenant, updated.client_id, mappedValues, {
            createIfMissing: false,
          });

          return { client: updated, wasCreated: false };
        }

        const created = await createClientWithDefaults(
          trx,
          ctx.tenant,
          payload as CreateClientWithDefaultsData,
        );

        await upsertDefaultLocationFromMappedValues(trx, ctx.tenant, created.client_id, mappedValues, {
          createIfMissing: true,
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
      // Tax settings now come from the shared creation seam inside the
      // transaction, so only the workflow event is left to mirror here.
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

          const before = await ContactModel.getContactById(existingMapping.algaEntityId, ctx.tenant, trx);
          const updated = await ContactModel.updateContact(existingMapping.algaEntityId, input, ctx.tenant, trx);
          if (before) {
            queueContactUpdated(trx, ctx.tenant, before as any, updated as any, Object.keys(input).filter((k) => (input as any)[k] !== undefined));
          }
          return updated;
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
        queueContactCreated(trx, ctx.tenant, created as any);

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

/**
 * Column values for the `clients` row. Contact and address fields live on
 * `client_locations`, not `clients` (dropped by migration 20250707120000), so
 * only `email` crosses over — as `billing_email`. Anything else here would be a
 * database error, since the payload is written straight to the table.
 */
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
  assignIfPresent(payload, 'billing_email', mappedValues.email);
  assignIfPresent(payload, 'default_currency_code', mappedValues.default_currency_code);
  assignIfPresent(payload, 'notes', mappedValues.notes);

  if (mappedValues.client_since !== undefined) {
    const clientSince = toClientSinceDate(mappedValues.client_since);
    if (clientSince === undefined) {
      throwInboundFailure(
        'VALIDATION_ERROR',
        `${CLIENT_SINCE_FORMAT_MESSAGE} (received "${String(mappedValues.client_since)}")`,
        'client',
        mappedValues.external_id,
      );
    }
    payload.client_since = clientSince;
  }

  return payload;
}

const LOCATION_MAPPED_FIELDS = [
  'phone_no',
  'email',
  'address',
  'address_2',
  'city',
  'state',
  'zip',
  'country',
] as const;

/**
 * Writes the mapped contact/address fields to the client's default location,
 * which is where they live. Mirrors the `clients.create` business operation so
 * both write paths agree on the mapping and on the placeholders the NOT NULL
 * location columns need.
 */
async function upsertDefaultLocationFromMappedValues(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  mappedValues: UpsertClientByExternalIdMappedValues,
  options: { createIfMissing: boolean },
): Promise<void> {
  if (LOCATION_MAPPED_FIELDS.every((field) => mappedValues[field] === undefined)) {
    return;
  }

  const db = tenantDb(trx, tenant);
  const now = new Date().toISOString();
  const existing = await db.table('client_locations')
    .where({ client_id: clientId, is_default: true })
    .first();

  if (existing) {
    const patch: Record<string, unknown> = { updated_at: now };
    assignIfPresent(patch, 'address_line1', mappedValues.address);
    assignIfPresent(patch, 'address_line2', mappedValues.address_2);
    assignIfPresent(patch, 'city', mappedValues.city);
    assignIfPresent(patch, 'state_province', mappedValues.state);
    assignIfPresent(patch, 'postal_code', mappedValues.zip);
    assignIfPresent(patch, 'country_name', mappedValues.country);
    assignIfPresent(patch, 'phone', mappedValues.phone_no);
    assignIfPresent(patch, 'email', mappedValues.email);

    await db.table('client_locations')
      .where({ location_id: existing.location_id })
      .update(patch);
    return;
  }

  if (!options.createIfMissing) {
    return;
  }

  await db.table('client_locations').insert({
    location_id: randomUUID(),
    tenant,
    client_id: clientId,
    location_name: 'Main Office',
    address_line1: mappedValues.address ?? '',
    address_line2: mappedValues.address_2 ?? null,
    city: mappedValues.city ?? '',
    state_province: mappedValues.state ?? null,
    postal_code: mappedValues.zip ?? null,
    country_code: mappedValues.country ? mappedValues.country.slice(0, 2).toUpperCase() : 'US',
    country_name: mappedValues.country ?? 'United States',
    phone: mappedValues.phone_no ?? null,
    email: mappedValues.email ?? null,
    is_default: true,
    is_billing_address: true,
    is_shipping_address: true,
    is_active: true,
    created_at: now,
    updated_at: now,
  });
}

function assignIfPresent<T extends object>(target: T, key: string, value: unknown): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}
