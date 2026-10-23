import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { ContactModel, type CreateContactInput } from '@alga-psa/shared/models/contactModel';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildContactCreatedPayload } from '@alga-psa/workflow-streams';
import { THREECX_PROVIDER } from './providerState';
import type { ThreecxContact } from './lookup';

/**
 * Contact creation driven by the 3CX client's "create contact" action. The
 * queue of contacts that still need a human decision (no client matched, or
 * no email so nothing could be created yet) lives in
 * tenant_external_entity_mappings under integration_type '3cx'.
 */
const MAPPINGS_TABLE = 'tenant_external_entity_mappings';

export const THREECX_CONTACT_ORIGIN_ENTITY_TYPE = 'contact-origin';
export const THREECX_CONTACT_PENDING_ENTITY_TYPE = 'contact-pending';
export const THREECX_CRM_CREATE_EXTERNAL_ID = 'crm-create';
export const THREECX_PENDING_QUERY_PARAM = 'threecxPending';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CreatedContact = Awaited<ReturnType<typeof ContactModel.createContact>>;

export interface ThreecxCreateContactInput {
  firstName: string;
  lastName: string;
  number: string;
  email: string;
  company: string;
}

export type ThreecxCreateContactValidation =
  | { ok: true; value: ThreecxCreateContactInput }
  | { ok: false; error: 'invalid_request'; message?: string };

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Every field is optional text; the request is refused only when it carries nothing to create from. */
export function validateThreecxCreateContactBody(body: unknown): ThreecxCreateContactValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request', message: 'Expected a JSON object body.' };
  }
  const raw = body as Record<string, unknown>;
  const value: ThreecxCreateContactInput = {
    firstName: optionalString(raw.firstName),
    lastName: optionalString(raw.lastName),
    number: optionalString(raw.number),
    email: optionalString(raw.email),
    company: optionalString(raw.company),
  };
  if (!value.firstName && !value.lastName && !value.number && !value.email) {
    return {
      ok: false,
      error: 'invalid_request',
      message: 'At least one of firstName, lastName, number or email is required.',
    };
  }
  return { ok: true, value };
}

