import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory tenant tables faithful to the chains phonebook.ts and
 * providerState.ts use: where(obj), whereIn, whereNull, orderBy, select,
 * first, insert, update, delete. Every table is tenant-scoped through the
 * mocked tenantDb, so the `tenant` filter is exercised too.
 */
const hoisted = vi.hoisted(() => {
  const store: Record<string, any[]> = {
    telephony_providers: [],
    contacts: [],
    clients: [],
    contact_phone_numbers: [],
    tenant_external_entity_mappings: [],
  };
  const faults = { insert: null as ((rows: any[]) => boolean) | null };

  function createQuery(rows: any[]) {
    const preds: Array<(row: any) => boolean> = [];
    let order: { col: string; dir: string } | null = null;
    const filtered = () => {
      const out = rows.filter((row) => preds.every((p) => p(row)));
      if (order) {
        const { col, dir } = order;
        out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return out;
    };
    const query: any = {
      where(cond: Record<string, unknown>) {
        preds.push((row) => Object.entries(cond).every(([k, v]) => row[k] === v));
        return query;
      },
      whereIn(col: string, values: unknown[]) {
        preds.push((row) => values.includes(row[col]));
        return query;
      },
      whereNull(col: string) {
        preds.push((row) => row[col] === null || row[col] === undefined);
        return query;
      },
      orderBy(col: string, dir = 'asc') {
        order = { col, dir };
        return query;
      },
      async select() {
        return filtered().map((row) => ({ ...row }));
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
      async insert(values: any | any[]) {
        const list = Array.isArray(values) ? values : [values];
        if (faults.insert?.(list)) throw new Error('insert exploded');
        for (const value of list) {
          rows.push({ id: value.id ?? `row-${rows.length + 1}`, ...value });
        }
        return [];
      },
      async update(values: Record<string, unknown>) {
        const hits = filtered();
        hits.forEach((row) => Object.assign(row, values));
        return hits.length;
      },
      async delete() {
        const hits = new Set(filtered());
        for (let i = rows.length - 1; i >= 0; i -= 1) if (hits.has(rows[i])) rows.splice(i, 1);
        return hits.size;
      },
    };
    return query;
  }

  const knexMock: any = () => createQuery(store.telephony_providers);
  knexMock.fn = { now: () => 'NOW()' };
  return { store, faults, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => hoisted.createQuery(hoisted.store[name]).where({ tenant }),
  }),
}));
vi.mock('@alga-psa/telephony', () => ({
  toDigits: (value: unknown) => (typeof value === 'string' ? value.replace(/\D+/g, '') : ''),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => 'shh' }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import { ThreecxPbxError, type ThreecxPbxClient } from './pbx/client';
import { parseThreecxConfig } from './providerState';
import {
  buildPbxContact,
  importThreecxPhonebook,
  isThreecxPhonebookRunDue,
  pbxContactFingerprint,
  pushThreecxPhonebook,
  reconcileThreecxPhonebook,
  setThreecxPhonebookSync,
  syncThreecxPhonebookContact,
  type PbxContact,
} from './phonebook';

const TENANT = 'tenant-1';
const BASE_URL = 'https://pbx.example.com';

interface FakePbx extends ThreecxPbxClient {
  calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }>;
  entries: PbxContact[];
  failPatchWith: ThreecxPbxError | null;
  failDeleteWith: ThreecxPbxError | null;
  failPostFor: ((body: any) => boolean) | null;
}

function fakeClient(entries: PbxContact[] = []): FakePbx {
  let nextId = 100;
  const client: FakePbx = {
    baseUrl: BASE_URL,
    calls: [],
    entries,
    failPatchWith: null,
    failDeleteWith: null,
    failPostFor: null,
    async xapiGet(path: string, query?: any) {
      client.calls.push({ method: 'GET', path, query });
      const top = Number(query?.$top ?? 200);
      const skip = Number(query?.$skip ?? 0);
      return { value: client.entries.slice(skip, skip + top) } as any;
    },
    async xapiPost(path: string, body?: any) {
      client.calls.push({ method: 'POST', path, body });
      if (client.failPostFor?.(body)) throw new ThreecxPbxError('PBX POST /Contacts failed (500)', 500, 'boom');
      const created = { Id: nextId++, ...body };
      client.entries.push(created);
      return created as any;
    },
    async xapiPatch(path: string, body?: any) {
      client.calls.push({ method: 'PATCH', path, body });
      if (client.failPatchWith) throw client.failPatchWith;
      return undefined as any;
    },
    async xapiDelete(path: string) {
      client.calls.push({ method: 'DELETE', path });
      if (client.failDeleteWith) throw client.failDeleteWith;
    },
    async xapiDownload() {
      return new Uint8Array();
    },
    async callControlGet() {
      return undefined as any;
    },
    async callControlPost() {
      return undefined as any;
    },
    async accessToken() {
      return 'tok';
    },
  };
  return client;
}

function calls(client: FakePbx, method: string) {
  return client.calls.filter((call) => call.method === method);
}

function seedProvider(phonebook: Record<string, unknown> = {}) {
  hoisted.store.telephony_providers.push({
    tenant: TENANT,
    provider: '3cx',
    provider_id: 'p1',
    status: 'active',
    webhook_secret: 'key',
    config: JSON.stringify({
      pbx: { baseUrl: BASE_URL, clientId: '900', clientSecretRef: 'ref', status: 'connected', capabilities: { xapi: true, callControl: true } },
      phonebook: { enabled: true, schedule: 'daily', ...phonebook },
    }),
  });
}

function providerConfig() {
  return parseThreecxConfig(hoisted.store.telephony_providers[0].config);
}

function seedContact(
  id: string,
  full_name: string,
  email: string | null,
  phones: Array<Partial<{ phone_number: string; canonical_type: string; is_default: boolean }>> = [],
  extra: Record<string, unknown> = {},
) {
  hoisted.store.contacts.push({ tenant: TENANT, contact_name_id: id, full_name, email, client_id: null, is_inactive: false, ...extra });
  phones.forEach((phone, index) => {
    hoisted.store.contact_phone_numbers.push({
      tenant: TENANT,
      contact_phone_number_id: `${id}-p${index}`,
      contact_name_id: id,
      phone_number: phone.phone_number ?? '',
      canonical_type: phone.canonical_type ?? 'work',
      is_default: phone.is_default ?? index === 0,
      display_order: index,
    });
  });
}

function seedMapping(contactId: string, externalId: string, fingerprint: string, realm = BASE_URL) {
  hoisted.store.tenant_external_entity_mappings.push({
    id: `map-${contactId}`,
    tenant: TENANT,
    integration_type: '3cx',
    alga_entity_type: 'contact',
    alga_entity_id: contactId,
    external_entity_id: externalId,
    external_realm_id: realm,
    sync_status: 'synced',
    metadata: { fingerprint },
    deleted_at: null,
  });
}

function mappings() {
  return hoisted.store.tenant_external_entity_mappings;
}

function phonesOf(contactId: string) {
  return hoisted.store.contact_phone_numbers.filter((row) => row.contact_name_id === contactId);
}

beforeEach(() => {
  for (const key of Object.keys(hoisted.store)) hoisted.store[key].length = 0;
  hoisted.faults.insert = null;
});

describe('buildPbxContact', () => {
  it('T101: splits full_name, sets CompanyName from the client and Tag AlgaPSA', () => {
    const payload = buildPbxContact({ full_name: 'Ada Lovelace Byron', email: 'ada@example.com' }, [], 'Analytical Engines');
    expect(payload).toMatchObject({
      FirstName: 'Ada',
      LastName: 'Lovelace Byron',
      CompanyName: 'Analytical Engines',
      Email: 'ada@example.com',
      Tag: 'AlgaPSA',
      PhoneNumber: '',
    });
    expect(buildPbxContact({ full_name: 'Cher', email: null }, [], null)).toMatchObject({ FirstName: 'Cher', LastName: '', CompanyName: '', Email: '' });
  });

  it('T102: puts the default number in PhoneNumber, a mobile in Mobile2, a business in Business', () => {
    const payload = buildPbxContact({ full_name: 'Ada Lovelace', email: null }, [
      { phone_number: '+1 555 0100', canonical_type: 'work', is_default: false, display_order: 0 },
      { phone_number: '+1 555 0101', canonical_type: 'mobile', is_default: false, display_order: 1 },
      { phone_number: '+1 555 0102', canonical_type: 'home', is_default: true, display_order: 2 },
      { phone_number: '+1 555 0103', canonical_type: 'work', is_default: false, display_order: 3 },
      { phone_number: '+1 555 0104', canonical_type: 'fax', is_default: false, display_order: 4 },
    ], null);
    expect(payload.PhoneNumber).toBe('+1 555 0102');
    expect(payload.Business).toBe('+1 555 0100');
    expect(payload.Mobile2).toBe('+1 555 0101');
    expect(payload.Business2).toBe('+1 555 0103');
    expect(payload.Home).toBe('');
    expect(payload.Other).toBe('+1 555 0104');
  });

  it('fingerprints the payload stably regardless of key order', () => {
    const a = buildPbxContact({ full_name: 'Ada Lovelace', email: 'a@x.io' }, [], 'Co');
    const b = { ...a };
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as unknown as typeof a;
    expect(pbxContactFingerprint(a)).toBe(pbxContactFingerprint(reordered));
    expect(pbxContactFingerprint(a)).not.toBe(pbxContactFingerprint({ ...a, Email: 'b@x.io' }));
  });
});

describe('pushThreecxPhonebook', () => {
  it('T103 / T225: creates an entry for an active contact with a phone and stores the mapping with the fingerprint', async () => {
    seedProvider();
    hoisted.store.clients.push({ tenant: TENANT, client_id: 'client-1', client_name: 'Acme' });
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100', canonical_type: 'mobile' }], { client_id: 'client-1' });
    const client = fakeClient();

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 1, updated: 0, deleted: 0, skipped: 0 });
    const [post] = calls(client, 'POST');
    expect(post.path).toBe('/Contacts');
    expect(post.body).toMatchObject({ FirstName: 'Ada', LastName: 'Lovelace', CompanyName: 'Acme', PhoneNumber: '+1 555 0100', Tag: 'AlgaPSA' });
    expect(mappings()).toHaveLength(1);
    expect(mappings()[0]).toMatchObject({
      tenant: TENANT,
      integration_type: '3cx',
      alga_entity_type: 'contact',
      alga_entity_id: 'c1',
      external_entity_id: '100',
      external_realm_id: BASE_URL,
      sync_status: 'synced',
      metadata: { fingerprint: pbxContactFingerprint(post.body as any) },
    });
    const config = providerConfig();
    expect(config.phonebook.lastPushAt).toBeTruthy();
    expect(config.phonebook.lastPushCounts).toEqual(counts);
    expect(config.phonebook.lastError).toBeNull();
  });

  it('T104: skips a contact with no phone numbers', async () => {
    seedProvider();
    seedContact('c1', 'No Phone', 'np@acme.io');
    const client = fakeClient();

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 0, skipped: 1 });
    expect(client.calls).toEqual([]);
    expect(mappings()).toHaveLength(0);
  });

  it('T105: skips an inactive contact without a mapping', async () => {
    seedProvider();
    seedContact('c1', 'Gone Person', 'gone@acme.io', [{ phone_number: '+1 555 0100' }], { is_inactive: true });
    const client = fakeClient();

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 0, deleted: 0, skipped: 1 });
    expect(client.calls).toEqual([]);
  });

  it('T106: PATCHes when the fingerprint changed and skips when unchanged', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    seedMapping('c1', '42', 'stale');
    const client = fakeClient();

    const first = await pushThreecxPhonebook(TENANT, { client });
    expect(first).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const [patch] = calls(client, 'PATCH');
    expect(patch.path).toBe('/Contacts(42)');
    expect(mappings()[0].metadata.fingerprint).toBe(pbxContactFingerprint(patch.body as any));

    client.calls.length = 0;
    const second = await pushThreecxPhonebook(TENANT, { client });
    expect(second).toMatchObject({ updated: 0, skipped: 1 });
    expect(client.calls).toEqual([]);
  });

  it('T107: DELETEs the entry and mapping for a deactivated mapped contact', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }], { is_inactive: true });
    seedMapping('c1', '42', 'fp');
    const client = fakeClient();

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ deleted: 1 });
    expect(calls(client, 'DELETE')[0].path).toBe('/Contacts(42)');
    expect(mappings()).toHaveLength(0);
  });

  it('deletes the entry for a mapped contact whose row is gone or lost its last number', async () => {
    seedProvider();
    seedMapping('gone', '7', 'fp');
    seedContact('c2', 'No Numbers', 'nn@acme.io');
    seedMapping('c2', '8', 'fp');
    const client = fakeClient();

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ deleted: 2 });
    expect(calls(client, 'DELETE').map((call) => call.path).sort()).toEqual(['/Contacts(7)', '/Contacts(8)']);
    expect(mappings()).toHaveLength(0);
  });

  it('T108: a 404 on PATCH recreates the entry and updates the mapping', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    seedMapping('c1', '42', 'stale');
    const client = fakeClient();
    client.failPatchWith = new ThreecxPbxError('PBX PATCH failed (404)', 404, '');

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(calls(client, 'POST')).toHaveLength(1);
    expect(mappings()).toHaveLength(1);
    expect(mappings()[0]).toMatchObject({ alga_entity_id: 'c1', external_entity_id: '100' });
    expect(providerConfig().phonebook.lastError).toBeNull();
  });

  it('T109: a 404 on DELETE drops the mapping without error', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }], { is_inactive: true });
    seedMapping('c1', '42', 'fp');
    const client = fakeClient();
    client.failDeleteWith = new ThreecxPbxError('PBX DELETE failed (404)', 404, '');

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ deleted: 1, skipped: 0 });
    expect(mappings()).toHaveLength(0);
    expect(providerConfig().phonebook.lastError).toBeNull();
  });

  it('T122: a PBX error on one contact is recorded in lastError and the remaining contacts are still pushed', async () => {
    seedProvider();
    seedContact('c1', 'Bad Apple', 'bad@acme.io', [{ phone_number: '+1 555 0100' }]);
    seedContact('c2', 'Good Egg', 'good@acme.io', [{ phone_number: '+1 555 0200' }]);
    const client = fakeClient();
    client.failPostFor = (body) => body.FirstName === 'Bad';

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 1, skipped: 1 });
    expect(mappings().map((row) => row.alga_entity_id)).toEqual(['c2']);
    expect(providerConfig().phonebook.lastError).toContain('PBX POST /Contacts failed (500)');
  });

  it('ignores mappings for a different PBX realm', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    seedMapping('c1', '42', 'fp', 'https://old-pbx.example.com');
    const client = fakeClient();

    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 1 });
    expect(calls(client, 'PATCH')).toHaveLength(0);
  });

  it('T119: syncThreecxPhonebookContact only touches the given contact and deletes an archived one', async () => {
    seedProvider();
    seedContact('c1', 'Archived One', 'a@acme.io', [{ phone_number: '+1 555 0100' }], { is_inactive: true });
    seedMapping('c1', '42', 'fp');
    seedContact('c2', 'Untouched', 'u@acme.io', [{ phone_number: '+1 555 0200' }]);
    const client = fakeClient();

    const counts = await syncThreecxPhonebookContact(TENANT, 'c1', { client });

    expect(counts).toMatchObject({ deleted: 1, created: 0 });
    expect(client.calls.map((call) => call.method)).toEqual(['DELETE']);
    expect(mappings()).toHaveLength(0);
  });

  it('a deleted contact synced by id drops its entry', async () => {
    seedProvider();
    seedMapping('c-deleted', '42', 'fp');
    const client = fakeClient();

    const counts = await syncThreecxPhonebookContact(TENANT, 'c-deleted', { client });

    expect(counts).toMatchObject({ deleted: 1 });
    expect(calls(client, 'DELETE')[0].path).toBe('/Contacts(42)');
  });
});

