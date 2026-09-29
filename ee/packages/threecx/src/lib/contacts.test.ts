import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const store: Record<string, any[]> = {
    clients: [],
    contacts: [],
    tenant_external_entity_mappings: [],
  };
  const seq = { contact: 0 };
  const reset = () => {
    for (const rows of Object.values(store)) rows.length = 0;
    seq.contact = 0;
  };

  const escapeRe = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const likeToRegex = (pattern: string) => {
    let out = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i];
      if (ch === '\\' && i + 1 < pattern.length) {
        i += 1;
        out += escapeRe(pattern[i]);
      } else if (ch === '%') out += '.*';
      else if (ch === '_') out += '.';
      else out += escapeRe(ch);
    }
    return new RegExp(`^${out}$`, 'i');
  };

  const createQuery = (table: string) => {
    const rows = () => store[table];
    const preds: Array<(row: any) => boolean> = [];
    let order: { col: string; dir: string } | { lengthCol: string } | null = null;
    let selected: string[] | null = null;

    const pick = (row: any) => {
      if (!selected || selected.length === 0) return { ...row };
      const out: any = {};
      for (const col of selected) out[col] = row[col];
      return out;
    };
    const filtered = () => {
      const out = rows().filter((row) => preds.every((p) => p(row)));
      if (order && 'lengthCol' in order) {
        const col = order.lengthCol;
        out.sort((a, b) => String(a[col] ?? '').length - String(b[col] ?? '').length);
      } else if (order) {
        const { col, dir } = order;
        out.sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return dir === 'desc' ? -cmp : cmp;
        });
      }
      return out;
    };

    const query: any = {
      where(a: any, b?: any, c?: any) {
        if (a && typeof a === 'object') {
          preds.push((row) => Object.entries(a).every(([k, v]) => row[k] === v));
        } else if (c !== undefined) {
          if (String(b).toLowerCase() === 'ilike') {
            const re = likeToRegex(String(c));
            preds.push((row) => re.test(String(row[a] ?? '')));
          } else {
            preds.push((row) => row[a] === c);
          }
        } else {
          preds.push((row) => row[a] === b);
        }
        return query;
      },
      whereRaw(sql: string, binds: any[]) {
        const m = /lower\((\w+)\) = \?/.exec(sql);
        if (!m) throw new Error(`unsupported whereRaw in mock: ${sql}`);
        preds.push((row) => String(row[m[1]] ?? '').toLowerCase() === binds[0]);
        return query;
      },
      whereIn(col: string, vals: any[]) {
        preds.push((row) => vals.includes(row[col]));
        return query;
      },
      whereNull(col: string) {
        preds.push((row) => row[col] == null);
        return query;
      },
      orderBy(col: string, dir = 'asc') {
        order = { col, dir };
        return query;
      },
      orderByRaw(sql: string) {
        const m = /length\((\w+)\)/.exec(sql);
        if (!m) throw new Error(`unsupported orderByRaw in mock: ${sql}`);
        order = { lengthCol: m[1] };
        return query;
      },
      limit() {
        return query;
      },
      select(...cols: string[]) {
        selected = cols.flat();
        return query;
      },
      async first(...cols: string[]) {
        selected = cols.flat();
        const [row] = filtered();
        return row ? pick(row) : undefined;
      },
      async insert(values: any) {
        const list = Array.isArray(values) ? values : [values];
        for (const value of list) rows().push({ id: `row-${rows().length + 1}`, deleted_at: null, ...value });
        return [];
      },
      async update(values: any) {
        const targets = filtered();
        targets.forEach((row) => Object.assign(row, values));
        return targets.length;
      },
      async delete() {
        const targets = new Set(filtered());
        const remaining = rows().filter((row) => !targets.has(row));
        rows().length = 0;
        rows().push(...remaining);
        return targets.size;
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(filtered().map(pick)).then(resolve, reject);
      },
    };
    query.andWhere = query.where;
    query.del = query.delete;
    return query;
  };

  const knexMock: any = () => createQuery('contacts');
  knexMock.fn = { now: () => 'NOW()' };
  const trx: any = { commit() {}, rollback() {} };

  const createContact = vi.fn(async (input: any, tenant: string, _trx?: any) => {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (store.contacts.some((c) => c.tenant === tenant && c.email === email)) {
      throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
    }
    if (input.client_id && !store.clients.some((c) => c.tenant === tenant && c.client_id === input.client_id)) {
      throw new Error('FOREIGN_KEY_ERROR: The selected client no longer exists');
    }
    seq.contact += 1;
    const phones = (input.phone_numbers ?? []).map((p: any) => ({ ...p }));
    const contact = {
      contact_name_id: `contact-${seq.contact}`,
      tenant,
      full_name: input.full_name,
      email,
      client_id: input.client_id ?? null,
      is_inactive: false,
      phone_numbers: phones,
      default_phone_number: phones.find((p: any) => p.is_default)?.phone_number ?? '',
      default_phone_type: phones.length ? 'work' : undefined,
      additional_email_addresses: [],
      primary_email_canonical_type: 'work',
      primary_email_custom_type_id: null,
      primary_email_type: 'work',
      created_at: '2026-09-15T10:00:00.000Z',
    };
    store.contacts.push(contact);
    return contact;
  });
  const publishWorkflowEvent = vi.fn(async () => undefined);

  return { store, reset, createQuery, knexMock, trx, createContact, publishWorkflowEvent };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (t: string) => hoisted.createQuery(t).where({ tenant }),
  }),
  withTransaction: async (_tenant: string, cb: (trx: any) => Promise<unknown>) => cb(hoisted.trx),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: { createContact: hoisted.createContact },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: hoisted.publishWorkflowEvent,
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildContactCreatedPayload: (params: Record<string, unknown>) => ({ ...params }),
}));