export interface ThreecxClientResolution {
  clientId: string | null;
  suggestedClientId: string | null;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Exact case-insensitive client_name match attaches the contact; otherwise the
 * shortest active client whose name contains the company text is suggested.
 */
export async function resolveClientForCompany(
  knex: Knex,
  tenantId: string,
  company: string,
): Promise<ThreecxClientResolution> {
  const term = company.trim();
  if (!term) return { clientId: null, suggestedClientId: null };

  const db = tenantDb(knex, tenantId);
  const exact = await db
    .table('clients')
    .whereRaw('lower(client_name) = ?', [term.toLowerCase()])
    .andWhere('is_inactive', false)
    .orderBy('client_name', 'asc')
    .first('client_id');
  if (exact?.client_id) return { clientId: exact.client_id, suggestedClientId: null };

  const partial = await db
    .table('clients')
    .where('client_name', 'ilike', `%${escapeLike(term)}%`)
    .andWhere('is_inactive', false)
    .orderByRaw('length(client_name) asc')
    .first('client_id');
  return { clientId: null, suggestedClientId: partial?.client_id ?? null };
}

export function threecxContactUrl(baseUrl: string, contactId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/msp/contacts/${contactId}`;
}

/** The integrations settings page (communication category) with the pending id the card reads to open its Complete dialog. */
export function threecxPendingContactUrl(baseUrl: string, pendingId: string): string {
  const params = new URLSearchParams({ category: 'communication', [THREECX_PENDING_QUERY_PARAM]: pendingId });
  return `${baseUrl.replace(/\/$/, '')}/msp/settings/integrations?${params.toString()}`;
}

function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}

function buildFullName(firstName: string, lastName: string, fallbacks: string[]): string {
  const name = `${firstName} ${lastName}`.trim();
  if (name) return name;
  return fallbacks.find((value) => value.trim())?.trim() ?? '';
}

function buildPhoneNumbers(number: string): CreateContactInput['phone_numbers'] {
  const trimmed = number.trim();
  if (!trimmed) return [];
  return [{ phone_number: trimmed, canonical_type: 'work', is_default: true, display_order: 0 }];
}

async function clientNameFor(db: ReturnType<typeof tenantDb>, clientId: string | null): Promise<string> {
  if (!clientId) return '';
  const row = await db.table('clients').where({ client_id: clientId }).first('client_name');
  return row?.client_name ?? '';
}

interface CreateContactRecordInput {
  fullName: string;
  email: string;
  number: string;
  clientId: string | null;
}

/** Creates the contact through the shared model and publishes CONTACT_CREATED the way addContact does. */
async function createContactRecord(tenantId: string, input: CreateContactRecordInput): Promise<CreatedContact> {
  const createInput: CreateContactInput = {
    full_name: input.fullName,
    email: input.email,
    phone_numbers: buildPhoneNumbers(input.number),
    client_id: input.clientId ?? undefined,
  };

  const created = await withTransaction(tenantId, (trx) => ContactModel.createContact(createInput, tenantId, trx));

  const clientId = created.client_id;
  if (typeof clientId === 'string' && clientId) {
    const occurredAt = created.created_at ?? new Date().toISOString();
    await publishWorkflowEvent({
      eventType: 'CONTACT_CREATED',
      payload: buildContactCreatedPayload({
        contactId: created.contact_name_id,
        clientId,
        fullName: created.full_name,
        email: created.email || undefined,
        primaryEmailCanonicalType: created.primary_email_canonical_type ?? null,
        primaryEmailCustomTypeId: created.primary_email_custom_type_id ?? null,
        primaryEmailType: created.primary_email_type ?? null,
        additionalEmailAddresses: created.additional_email_addresses ?? [],
        phoneNumbers: created.phone_numbers,
        defaultPhoneNumber: created.default_phone_number || undefined,
        defaultPhoneType: created.default_phone_type || undefined,
        createdAt: occurredAt,
      }),
      ctx: { tenantId, occurredAt, actor: { actorType: 'SYSTEM' } },
      idempotencyKey: `contact_created:${created.contact_name_id}`,
    });
  }

  return created;
}

function isEmailExistsError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('EMAIL_EXISTS:');
}

export interface ThreecxCreateContactContext {
  tenantId: string;
  baseUrl: string;
}

export type ThreecxCreateContactResult =
  | { kind: 'created' | 'existing'; contact: ThreecxContact }
  | { kind: 'pending'; pendingId: string; contact: ThreecxContact };

/**
 * With an email the contact is created now (a duplicate email answers with the
 * existing contact); when no client matched exactly an 'unmapped' queue row is
 * written. Without an email nothing can be created, so a 'pending' queue row
 * captures the fields and the response sends the technician to the card.
 */
export async function createContactFromThreecx(
  ctx: ThreecxCreateContactContext,
  body: ThreecxCreateContactInput,
): Promise<ThreecxCreateContactResult> {
  const { knex } = await createTenantKnex(ctx.tenantId);
  const db = tenantDb(knex, ctx.tenantId);
  const { clientId, suggestedClientId } = await resolveClientForCompany(knex, ctx.tenantId, body.company);

  if (!body.email) {
    const pendingId = crypto.randomUUID();
    await db.table(MAPPINGS_TABLE).insert({
      tenant: ctx.tenantId,
      integration_type: THREECX_PROVIDER,
      alga_entity_type: THREECX_CONTACT_PENDING_ENTITY_TYPE,
      alga_entity_id: pendingId,
      external_entity_id: THREECX_CRM_CREATE_EXTERNAL_ID,
      external_realm_id: pendingId,
      sync_status: 'pending',
      metadata: JSON.stringify({
        firstName: body.firstName,
        lastName: body.lastName,
        number: body.number,
        company: body.company,
        suggestedClientId,
        status: 'pending',
      }),
    });
    return {
      kind: 'pending',
      pendingId,
      contact: {
        contactUrl: threecxPendingContactUrl(ctx.baseUrl, pendingId),
        firstName: body.firstName,
        lastName: body.lastName,
        companyName: body.company,
        email: '',
        phone: body.number,
        entityId: pendingId,
        entityType: 'pending',
      },
    };
  }

  const normalizedEmail = body.email.toLowerCase();
  let created: CreatedContact;
  try {
    created = await createContactRecord(ctx.tenantId, {
      fullName: buildFullName(body.firstName, body.lastName, [body.number, body.email]),
      email: normalizedEmail,
      number: body.number,
      clientId,
    });
  } catch (err) {
    if (!isEmailExistsError(err)) throw err;
    const existing = await db
      .table('contacts')
      .where({ email: normalizedEmail })
      .orderBy('is_inactive', 'asc')
      .first('contact_name_id', 'full_name', 'email', 'client_id');
    if (!existing) throw err;
    const { firstName, lastName } = splitName(existing.full_name);
    return {
      kind: 'existing',
      contact: {
        contactUrl: threecxContactUrl(ctx.baseUrl, existing.contact_name_id),
        firstName,
        lastName,
        companyName: await clientNameFor(db, existing.client_id ?? null),
        email: existing.email ?? '',
        phone: body.number,
        entityId: existing.contact_name_id,
        entityType: 'contact',
      },
    };
  }

  if (!clientId) {
    await db.table(MAPPINGS_TABLE).insert({
      tenant: ctx.tenantId,
      integration_type: THREECX_PROVIDER,
      alga_entity_type: THREECX_CONTACT_ORIGIN_ENTITY_TYPE,
      alga_entity_id: created.contact_name_id,
      external_entity_id: THREECX_CRM_CREATE_EXTERNAL_ID,
      external_realm_id: created.contact_name_id,
      sync_status: 'pending',
      metadata: JSON.stringify({ companyName: body.company, suggestedClientId, status: 'unmapped' }),
    });
  }

  const { firstName, lastName } = splitName(created.full_name);
  return {
    kind: 'created',
    contact: {
      contactUrl: threecxContactUrl(ctx.baseUrl, created.contact_name_id),
      firstName,
      lastName,
      companyName: clientId ? await clientNameFor(db, clientId) : body.company,
      email: created.email ?? normalizedEmail,
      phone: body.number || created.default_phone_number || '',
      entityId: created.contact_name_id,
      entityType: 'contact',
    },
  };
}

export type ThreecxContactQueueItem =
  | {
      kind: 'unmapped';
      contactId: string;
      fullName: string;
      email: string;
      companyName: string;
      suggestedClientId: string | null;
      suggestedClientName: string | null;
    }
  | {
      kind: 'pending';
      pendingId: string;
      firstName: string;
      lastName: string;
      number: string;
      companyName: string;
      suggestedClientId: string | null;
      suggestedClientName: string | null;
    };

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === 'string' ? value : '';
}

function metaId(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value ? value : null;
}

function queueRowsQuery(db: ReturnType<typeof tenantDb>, entityType: string) {
  return db
    .table(MAPPINGS_TABLE)
    .where({ integration_type: THREECX_PROVIDER, alga_entity_type: entityType })
    .whereNull('deleted_at');
}

/** Unmapped (created, no client) and pending (no email yet) rows, oldest first, with the suggested client's name. */
export async function listThreecxContactQueue(tenantId: string): Promise<ThreecxContactQueueItem[]> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);

  const rows: any[] = await db
    .table(MAPPINGS_TABLE)
    .where({ integration_type: THREECX_PROVIDER })
    .whereIn('alga_entity_type', [THREECX_CONTACT_ORIGIN_ENTITY_TYPE, THREECX_CONTACT_PENDING_ENTITY_TYPE])
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')
    .select('alga_entity_type', 'alga_entity_id', 'metadata');

  const parsed = rows.map((row) => ({
    entityType: row.alga_entity_type as string,
    entityId: row.alga_entity_id as string,
    meta: parseMetadata(row.metadata),
  }));

  const contactIds = parsed
    .filter((row) => row.entityType === THREECX_CONTACT_ORIGIN_ENTITY_TYPE)
    .map((row) => row.entityId);
  const contactsById = new Map<string, any>();
  if (contactIds.length) {
    const contacts: any[] = await db
      .table('contacts')
      .whereIn('contact_name_id', contactIds)
      .select('contact_name_id', 'full_name', 'email');
    for (const contact of contacts) contactsById.set(contact.contact_name_id, contact);
  }

  const suggestedIds = Array.from(
    new Set(parsed.map((row) => metaId(row.meta, 'suggestedClientId')).filter((id): id is string => Boolean(id))),
  );
  const clientNames = new Map<string, string>();
  if (suggestedIds.length) {
    const clients: any[] = await db.table('clients').whereIn('client_id', suggestedIds).select('client_id', 'client_name');
    for (const client of clients) clientNames.set(client.client_id, client.client_name ?? '');
  }

  const items: ThreecxContactQueueItem[] = [];
  for (const row of parsed) {
    const suggestedClientId = metaId(row.meta, 'suggestedClientId');
    const suggestedClientName = suggestedClientId ? clientNames.get(suggestedClientId) ?? null : null;
    if (row.entityType === THREECX_CONTACT_ORIGIN_ENTITY_TYPE) {
      const contact = contactsById.get(row.entityId);
      if (!contact) continue;
      items.push({
        kind: 'unmapped',
        contactId: row.entityId,
        fullName: contact.full_name ?? '',
        email: contact.email ?? '',
        companyName: metaString(row.meta, 'companyName'),
        suggestedClientId,
        suggestedClientName,
      });
    } else {
      items.push({
        kind: 'pending',
        pendingId: row.entityId,
        firstName: metaString(row.meta, 'firstName'),
        lastName: metaString(row.meta, 'lastName'),
        number: metaString(row.meta, 'number'),
        companyName: metaString(row.meta, 'company'),
        suggestedClientId,
        suggestedClientName,
      });
    }
  }
  return items;
}

async function assertClientExists(db: ReturnType<typeof tenantDb>, clientId: string): Promise<void> {
  const client = await db.table('clients').where({ client_id: clientId }).first('client_id');
  if (!client) throw new Error('FOREIGN_KEY_ERROR: The selected client no longer exists');
}

/** Attaches the contact to a client (or leaves it without one) and clears its queue row. */
export async function mapThreecxContactToClient(
  tenantId: string,
  input: { contactId: string; clientId: string | null },
): Promise<void> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);

  if (input.clientId) {
    await assertClientExists(db, input.clientId);
    await db
      .table('contacts')
      .where({ contact_name_id: input.contactId })
      .update({ client_id: input.clientId, updated_at: knex.fn.now() });
  }

  await queueRowsQuery(db, THREECX_CONTACT_ORIGIN_ENTITY_TYPE).where({ alga_entity_id: input.contactId }).delete();
}

export interface ThreecxCompletePendingContactInput {
  pendingId: string;
  firstName: string;
  lastName: string;
  email: string;
  number: string;
  clientId: string | null;
}

/** Creates the contact the pending row stood in for, then removes the row. */
export async function completeThreecxPendingContact(
  tenantId: string,
  input: ThreecxCompletePendingContactInput,
): Promise<{ contactId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('VALIDATION_ERROR: Please enter a valid email address');
  }

  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const pending = await queueRowsQuery(db, THREECX_CONTACT_PENDING_ENTITY_TYPE)
    .where({ alga_entity_id: input.pendingId })
    .first('alga_entity_id');
  if (!pending) {
    throw new Error('NOT_FOUND: The pending 3CX contact no longer exists');
  }

  const number = input.number.trim();
  const created = await createContactRecord(tenantId, {
    fullName: buildFullName(input.firstName.trim(), input.lastName.trim(), [number, email]),
    email,
    number,
    clientId: input.clientId,
  });

  await queueRowsQuery(db, THREECX_CONTACT_PENDING_ENTITY_TYPE).where({ alga_entity_id: input.pendingId }).delete();

  return { contactId: created.contact_name_id };
}

/** Drops a pending row without creating anything. */
export async function dismissThreecxPendingContact(tenantId: string, input: { pendingId: string }): Promise<void> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  await queueRowsQuery(db, THREECX_CONTACT_PENDING_ENTITY_TYPE).where({ alga_entity_id: input.pendingId }).delete();
}
