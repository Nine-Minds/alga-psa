/**
 * Pure payload builders for the registry-driven entity webhooks (client,
 * contact, client_location).
 *
 * Payloads are deliberately thin: the entity id, the parent `client_id` for
 * contact / client_location, and (only on `*.updated`, only when the domain
 * event carries field names) `changed_fields`. There are no record bodies and
 * no DB hydration, so a subscriber never reads data the event did not carry.
 * Consumers fetch the record via the REST API when they need it; a 404 on that
 * follow-up fetch after `*.deleted` / merge is expected and means "already gone".
 */
import type { WebhookEntity } from '../../../webhooks/eventRegistry';

export type EntityWebhookEntity = Extract<WebhookEntity, 'client' | 'contact' | 'client_location' | 'quote'>;

/** Internal domain-event payload (camelCase, as published on the bus). */
export type DomainEventPayload = Record<string, unknown> & { tenantId: string };

interface EntityPayloadSpec {
  /** Snake-case key of the entity's own id in the webhook payload. */
  idKey: 'client_id' | 'contact_id' | 'location_id' | 'quote_id';
  /** Camel-case key holding that id on the domain event, per internal event. */
  idSource: (internalEvent: string) => string;
  /** Whether the payload carries the parent `client_id` (contact / client_location). */
  parentClient: boolean;
  carriedFields?: readonly string[];
}

const ENTITY_PAYLOAD_SPECS: Record<EntityWebhookEntity, EntityPayloadSpec> = {
  client: {
    idKey: 'client_id',
    // CLIENT_MERGED is the source client going away; every other client event names the client by clientId
    // (CONTACT_PRIMARY_SET included: its clientId is the client whose primary contact changed).
    idSource: (internalEvent) => (internalEvent === 'CLIENT_MERGED' ? 'sourceClientId' : 'clientId'),
    parentClient: false,
  },
  contact: { idKey: 'contact_id', idSource: () => 'contactId', parentClient: true },
  client_location: { idKey: 'location_id', idSource: () => 'locationId', parentClient: true },
  quote: { idKey: 'quote_id', idSource: () => 'quoteId', parentClient: true, carriedFields: ['clientId', 'quoteNumber', 'version', 'contactId', 'opportunityId', 'previousStatus', 'newStatus', 'currencyCode', 'totalAmount', 'performedByType', 'performedById', 'sentAt', 'viewedAt', 'approvedAt', 'acceptedAt', 'rejectedAt', 'expiredAt', 'convertedAt', 'conversionRevertedAt', 'supersededAt', 'cancelledAt', 'acceptedByName', 'acceptedOnBehalf', 'selectedOptionalItemIds', 'rejectionReason', 'conversionTargets', 'contractId', 'invoiceId', 'salesOrderId', 'releasedInvoiceId', 'supersededByQuoteId', 'nextVersion'] },
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `clientName` -> `client_name`; dotted paths (`properties.accountManager`) convert per segment. */
export function toSnakeFieldPath(path: string): string {
  return path
    .split('.')
    .map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
    .join('.');
}

export function changedFieldNames(payload: Record<string, unknown>): string[] | null {
  const fields = payload.updatedFields;
  if (!Array.isArray(fields)) return null;
  const names = fields.filter((f): f is string => typeof f === 'string' && f.length > 0).map(toSnakeFieldPath);
  return names.length > 0 ? [...new Set(names)] : null;
}

/**
 * Build the webhook `data` object, or null when the domain event does not
 * identify the entity (such events are ignored rather than delivered half-empty).
 */
export function buildEntityWebhookPayload(
  entity: EntityWebhookEntity,
  internalEvent: string,
  publicEvent: string,
  payload: DomainEventPayload,
): Record<string, unknown> | null {
  const spec = ENTITY_PAYLOAD_SPECS[entity];
  const entityId = nonEmptyString(payload[spec.idSource(internalEvent)]);
  if (!entityId) return null;

  const data: Record<string, unknown> = { [spec.idKey]: entityId };

  if (spec.parentClient) {
    // Client-less contacts emit too; client_id is simply absent for them.
    const clientId = nonEmptyString(payload.clientId);
    if (clientId) data.client_id = clientId;
  }

  for (const field of spec.carriedFields ?? []) {
    if (payload[field] !== undefined) data[toSnakeFieldPath(field)] = payload[field];
  }

  if (publicEvent.endsWith('.updated')) {
    const changed = changedFieldNames(payload);
    if (changed) data.changed_fields = changed;
  }

  return data;
}