import {
  completeThreecxPendingContact,
  createContactFromThreecx,
  dismissThreecxPendingContact,
  listThreecxContactQueue,
  mapThreecxContactToClient,
  resolveClientForCompany,
  threecxPendingContactUrl,
  validateThreecxCreateContactBody,
} from './contacts';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const BASE_URL = 'https://app.example.com';
const CTX = { tenantId: TENANT, baseUrl: BASE_URL };

function seedClient(clientId: string, clientName: string, overrides: Record<string, unknown> = {}) {
  hoisted.store.clients.push({ tenant: TENANT, client_id: clientId, client_name: clientName, is_inactive: false, ...overrides });
}

function seedContact(overrides: Record<string, unknown> = {}) {
  const contact = {
    tenant: TENANT,
    contact_name_id: 'contact-existing',
    full_name: 'Existing Person',
    email: 'existing@example.com',
    client_id: null,
    is_inactive: false,
    ...overrides,
  };
  hoisted.store.contacts.push(contact);
  return contact;
}

function mappingRows() {
  return hoisted.store.tenant_external_entity_mappings;
}

function seedMapping(overrides: Record<string, unknown>) {
  const row = {
    id: `row-${mappingRows().length + 1}`,
    tenant: TENANT,
    integration_type: '3cx',
    external_entity_id: 'crm-create',
    sync_status: 'pending',
    deleted_at: null,
    created_at: `2026-09-15T00:00:0${mappingRows().length}.000Z`,
    ...overrides,
  };
  mappingRows().push(row);
  return row;
}

const body = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Jane',
  lastName: 'Doe',
  number: '+15551234567',
  email: 'jane@example.com',
  company: 'Acme Corp',
  ...overrides,
});

beforeEach(() => {
  hoisted.reset();
  hoisted.createContact.mockClear();
  hoisted.publishWorkflowEvent.mockClear();
});