describe('importThreecxPhonebook', () => {
  it('T069: pages GET /Contacts with $top=200', async () => {
    seedProvider();
    const entries = Array.from({ length: 201 }, (_, i) => ({ Id: i + 1, FirstName: `P${i}`, LastName: 'X', PhoneNumber: `+1 555 ${String(i).padStart(4, '0')}` }));
    const client = fakeClient(entries);

    await importThreecxPhonebook(TENANT, { client });

    const gets = calls(client, 'GET');
    expect(gets).toHaveLength(2);
    expect(gets[0]).toMatchObject({ path: '/Contacts', query: { $top: 200, $skip: 0 } });
    expect(gets[1].query).toMatchObject({ $top: 200, $skip: 200 });
  });

  it('T110: skips entries with a mapping row and entries tagged AlgaPSA', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    seedMapping('c1', '42', 'fp');
    const client = fakeClient([
      { Id: 42, FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@acme.io', PhoneNumber: '+1 555 0999' },
      { Id: 43, FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@acme.io', PhoneNumber: '+1 555 0998', Tag: 'AlgaPSA' },
    ]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 0, skipped: 0 });
    expect(phonesOf('c1')).toHaveLength(1);
    expect(mappings()).toHaveLength(1);
  });

  it('T111: matches by email ignoring case', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'Ada@Acme.io', [{ phone_number: '+1 555 0100' }]);
    const client = fakeClient([{ Id: 5, FirstName: 'Someone', LastName: 'Else', Email: 'ADA@acme.IO', Mobile2: '+1 555 0111' }]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 1 });
    expect(phonesOf('c1').map((row) => [row.phone_number, row.canonical_type])).toEqual([
      ['+1 555 0100', 'work'],
      ['+1 555 0111', 'mobile'],
    ]);
  });

  it('T112: matches by first and last name when exactly one contact matches', async () => {
    seedProvider();
    seedContact('c1', 'Grace Hopper', null);
    const client = fakeClient([{ Id: 5, FirstName: 'grace', LastName: 'HOPPER', Home: '+1 555 0300' }]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 1 });
    expect(phonesOf('c1')).toEqual([expect.objectContaining({ phone_number: '+1 555 0300', canonical_type: 'home', is_default: true, display_order: 0 })]);
  });

  it('T113: skips a name match when two contacts share the name', async () => {
    seedProvider();
    seedContact('c1', 'Grace Hopper', null);
    seedContact('c2', 'Grace Hopper', 'other@acme.io');
    const client = fakeClient([{ Id: 5, FirstName: 'Grace', LastName: 'Hopper', PhoneNumber: '+1 555 0300' }]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 0, skipped: 1 });
    expect(hoisted.store.contact_phone_numbers).toHaveLength(0);
    expect(mappings()).toHaveLength(0);
  });

  it('T114: adds a number not present and skips one present with different formatting', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 (555) 010-0000' }]);
    const client = fakeClient([{ Id: 5, Email: 'ada@acme.io', PhoneNumber: '15550100000', Business: '+1 555 0200', Business2: '+1 555 0200' }]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 1 });
    const rows = phonesOf('c1');
    expect(rows.map((row) => row.phone_number)).toEqual(['+1 (555) 010-0000', '+1 555 0200']);
    expect(rows[1]).toMatchObject({ canonical_type: 'work', is_default: false, display_order: 1, tenant: TENANT, extension: null, custom_phone_type_id: null });
  });

  it('T115: never creates a contact for an unmatched entry', async () => {
    seedProvider();
    const client = fakeClient([{ Id: 5, FirstName: 'Nobody', LastName: 'Known', Email: 'nobody@acme.io', PhoneNumber: '+1 555 0300' }]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 0, skipped: 1 });
    expect(hoisted.store.contacts).toHaveLength(0);
    expect(mappings()).toHaveLength(0);
    expect(providerConfig().phonebook.lastImportAt).toBeTruthy();
    expect(providerConfig().phonebook.lastImportCounts).toEqual(counts);
  });

  it('T116: records a mapping so the next push updates the adopted entry', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    const client = fakeClient([{ Id: 77, FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@acme.io', Mobile2: '+1 555 0111' }]);

    await importThreecxPhonebook(TENANT, { client });
    expect(mappings()).toEqual([expect.objectContaining({ alga_entity_id: 'c1', external_entity_id: '77', external_realm_id: BASE_URL })]);

    client.calls.length = 0;
    const counts = await pushThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ created: 0, updated: 1 });
    expect(calls(client, 'POST')).toHaveLength(0);
    const [patch] = calls(client, 'PATCH');
    expect(patch.path).toBe('/Contacts(77)');
    expect(patch.body).toMatchObject({ Tag: 'AlgaPSA', PhoneNumber: '+1 555 0100', Mobile2: '+1 555 0111' });
  });

  it('adopts numbers without a second mapping when the contact is already mapped elsewhere', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    seedMapping('c1', '42', 'fp');
    const client = fakeClient([{ Id: 99, Email: 'ada@acme.io', Home: '+1 555 0400' }]);

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 1 });
    expect(mappings()).toHaveLength(1);
    expect(mappings()[0].external_entity_id).toBe('42');
  });

  it('F075: an insert failure on one entry is recorded and the rest are still imported', async () => {
    seedProvider();
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io');
    seedContact('c2', 'Grace Hopper', 'grace@acme.io');
    const client = fakeClient([
      { Id: 1, Email: 'ada@acme.io', PhoneNumber: '+1 555 0100' },
      { Id: 2, Email: 'grace@acme.io', PhoneNumber: '+1 555 0200' },
    ]);
    hoisted.faults.insert = (rows) => rows[0]?.contact_name_id === 'c1';

    const counts = await importThreecxPhonebook(TENANT, { client });

    expect(counts).toMatchObject({ imported: 1, skipped: 1 });
    expect(phonesOf('c2')).toHaveLength(1);
    expect(providerConfig().phonebook.lastError).toBe('insert exploded');
  });
});

