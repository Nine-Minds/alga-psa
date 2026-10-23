import { createHash, randomUUID } from 'node:crypto';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { toDigits } from '@alga-psa/telephony';
import {
  createThreecxPbxClient,
  odataPageAll,
  ThreecxPbxError,
  type CreateThreecxPbxClientOptions,
  type ThreecxPbxClient,
} from './pbx/client';
import {
  getThreecxProviderConfig,
  getThreecxProviderState,
  THREECX_PROVIDER,
  updateThreecxConfig,
  type ThreecxPhonebookCounts,
  type ThreecxPhonebookSchedule,
  type ThreecxProviderConfig,
  type ThreecxProviderState,
} from './providerState';

export const THREECX_PHONEBOOK_TAG = 'AlgaPSA';
export const THREECX_PHONEBOOK_ENTITY_TYPE = 'contact';
export const THREECX_PHONEBOOK_PAGE_SIZE = 200;
const DAILY_INTERVAL_MS = 23 * 60 * 60 * 1000;

/** The Pbx.Contact fields AlgaPSA owns on a company phonebook entry. */
export interface PbxContactPayload {
  FirstName: string;
  LastName: string;
  CompanyName: string;
  Email: string;
  Tag: string;
  PhoneNumber: string;
  Business: string;
  Business2: string;
  Mobile2: string;
  Home: string;
  Other: string;
}

/** A Pbx.Contact as the XAPI returns it. */
export interface PbxContact extends Partial<PbxContactPayload> {
  Id: number;
  ContactType?: string | null;
  BusinessFax?: string | null;
  Pager?: string | null;
}

export interface PhonebookContactSource {
  full_name: string;
  email: string | null;
}

export interface PhonebookPhone {
  phone_number: string;
  canonical_type: string | null;
  is_default: boolean;
  display_order: number;
}

type PhoneSlot = 'Business' | 'Business2' | 'Mobile2' | 'Home' | 'Other';
const PHONE_SLOTS: PhoneSlot[] = ['Business', 'Business2', 'Mobile2', 'Home', 'Other'];
const SLOTS_BY_TYPE: Record<string, PhoneSlot[]> = {
  work: ['Business', 'Business2', 'Other'],
  business: ['Business', 'Business2', 'Other'],
  mobile: ['Mobile2', 'Other'],
  home: ['Home', 'Other'],
};

/** Canonical type each imported PBX field implies. */
const IMPORT_FIELDS: Array<[keyof PbxContactPayload, string]> = [
  ['PhoneNumber', 'work'],
  ['Business', 'work'],
  ['Business2', 'work'],
  ['Mobile2', 'mobile'],
  ['Home', 'home'],
  ['Other', 'other'],
];

function splitName(fullName: string | null | undefined): { FirstName: string; LastName: string } {
  const trimmed = (fullName ?? '').trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { FirstName: trimmed, LastName: '' };
  return { FirstName: trimmed.slice(0, spaceIndex), LastName: trimmed.slice(spaceIndex + 1).trim() };
}

function orderedPhones(phones: PhonebookPhone[]): PhonebookPhone[] {
  return phones
    .filter((phone) => (phone.phone_number ?? '').trim())
    .slice()
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.display_order - b.display_order);
}

export function buildPbxContact(
  contact: PhonebookContactSource,
  phones: PhonebookPhone[],
  clientName: string | null,
): PbxContactPayload {
  const payload: PbxContactPayload = {
    ...splitName(contact.full_name),
    CompanyName: clientName ?? '',
    Email: (contact.email ?? '').trim(),
    Tag: THREECX_PHONEBOOK_TAG,
    PhoneNumber: '',
    Business: '',
    Business2: '',
    Mobile2: '',
    Home: '',
    Other: '',
  };
  const [primary, ...rest] = orderedPhones(phones);
  if (!primary) return payload;
  payload.PhoneNumber = primary.phone_number.trim();
  for (const phone of rest) {
    const preferred = SLOTS_BY_TYPE[(phone.canonical_type ?? '').toLowerCase()] ?? ['Other'];
    const slot = [...preferred, ...PHONE_SLOTS].find((candidate) => !payload[candidate]);
    if (slot) payload[slot] = phone.phone_number.trim();
  }
  return payload;
}