describe('validateThreecxCreateContactBody', () => {
  it('trims every field and accepts a body with any of name, number or email', () => {
    const result = validateThreecxCreateContactBody({ firstName: '  Jane ', lastName: '', number: ' 123 ', company: ' Acme ' });
    expect(result).toEqual({
      ok: true,
      value: { firstName: 'Jane', lastName: '', number: '123', email: '', company: 'Acme' },
    });
    expect(validateThreecxCreateContactBody({ email: 'a@b.co' }).ok).toBe(true);
    expect(validateThreecxCreateContactBody({ lastName: 'Doe' }).ok).toBe(true);
  });

  it('refuses when name, number and email are all empty', () => {
    const result = validateThreecxCreateContactBody({ firstName: ' ', lastName: '', number: '', email: '', company: 'Acme' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_request');
      expect(result.message).toBeTruthy();
    }
  });

  it('refuses non-object bodies and ignores non-string values', () => {
    expect(validateThreecxCreateContactBody(null).ok).toBe(false);
    expect(validateThreecxCreateContactBody('x').ok).toBe(false);
    expect(validateThreecxCreateContactBody([]).ok).toBe(false);
    expect(validateThreecxCreateContactBody({ firstName: 42, number: { a: 1 } }).ok).toBe(false);
  });
});

describe('resolveClientForCompany', () => {
  beforeEach(() => {
    seedClient('c-acme', 'Acme Corp');
    seedClient('c-acme-holdings', 'Acme Corp Holdings');
    seedClient('c-beta', 'Beta LLC');
    seedClient('c-inactive', 'Gamma', { is_inactive: true });
    hoisted.store.clients.push({ tenant: OTHER_TENANT, client_id: 'c-foreign', client_name: 'Delta', is_inactive: false });
  });

  it('returns the exact match ignoring case', async () => {
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, 'acme corp')).resolves.toEqual({
      clientId: 'c-acme',
      suggestedClientId: null,
    });
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, '  ACME CORP  ')).resolves.toEqual({
      clientId: 'c-acme',
      suggestedClientId: null,
    });
  });

  it('suggests the shortest partial match and null otherwise', async () => {
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, 'acme')).resolves.toEqual({
      clientId: null,
      suggestedClientId: 'c-acme',
    });
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, 'Holdings')).resolves.toEqual({
      clientId: null,
      suggestedClientId: 'c-acme-holdings',
    });
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, 'nothing here')).resolves.toEqual({
      clientId: null,
      suggestedClientId: null,
    });
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, '   ')).resolves.toEqual({
      clientId: null,
      suggestedClientId: null,
    });
  });

  it('ignores inactive clients and other tenants', async () => {
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, 'Gamma')).resolves.toEqual({
      clientId: null,
      suggestedClientId: null,
    });
    await expect(resolveClientForCompany(hoisted.knexMock, TENANT, 'Delta')).resolves.toEqual({
      clientId: null,
      suggestedClientId: null,
    });
  });
});