describe('scheduling', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const base = () => parseThreecxConfig({
    pbx: { baseUrl: BASE_URL, status: 'connected', capabilities: { xapi: true, callControl: false } },
    phonebook: { enabled: true, schedule: 'daily' },
  });

  it('T120: a daily tenant is due when lastPushAt is 24h old, not when it is 2h old, and when never pushed', () => {
    const stale = base();
    stale.phonebook.lastPushAt = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    expect(isThreecxPhonebookRunDue(stale, now)).toBe(true);

    const fresh = base();
    fresh.phonebook.lastPushAt = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    expect(isThreecxPhonebookRunDue(fresh, now)).toBe(false);

    expect(isThreecxPhonebookRunDue(base(), now)).toBe(true);
  });

  it('T121: an hourly tenant is due every run; disabled, disconnected or non-xapi tenants never are', () => {
    const hourly = base();
    hourly.phonebook.schedule = 'hourly';
    hourly.phonebook.lastPushAt = new Date(now.getTime() - 60 * 1000).toISOString();
    expect(isThreecxPhonebookRunDue(hourly, now)).toBe(true);

    const disabled = base();
    disabled.phonebook.enabled = false;
    expect(isThreecxPhonebookRunDue(disabled, now)).toBe(false);

    const disconnected = base();
    disconnected.pbx.status = 'error';
    expect(isThreecxPhonebookRunDue(disconnected, now)).toBe(false);

    const noXapi = base();
    noXapi.pbx.capabilities.xapi = false;
    expect(isThreecxPhonebookRunDue(noXapi, now)).toBe(false);
  });

  it('T121: reconcile runs push before import for a due tenant and nothing otherwise', async () => {
    seedProvider({ schedule: 'hourly' });
    seedContact('c1', 'Ada Lovelace', 'ada@acme.io', [{ phone_number: '+1 555 0100' }]);
    const client = fakeClient();

    const result = await reconcileThreecxPhonebook(TENANT, { client });

    expect(result.ran).toBe(true);
    expect(result.push).toMatchObject({ created: 1 });
    expect(result.import).toBeDefined();
    expect(client.calls.map((call) => call.method)).toEqual(['POST', 'GET']);

    hoisted.store.telephony_providers.length = 0;
    seedProvider({ schedule: 'daily', lastPushAt: new Date().toISOString() });
    client.calls.length = 0;
    expect(await reconcileThreecxPhonebook(TENANT, { client })).toEqual({ ran: false });
    expect(client.calls).toEqual([]);
  });

  it('F062 / F063: setThreecxPhonebookSync writes enabled and schedule and keeps the other sections', async () => {
    seedProvider();
    const state = await setThreecxPhonebookSync(TENANT, { enabled: false, schedule: 'hourly' });

    expect(state.phonebook).toMatchObject({ enabled: false, schedule: 'hourly' });
    expect(providerConfig().pbx.baseUrl).toBe(BASE_URL);
    expect(parseThreecxConfig({}).phonebook).toMatchObject({ enabled: false, schedule: 'daily' });
  });
});