export function pbxContactFingerprint(payload: PbxContactPayload): string {
  const stable: Record<string, string> = {};
  for (const key of Object.keys(payload).sort()) {
    stable[key] = String(payload[key as keyof PbxContactPayload] ?? '');
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/** The entry as the PBX holds it, so a mapping adopted on import is refreshed by the next push. */
function pbxEntryFingerprint(entry: PbxContact): string {
  return pbxContactFingerprint({
    FirstName: entry.FirstName ?? '',
    LastName: entry.LastName ?? '',
    CompanyName: entry.CompanyName ?? '',
    Email: entry.Email ?? '',
    Tag: entry.Tag ?? '',
    PhoneNumber: entry.PhoneNumber ?? '',
    Business: entry.Business ?? '',
    Business2: entry.Business2 ?? '',
    Mobile2: entry.Mobile2 ?? '',
    Home: entry.Home ?? '',
    Other: entry.Other ?? '',
  });
}

export function emptyThreecxPhonebookCounts(): ThreecxPhonebookCounts {
  return { created: 0, updated: 0, deleted: 0, imported: 0, skipped: 0 };
}

export function isThreecxPhonebookActive(config: ThreecxProviderConfig): boolean {
  return config.phonebook.enabled && config.pbx.status === 'connected' && config.pbx.capabilities.xapi;
}

export function isThreecxPhonebookRunDue(config: ThreecxProviderConfig, now: Date = new Date()): boolean {
  if (!isThreecxPhonebookActive(config)) return false;
  const { schedule, lastPushAt } = config.phonebook;
  if (schedule === 'hourly' || !lastPushAt) return true;
  const last = Date.parse(lastPushAt);
  return !Number.isFinite(last) || now.getTime() - last > DAILY_INTERVAL_MS;
}

interface ContactRow {
  contact_name_id: string;
  full_name: string;
  email: string | null;
  client_id: string | null;
  is_inactive: boolean | null;
}

interface PhoneRow extends PhonebookPhone {
  contact_name_id: string;
}

interface MappingRow {
  id: string;
  alga_entity_id: string;
  external_entity_id: string;
  metadata: { fingerprint?: string } | null;
}

interface PhonebookDb {
  knex: any;
  tenantId: string;
  realm: string;
}

async function openDb(tenantId: string, client: ThreecxPbxClient, knex?: any): Promise<PhonebookDb> {
  return { knex: knex ?? (await createTenantKnex(tenantId)).knex, tenantId, realm: client.baseUrl };
}

function table(db: PhonebookDb, name: string): any {
  return tenantDb(db.knex, db.tenantId).table(name);
}

async function loadContacts(db: PhonebookDb, contactIds?: string[]): Promise<ContactRow[]> {
  const query = table(db, 'contacts');
  if (contactIds) query.whereIn('contact_name_id', contactIds);
  return query.select('contact_name_id', 'full_name', 'email', 'client_id', 'is_inactive');
}

async function loadPhones(db: PhonebookDb, contactIds: string[]): Promise<Map<string, PhoneRow[]>> {
  const byContact = new Map<string, PhoneRow[]>();
  if (contactIds.length === 0) return byContact;
  const rows: PhoneRow[] = await table(db, 'contact_phone_numbers')
    .whereIn('contact_name_id', contactIds)
    .orderBy('display_order', 'asc')
    .select('contact_name_id', 'phone_number', 'canonical_type', 'is_default', 'display_order');
  for (const row of rows) {
    const list = byContact.get(row.contact_name_id) ?? [];
    list.push(row);
    byContact.set(row.contact_name_id, list);
  }
  return byContact;
}

async function loadClientNames(db: PhonebookDb, clientIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (clientIds.length === 0) return names;
  const rows: Array<{ client_id: string; client_name: string | null }> = await table(db, 'clients')
    .whereIn('client_id', clientIds)
    .select('client_id', 'client_name');
  for (const row of rows) names.set(row.client_id, row.client_name ?? '');
  return names;
}

async function loadMappings(db: PhonebookDb, contactIds?: string[]): Promise<MappingRow[]> {
  const query = table(db, 'tenant_external_entity_mappings')
    .where({ integration_type: THREECX_PROVIDER, alga_entity_type: THREECX_PHONEBOOK_ENTITY_TYPE, external_realm_id: db.realm })
    .whereNull('deleted_at');
  if (contactIds) query.whereIn('alga_entity_id', contactIds);
  return query.select('id', 'alga_entity_id', 'external_entity_id', 'metadata');
}

async function insertMapping(db: PhonebookDb, contactId: string, externalId: string, fingerprint: string): Promise<void> {
  await table(db, 'tenant_external_entity_mappings')
    .where({ integration_type: THREECX_PROVIDER, alga_entity_type: THREECX_PHONEBOOK_ENTITY_TYPE, alga_entity_id: contactId })
    .delete();
  await table(db, 'tenant_external_entity_mappings').insert({
    tenant: db.tenantId,
    integration_type: THREECX_PROVIDER,
    alga_entity_type: THREECX_PHONEBOOK_ENTITY_TYPE,
    alga_entity_id: contactId,
    external_entity_id: externalId,
    external_realm_id: db.realm,
    sync_status: 'synced',
    last_synced_at: new Date().toISOString(),
    metadata: { fingerprint },
  });
}

async function updateMapping(db: PhonebookDb, mappingId: string, externalId: string, fingerprint: string): Promise<void> {
  await table(db, 'tenant_external_entity_mappings').where({ id: mappingId }).update({
    external_entity_id: externalId,
    sync_status: 'synced',
    last_synced_at: new Date().toISOString(),
    metadata: { fingerprint },
  });
}

async function deleteMapping(db: PhonebookDb, mappingId: string): Promise<void> {
  await table(db, 'tenant_external_entity_mappings').where({ id: mappingId }).delete();
}

function isNotFound(error: unknown): boolean {
  return error instanceof ThreecxPbxError && error.status === 404;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createPbxEntry(client: ThreecxPbxClient, payload: PbxContactPayload): Promise<string> {
  const created = await client.xapiPost<PbxContact>('/Contacts', payload);
  const id = created?.Id;
  if (id === undefined || id === null) {
    throw new ThreecxPbxError('The PBX created the contact without returning an Id.', 0, '');
  }
  return String(id);
}

async function deletePbxEntry(client: ThreecxPbxClient, externalId: string): Promise<void> {
  try {
    await client.xapiDelete(`/Contacts(${externalId})`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export interface ThreecxPhonebookPushOptions extends CreateThreecxPbxClientOptions {
  client?: ThreecxPbxClient;
  contactIds?: string[];
  knex?: any;
}

/**
 * One pass over the contact set: create entries for unmapped active contacts
 * with a phone, PATCH mapped ones whose fingerprint moved, DELETE mapped ones
 * that are inactive, gone or phoneless. A failure on one contact is counted
 * and recorded; the rest of the set still runs.
 */
export async function pushThreecxPhonebook(
  tenantId: string,
  options: ThreecxPhonebookPushOptions = {},
): Promise<ThreecxPhonebookCounts> {
  const client = options.client ?? (await createThreecxPbxClient(tenantId, options));
  const db = await openDb(tenantId, client, options.knex);
  const counts = emptyThreecxPhonebookCounts();
  let lastError: string | null = null;

  const contacts = await loadContacts(db, options.contactIds);
  const contactIds = contacts.map((row) => row.contact_name_id);
  const [phones, clientNames, mappings] = await Promise.all([
    loadPhones(db, contactIds),
    loadClientNames(db, [...new Set(contacts.map((row) => row.client_id).filter((id): id is string => Boolean(id)))]),
    loadMappings(db, options.contactIds),
  ]);
  const mappingByContact = new Map(mappings.map((row) => [row.alga_entity_id, row]));

  for (const contact of contacts) {
    const mapping = mappingByContact.get(contact.contact_name_id);
    mappingByContact.delete(contact.contact_name_id);
    try {
      const contactPhones = phones.get(contact.contact_name_id) ?? [];
      const wanted = !contact.is_inactive && orderedPhones(contactPhones).length > 0;
      if (!wanted) {
        if (mapping) {
          await deletePbxEntry(client, mapping.external_entity_id);
          await deleteMapping(db, mapping.id);
          counts.deleted += 1;
        } else {
          counts.skipped += 1;
        }
        continue;
      }

      const payload = buildPbxContact(
        contact,
        contactPhones,
        contact.client_id ? (clientNames.get(contact.client_id) ?? null) : null,
      );
      const fingerprint = pbxContactFingerprint(payload);

      if (!mapping) {
        await insertMapping(db, contact.contact_name_id, await createPbxEntry(client, payload), fingerprint);
        counts.created += 1;
        continue;
      }
      if (mapping.metadata?.fingerprint === fingerprint) {
        counts.skipped += 1;
        continue;
      }
      try {
        await client.xapiPatch(`/Contacts(${mapping.external_entity_id})`, payload);
        await updateMapping(db, mapping.id, mapping.external_entity_id, fingerprint);
        counts.updated += 1;
      } catch (error) {
        if (!isNotFound(error)) throw error;
        await updateMapping(db, mapping.id, await createPbxEntry(client, payload), fingerprint);
        counts.created += 1;
      }
    } catch (error) {
      counts.skipped += 1;
      lastError = errorMessage(error);
    }
  }

  // Mappings whose contact row is gone.
  for (const mapping of mappingByContact.values()) {
    try {
      await deletePbxEntry(client, mapping.external_entity_id);
      await deleteMapping(db, mapping.id);
      counts.deleted += 1;
    } catch (error) {
      counts.skipped += 1;
      lastError = errorMessage(error);
    }
  }

  await updateThreecxConfig(
    tenantId,
    (config) => ({
      ...config,
      phonebook: { ...config.phonebook, lastPushAt: new Date().toISOString(), lastPushCounts: counts, lastError },
    }),
    db.knex,
  );
  return counts;
}

export interface ThreecxPhonebookImportOptions extends CreateThreecxPbxClientOptions {
  client?: ThreecxPbxClient;
  knex?: any;
}

function matchContact(entry: PbxContact, byEmail: Map<string, ContactRow>, byName: Map<string, ContactRow[]>): ContactRow | null {
  const email = (entry.Email ?? '').trim().toLowerCase();
  if (email && byEmail.has(email)) return byEmail.get(email)!;
  const name = [entry.FirstName, entry.LastName].map((part) => (part ?? '').trim()).filter(Boolean).join(' ').toLowerCase();
  const candidates = name ? byName.get(name) ?? [] : [];
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Adopts PBX-side numbers onto matching Alga contacts. Entries AlgaPSA pushed
 * (mapped, or tagged) are skipped; nothing is ever created or removed on the
 * Alga side. An adopted entry gets a mapping so the next push refreshes it in
 * place instead of creating a twin.
 */
export async function importThreecxPhonebook(
  tenantId: string,
  options: ThreecxPhonebookImportOptions = {},
): Promise<ThreecxPhonebookCounts> {
  const client = options.client ?? (await createThreecxPbxClient(tenantId, options));
  const db = await openDb(tenantId, client, options.knex);
  const counts = emptyThreecxPhonebookCounts();
  let lastError: string | null = null;

  const entries = await odataPageAll<PbxContact>(client, '/Contacts', {}, THREECX_PHONEBOOK_PAGE_SIZE);
  const contacts = (await loadContacts(db)).filter((row) => !row.is_inactive);
  const contactIds = contacts.map((row) => row.contact_name_id);
  const [phones, mappings] = await Promise.all([loadPhones(db, contactIds), loadMappings(db)]);
  const mappedExternalIds = new Set(mappings.map((row) => row.external_entity_id));
  const mappedContactIds = new Set(mappings.map((row) => row.alga_entity_id));

  const byEmail = new Map<string, ContactRow>();
  const byName = new Map<string, ContactRow[]>();
  for (const contact of contacts) {
    const email = (contact.email ?? '').trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, contact);
    const name = (contact.full_name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (name) byName.set(name, [...(byName.get(name) ?? []), contact]);
  }

  for (const entry of entries) {
    try {
      if (entry.Id === undefined || entry.Id === null) continue;
      if (mappedExternalIds.has(String(entry.Id)) || entry.Tag === THREECX_PHONEBOOK_TAG) continue;
      const contact = matchContact(entry, byEmail, byName);
      if (!contact) {
        counts.skipped += 1;
        continue;
      }

      const existing = phones.get(contact.contact_name_id) ?? [];
      const seen = new Set(existing.map((phone) => toDigits(phone.phone_number)).filter(Boolean));
      let nextOrder = existing.reduce((max, phone) => Math.max(max, phone.display_order + 1), 0);
      const rows: any[] = [];
      for (const [field, canonicalType] of IMPORT_FIELDS) {
        const value = (entry[field] ?? '').trim();
        const digits = toDigits(value);
        if (!digits || seen.has(digits)) continue;
        seen.add(digits);
        const row = {
          tenant: tenantId,
          contact_phone_number_id: randomUUID(),
          contact_name_id: contact.contact_name_id,
          phone_number: value,
          extension: null,
          canonical_type: canonicalType,
          custom_phone_type_id: null,
          is_default: existing.length === 0 && rows.length === 0,
          display_order: nextOrder++,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        rows.push(row);
      }
      if (rows.length > 0) {
        await table(db, 'contact_phone_numbers').insert(rows);
        existing.push(...rows);
        phones.set(contact.contact_name_id, existing);
        counts.imported += rows.length;
      }
      if (!mappedContactIds.has(contact.contact_name_id)) {
        await insertMapping(db, contact.contact_name_id, String(entry.Id), pbxEntryFingerprint(entry));
        mappedContactIds.add(contact.contact_name_id);
        mappedExternalIds.add(String(entry.Id));
      }
    } catch (error) {
      counts.skipped += 1;
      lastError = errorMessage(error);
    }
  }

  await updateThreecxConfig(
    tenantId,
    (config) => ({
      ...config,
      phonebook: { ...config.phonebook, lastImportAt: new Date().toISOString(), lastImportCounts: counts, lastError },
    }),
    db.knex,
  );
  return counts;
}

/** Single-contact push; an archived or deleted contact drops its PBX entry. */
export async function syncThreecxPhonebookContact(
  tenantId: string,
  contactId: string,
  options: Omit<ThreecxPhonebookPushOptions, 'contactIds'> = {},
): Promise<ThreecxPhonebookCounts> {
  return pushThreecxPhonebook(tenantId, { ...options, contactIds: [contactId] });
}

export async function setThreecxPhonebookSync(
  tenantId: string,
  input: { enabled: boolean; schedule: ThreecxPhonebookSchedule },
): Promise<ThreecxProviderState> {
  await updateThreecxConfig(tenantId, (config) => ({
    ...config,
    phonebook: {
      ...config.phonebook,
      enabled: Boolean(input.enabled),
      schedule: input.schedule === 'hourly' ? 'hourly' : 'daily',
    },
  }));
  return getThreecxProviderState(tenantId);
}

export interface ThreecxPhonebookReconcileOptions extends CreateThreecxPbxClientOptions {
  client?: ThreecxPbxClient;
  knex?: any;
  now?: Date;
}

export interface ThreecxPhonebookReconcileResult {
  ran: boolean;
  push?: ThreecxPhonebookCounts;
  import?: ThreecxPhonebookCounts;
}

/** Scheduled entry point: when the tenant is due, push then import. */
export async function reconcileThreecxPhonebook(
  tenantId: string,
  options: ThreecxPhonebookReconcileOptions = {},
): Promise<ThreecxPhonebookReconcileResult> {
  const knex = options.knex ?? (await createTenantKnex(tenantId)).knex;
  const loaded = await getThreecxProviderConfig(tenantId, knex);
  if (!loaded || !isThreecxPhonebookRunDue(loaded.config, options.now)) return { ran: false };
  const { now: _now, ...rest } = options;
  const push = await pushThreecxPhonebook(tenantId, { ...rest, knex });
  const imported = await importThreecxPhonebook(tenantId, { ...rest, knex });
  return { ran: true, push, import: imported };
}