describe('createContactFromThreecx', () => {
  beforeEach(() => {
    seedClient('c-acme', 'Acme Corp');
    seedClient('c-acme-holdings', 'Acme Corp Holdings');
  });

  it('creates the contact with client_id, the number as default work phone, and publishes CONTACT_CREATED', async () => {
    const result = await createContactFromThreecx(CTX, body());

    expect(hoisted.createContact).toHaveBeenCalledTimes(1);
    const [input, tenant, trx] = hoisted.createContact.mock.calls[0];
    expect(tenant).toBe(TENANT);
    expect(trx).toBe(hoisted.trx);
    expect(input).toEqual({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      client_id: 'c-acme',
      phone_numbers: [{ phone_number: '+15551234567', canonical_type: 'work', is_default: true, display_order: 0 }],
    });

    expect(hoisted.publishWorkflowEvent).toHaveBeenCalledTimes(1);
    const [event] = hoisted.publishWorkflowEvent.mock.calls[0] as any[];
    expect(event.eventType).toBe('CONTACT_CREATED');
    expect(event.ctx.tenantId).toBe(TENANT);
    expect(event.payload.contactId).toBe('contact-1');
    expect(event.payload.clientId).toBe('c-acme');
    expect(event.idempotencyKey).toBe('contact_created:contact-1');

    expect(result).toEqual({
      kind: 'created',
      contact: {
        contactUrl: `${BASE_URL}/msp/contacts/contact-1`,
        firstName: 'Jane',
        lastName: 'Doe',
        companyName: 'Acme Corp',
        email: 'jane@example.com',
        phone: '+15551234567',
        entityId: 'contact-1',
        entityType: 'contact',
      },
    });
    expect(mappingRows()).toHaveLength(0);
  });

  it('answers with the existing contact and creates nothing on a duplicate email', async () => {
    seedContact({ email: 'jane@example.com', full_name: 'Jane Already Here', client_id: 'c-acme' });

    const result = await createContactFromThreecx(CTX, body({ email: 'Jane@Example.com' }));

    expect(hoisted.store.contacts).toHaveLength(1);
    expect(hoisted.publishWorkflowEvent).not.toHaveBeenCalled();
    expect(mappingRows()).toHaveLength(0);
    expect(result).toEqual({
      kind: 'existing',
      contact: {
        contactUrl: `${BASE_URL}/msp/contacts/contact-existing`,
        firstName: 'Jane',
        lastName: 'Already Here',
        companyName: 'Acme Corp',
        email: 'jane@example.com',
        phone: '+15551234567',
        entityId: 'contact-existing',
        entityType: 'contact',
      },
    });
  });

  it('writes a contact-origin row with the suggestion when no client matched exactly', async () => {
    const result = await createContactFromThreecx(CTX, body({ company: 'Acme' }));

    expect(result.kind).toBe('created');
    expect(result.contact.companyName).toBe('Acme');
    expect(hoisted.createContact.mock.calls[0][0].client_id).toBeUndefined();
    expect(hoisted.publishWorkflowEvent).not.toHaveBeenCalled();

    expect(mappingRows()).toHaveLength(1);
    const row = mappingRows()[0];
    expect(row).toMatchObject({
      tenant: TENANT,
      integration_type: '3cx',
      alga_entity_type: 'contact-origin',
      alga_entity_id: 'contact-1',
      external_entity_id: 'crm-create',
      external_realm_id: 'contact-1',
      sync_status: 'pending',
    });
    expect(JSON.parse(row.metadata)).toEqual({ companyName: 'Acme', suggestedClientId: 'c-acme', status: 'unmapped' });
  });

  it('writes a contact-pending row and creates nothing without an email', async () => {
    const result = await createContactFromThreecx(CTX, body({ email: '', company: 'Acme' }));

    expect(hoisted.createContact).not.toHaveBeenCalled();
    expect(hoisted.store.contacts).toHaveLength(0);
    expect(result.kind).toBe('pending');
    if (result.kind !== 'pending') return;

    expect(result.pendingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mappingRows()).toHaveLength(1);
    const row = mappingRows()[0];
    expect(row).toMatchObject({
      tenant: TENANT,
      integration_type: '3cx',
      alga_entity_type: 'contact-pending',
      alga_entity_id: result.pendingId,
      external_entity_id: 'crm-create',
      external_realm_id: result.pendingId,
      sync_status: 'pending',
    });
    expect(JSON.parse(row.metadata)).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
      number: '+15551234567',
      company: 'Acme',
      suggestedClientId: 'c-acme',
      status: 'pending',
    });

    expect(result.contact).toEqual({
      contactUrl: `${BASE_URL}/msp/settings/integrations?category=communication&threecxPending=${result.pendingId}`,
      firstName: 'Jane',
      lastName: 'Doe',
      companyName: 'Acme',
      email: '',
      phone: '+15551234567',
      entityId: result.pendingId,
      entityType: 'pending',
    });
    expect(result.contact.contactUrl).toBe(threecxPendingContactUrl(BASE_URL, result.pendingId));
  });

  it('falls back to the number as the full name when no name was given', async () => {
    await createContactFromThreecx(CTX, body({ firstName: '', lastName: '' }));
    expect(hoisted.createContact.mock.calls[0][0].full_name).toBe('+15551234567');

    hoisted.reset();
    await createContactFromThreecx(CTX, body({ firstName: '', lastName: '', number: '' }));
    expect(hoisted.createContact.mock.calls[1][0].full_name).toBe('jane@example.com');
    expect(hoisted.createContact.mock.calls[1][0].phone_numbers).toEqual([]);
  });
});

describe('listThreecxContactQueue', () => {
  it('returns unmapped and pending rows with the suggested client names, oldest first', async () => {
    seedClient('c-acme', 'Acme Corp');
    seedContact({ contact_name_id: 'contact-a', full_name: 'Alice A', email: 'alice@example.com' });
    seedMapping({
      alga_entity_type: 'contact-origin',
      alga_entity_id: 'contact-a',
      external_realm_id: 'contact-a',
      metadata: { companyName: 'Acme', suggestedClientId: 'c-acme', status: 'unmapped' },
    });
    seedMapping({
      alga_entity_type: 'contact-pending',
      alga_entity_id: 'pending-1',
      external_realm_id: 'pending-1',
      metadata: JSON.stringify({ firstName: 'Bob', lastName: 'B', number: '555', company: 'Nowhere', suggestedClientId: null, status: 'pending' }),
    });
    seedMapping({
      alga_entity_type: 'contact-origin',
      alga_entity_id: 'contact-gone',
      external_realm_id: 'contact-gone',
      metadata: { companyName: 'Gone', suggestedClientId: null, status: 'unmapped' },
    });
    seedMapping({
      alga_entity_type: 'contact-pending',
      alga_entity_id: 'pending-deleted',
      external_realm_id: 'pending-deleted',
      deleted_at: '2026-09-15T00:00:00.000Z',
      metadata: { firstName: 'X', lastName: 'Y', number: '', company: '', suggestedClientId: null, status: 'pending' },
    });
    seedMapping({ alga_entity_type: 'client', alga_entity_id: 'c-acme', external_realm_id: 'r', metadata: {} });
    mappingRows().push({
      tenant: OTHER_TENANT,
      integration_type: '3cx',
      alga_entity_type: 'contact-pending',
      alga_entity_id: 'pending-foreign',
      external_entity_id: 'crm-create',
      external_realm_id: 'pending-foreign',
      deleted_at: null,
      created_at: '2026-09-15T00:00:09.000Z',
      metadata: {},
    });

    await expect(listThreecxContactQueue(TENANT)).resolves.toEqual([
      {
        kind: 'unmapped',
        contactId: 'contact-a',
        fullName: 'Alice A',
        email: 'alice@example.com',
        companyName: 'Acme',
        suggestedClientId: 'c-acme',
        suggestedClientName: 'Acme Corp',
      },
      {
        kind: 'pending',
        pendingId: 'pending-1',
        firstName: 'Bob',
        lastName: 'B',
        number: '555',
        companyName: 'Nowhere',
        suggestedClientId: null,
        suggestedClientName: null,
      },
    ]);
  });
});

describe('mapThreecxContactToClient', () => {
  beforeEach(() => {
    seedClient('c-acme', 'Acme Corp');
    seedContact({ contact_name_id: 'contact-a', client_id: null });
    seedMapping({ alga_entity_type: 'contact-origin', alga_entity_id: 'contact-a', external_realm_id: 'contact-a', metadata: {} });
    seedMapping({ alga_entity_type: 'contact-origin', alga_entity_id: 'contact-b', external_realm_id: 'contact-b', metadata: {} });
  });

  it('sets client_id and removes the queue row', async () => {
    await mapThreecxContactToClient(TENANT, { contactId: 'contact-a', clientId: 'c-acme' });
    expect(hoisted.store.contacts[0].client_id).toBe('c-acme');
    expect(mappingRows().map((row) => row.alga_entity_id)).toEqual(['contact-b']);
  });

  it('only removes the row when no client is given', async () => {
    await mapThreecxContactToClient(TENANT, { contactId: 'contact-a', clientId: null });
    expect(hoisted.store.contacts[0].client_id).toBeNull();
    expect(mappingRows().map((row) => row.alga_entity_id)).toEqual(['contact-b']);
  });

  it('refuses an unknown client and keeps the row', async () => {
    await expect(mapThreecxContactToClient(TENANT, { contactId: 'contact-a', clientId: 'c-missing' })).rejects.toThrow(
      /FOREIGN_KEY_ERROR/,
    );
    expect(hoisted.store.contacts[0].client_id).toBeNull();
    expect(mappingRows()).toHaveLength(2);
  });
});

describe('completeThreecxPendingContact', () => {
  beforeEach(() => {
    seedClient('c-acme', 'Acme Corp');
    seedMapping({
      alga_entity_type: 'contact-pending',
      alga_entity_id: 'pending-1',
      external_realm_id: 'pending-1',
      metadata: { firstName: 'Bob', lastName: 'B', number: '555', company: 'Acme', suggestedClientId: 'c-acme', status: 'pending' },
    });
  });

  it('creates the contact with the entered email and deletes the pending row', async () => {
    const result = await completeThreecxPendingContact(TENANT, {
      pendingId: 'pending-1',
      firstName: 'Bob',
      lastName: 'Builder',
      email: ' Bob@Example.com ',
      number: '+15550001111',
      clientId: 'c-acme',
    });

    expect(result).toEqual({ contactId: 'contact-1' });
    expect(hoisted.createContact).toHaveBeenCalledTimes(1);
    expect(hoisted.createContact.mock.calls[0][0]).toEqual({
      full_name: 'Bob Builder',
      email: 'bob@example.com',
      client_id: 'c-acme',
      phone_numbers: [{ phone_number: '+15550001111', canonical_type: 'work', is_default: true, display_order: 0 }],
    });
    expect(hoisted.publishWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(mappingRows()).toHaveLength(0);
  });

  it('refuses an invalid email and keeps the row', async () => {
    await expect(
      completeThreecxPendingContact(TENANT, {
        pendingId: 'pending-1',
        firstName: 'Bob',
        lastName: 'B',
        email: 'not-an-email',
        number: '555',
        clientId: null,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    expect(hoisted.createContact).not.toHaveBeenCalled();
    expect(mappingRows()).toHaveLength(1);
  });

  it('refuses an unknown pending id', async () => {
    await expect(
      completeThreecxPendingContact(TENANT, {
        pendingId: 'pending-missing',
        firstName: 'Bob',
        lastName: 'B',
        email: 'bob@example.com',
        number: '',
        clientId: null,
      }),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(hoisted.createContact).not.toHaveBeenCalled();
    expect(mappingRows()).toHaveLength(1);
  });

  it('keeps the row when the model refuses the contact', async () => {
    seedContact({ email: 'bob@example.com' });
    await expect(
      completeThreecxPendingContact(TENANT, {
        pendingId: 'pending-1',
        firstName: 'Bob',
        lastName: 'B',
        email: 'bob@example.com',
        number: '',
        clientId: null,
      }),
    ).rejects.toThrow(/EMAIL_EXISTS/);
    expect(mappingRows()).toHaveLength(1);
  });
});

describe('dismissThreecxPendingContact', () => {
  it('deletes the pending row without creating a contact', async () => {
    seedMapping({ alga_entity_type: 'contact-pending', alga_entity_id: 'pending-1', external_realm_id: 'pending-1', metadata: {} });
    seedMapping({ alga_entity_type: 'contact-pending', alga_entity_id: 'pending-2', external_realm_id: 'pending-2', metadata: {} });

    await dismissThreecxPendingContact(TENANT, { pendingId: 'pending-1' });

    expect(hoisted.createContact).not.toHaveBeenCalled();
    expect(hoisted.store.contacts).toHaveLength(0);
    expect(mappingRows().map((row) => row.alga_entity_id)).toEqual(['pending-2']);
  });
});
