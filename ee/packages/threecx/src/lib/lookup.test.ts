import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A small in-memory query engine faithful to the exact chains lookup.ts uses:
 * equality, ilike substring, whereRaw lower(email)=?, andWhere OR groups with an
 * orWhereExists digit sub-match, orderBy, limit, and tenant scoping. Rows are
 * pre-flattened (c.full_name -> full_name, cl.client_name -> client_name).
 */
const hoisted = vi.hoisted(() => {
  const store = {
    contacts: [] as any[],
    clients: [] as any[],
    contact_phone_numbers: [] as any[],
  };

  const strip = (col: string) => col.split('.').pop() as string;

  function predicate(a: any, op?: any, val?: any): (row: any) => boolean {
    if (op === 'ilike') {
      const needle = String(val).replace(/^%|%$/g, '').replace(/\\/g, '').toLowerCase();
      return (row) => String(row[strip(a)] ?? '').toLowerCase().includes(needle);
    }
    return (row) => row[strip(a)] === op;
  }

  function makeOrGroup() {
    const ors: Array<(row: any) => boolean> = [];
    const g: any = {
      where(a: any, op?: any, val?: any) {
        ors.push(predicate(a, op, val));
        return g;
      },
      orWhere(a: any, op?: any, val?: any) {
        ors.push(predicate(a, op, val));
        return g;
      },
      orWhereExists(fn: (sub: any) => void) {
        const capture: any = {
          digits: '',
          select: () => capture,
          from: () => capture,
          whereRaw: () => capture,
          andWhereRaw: () => capture,
          andWhere: (_col: string, _op: string, pat: string) => {
            capture.digits = String(pat).replace(/%/g, '');
            return capture;
          },
        };
        fn(capture);
        const digits = capture.digits;
        ors.push((row) =>
          store.contact_phone_numbers.some(
            (cpn) =>
              cpn.contact_name_id === row.contact_name_id &&
              String(cpn.normalized_phone_number ?? '').includes(digits),
          ),
        );
        return g;
      },
      match(row: any) {
        return ors.some((p) => p(row));
      },
    };
    return g;
  }

  function makeBuilder(table: string, tenant: string) {
    const base = table.split(' ')[0];
    const preds: Array<(row: any) => boolean> = [(row) => row.tenant === tenant];
    let orderCol: string | null = null;
    let limitN: number | null = null;

    const rowsFor = () => (store as any)[base] as any[];

    const exec = () => {
      let rows = rowsFor().filter((row) => preds.every((p) => p(row)));
      if (orderCol) {
        rows = [...rows].sort((x, y) => String(x[orderCol!] ?? '').localeCompare(String(y[orderCol!] ?? '')));
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      return rows.map((row) => ({ ...row }));
    };

    const b: any = {
      where(a: any, op?: any, val?: any) {
        if (a && typeof a === 'object') {
          for (const [k, v] of Object.entries(a)) preds.push((row) => row[strip(k)] === v);
        } else if (typeof a === 'function') {
          const group = makeOrGroup();
          a(group);
          preds.push((row) => group.match(row));
        } else {
          preds.push(predicate(a, op, val));
        }
        return b;
      },
      andWhere(a: any, op?: any, val?: any) {
        return b.where(a, op, val);
      },
      whereRaw(sql: string, bindings: any[]) {
        if (/lower\([^)]*email[^)]*\)\s*=\s*\?/i.test(sql)) {
          const v = String(bindings[0]).toLowerCase();
          preds.push((row) => String(row.email ?? '').toLowerCase() === v);
        }
        return b;
      },
      orderBy(col: string) {
        orderCol = strip(col);
        return b;
      },
      limit(n: number) {
        limitN = n;
        return b;
      },
      select() {
        return Promise.resolve(exec());
      },
      async first() {
        const [row] = exec();
        return row ? { ...row } : undefined;
      },
      then(resolve: (rows: any[]) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    return b;
  }

  const knexMock: any = () => ({});
  knexMock.raw = (s: string) => s;

  return { store, makeBuilder, knexMock };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (t: string) => hoisted.makeBuilder(t, tenant),
    tenantJoin: () => undefined,
  }),
}));

const matchCallPartyMock = vi.hoisted(() => vi.fn());
const resolveCountryMock = vi.hoisted(() => vi.fn(async () => null as string | null));

vi.mock('@alga-psa/telephony', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  matchCallParty: matchCallPartyMock,
  resolveTenantPhoneCountryCode: resolveCountryMock,
}));

import {
  threecxLookupByEmail,
  threecxLookupByNumber,
  threecxSearchContacts,
} from './lookup';

const TENANT = 'tenant-1';
const BASE = 'https://app.example.com';
const ctx = { tenantId: TENANT, baseUrl: BASE };

function seedContact(overrides: Record<string, unknown> = {}) {
  const row = {
    tenant: TENANT,
    contact_name_id: 'contact-1',
    full_name: 'Dorothy Gale',
    email: 'dorothy@oz.example',
    client_id: 'client-1',
    client_name: 'Emerald City',
    is_inactive: false,
    ...overrides,
  };
  hoisted.store.contacts.push(row);
  return row;
}

describe('threecx lookup', () => {
  beforeEach(() => {
    hoisted.store.contacts.length = 0;
    hoisted.store.clients.length = 0;
    hoisted.store.contact_phone_numbers.length = 0;
    matchCallPartyMock.mockReset();
    resolveCountryMock.mockReset();
    resolveCountryMock.mockResolvedValue(null);
  });

  it('T058: normalizes the number with the tenant country before matching', async () => {
    resolveCountryMock.mockResolvedValue('US');
    matchCallPartyMock.mockResolvedValue({ status: 'unmatched', contactId: null, clientId: null, candidates: [] });

    await threecxLookupByNumber(ctx, '(555) 010-4242');

    expect(matchCallPartyMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, phoneNumber: '(555) 010-4242', defaultCountryCode: 'US' }),
    );
  });

  it('T059: a matched number returns one Contact with a /msp/contacts/<id> url', async () => {
    seedContact();
    matchCallPartyMock.mockResolvedValue({ status: 'matched', contactId: 'contact-1', clientId: 'client-1', candidates: [] });

    const contacts = await threecxLookupByNumber(ctx, '+15550104242');

    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      contactUrl: `${BASE}/msp/contacts/contact-1`,
      firstName: 'Dorothy',
      lastName: 'Gale',
      companyName: 'Emerald City',
      email: 'dorothy@oz.example',
    });
  });

  it('T060: a client-only match returns companyName and a /msp/clients/<id> url', async () => {
    hoisted.store.clients.push({ tenant: TENANT, client_id: 'client-9', client_name: 'Kansas Farms', is_inactive: false });
    matchCallPartyMock.mockResolvedValue({ status: 'matched', contactId: null, clientId: 'client-9', candidates: [] });

    const contacts = await threecxLookupByNumber(ctx, '+15550104242');

    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      contactUrl: `${BASE}/msp/clients/client-9`,
      companyName: 'Kansas Farms',
    });
  });

  it('T061: an ambiguous match returns every candidate', async () => {
    seedContact({ contact_name_id: 'contact-1', full_name: 'Aunt Em' });
    seedContact({ contact_name_id: 'contact-2', full_name: 'Uncle Henry' });
    matchCallPartyMock.mockResolvedValue({
      status: 'ambiguous',
      contactId: null,
      clientId: null,
      candidates: [
        { contactId: 'contact-1', source: 'contact_phone' },
        { contactId: 'contact-2', source: 'contact_phone' },
      ],
    });

    const contacts = await threecxLookupByNumber(ctx, '+15550104242');
    expect(contacts.map((c) => c.contactUrl)).toEqual([
      `${BASE}/msp/contacts/contact-1`,
      `${BASE}/msp/contacts/contact-2`,
    ]);
  });

  it('T062: an unmatched number returns an empty array', async () => {
    matchCallPartyMock.mockResolvedValue({ status: 'unmatched', contactId: null, clientId: null, candidates: [] });
    await expect(threecxLookupByNumber(ctx, '+15550104242')).resolves.toEqual([]);
  });

  it('T063: the number query value is echoed verbatim on every Contact', async () => {
    seedContact();
    matchCallPartyMock.mockResolvedValue({ status: 'matched', contactId: 'contact-1', clientId: 'client-1', candidates: [] });

    const contacts = await threecxLookupByNumber(ctx, '(555) 010-4242');
    expect(contacts[0].phone).toBe('(555) 010-4242');
  });

  it('T064: lookup-by-email matches case-insensitively', async () => {
    seedContact({ email: 'dorothy@oz.example' });
    hoisted.store.contact_phone_numbers.push({
      tenant: TENANT,
      contact_name_id: 'contact-1',
      phone_number: '+1 (555) 010-4242',
      normalized_phone_number: '15550104242',
      display_order: 0,
    });

    const contacts = await threecxLookupByEmail(ctx, 'DOROTHY@OZ.EXAMPLE');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].contactUrl).toBe(`${BASE}/msp/contacts/contact-1`);
  });

  it('T065: an unknown email returns an empty array', async () => {
    seedContact({ email: 'dorothy@oz.example' });
    await expect(threecxLookupByEmail(ctx, 'toto@oz.example')).resolves.toEqual([]);
  });

  it('T066: search matches a partial last name, ordered by name', async () => {
    seedContact({ contact_name_id: 'c2', full_name: 'Zeke Gale' });
    seedContact({ contact_name_id: 'c1', full_name: 'Dorothy Gale' });

    const contacts = await threecxSearchContacts(ctx, 'Gale');
    expect(contacts.map((c) => c.firstName)).toEqual(['Dorothy', 'Zeke']);
  });

  it('T067: search matches a company-name fragment', async () => {
    seedContact({ contact_name_id: 'c1', full_name: 'Dorothy Gale', client_name: 'Emerald City' });
    const contacts = await threecxSearchContacts(ctx, 'emerald');
    expect(contacts).toHaveLength(1);
  });

  it('T068: search matches by normalized phone digits', async () => {
    seedContact({ contact_name_id: 'c1', full_name: 'Dorothy Gale' });
    hoisted.store.contact_phone_numbers.push({
      tenant: TENANT,
      contact_name_id: 'c1',
      phone_number: '+1 (555) 010-4242',
      normalized_phone_number: '15550104242',
      display_order: 0,
    });

    const contacts = await threecxSearchContacts(ctx, '5550104242');
    expect(contacts).toHaveLength(1);
  });

  it('T069: search returns at most 20 contacts', async () => {
    for (let i = 0; i < 25; i += 1) {
      seedContact({ contact_name_id: `c${i}`, full_name: `Muncher ${String(i).padStart(2, '0')}` });
    }
    const contacts = await threecxSearchContacts(ctx, 'Muncher');
    expect(contacts).toHaveLength(20);
  });

  it('T070: lookup and search omit inactive contacts', async () => {
    seedContact({ contact_name_id: 'active', full_name: 'Active Contact' });
    seedContact({ contact_name_id: 'inactive', full_name: 'Active Ghost', is_inactive: true });

    const searchResults = await threecxSearchContacts(ctx, 'Active');
    expect(searchResults.map((c) => c.contactUrl)).toEqual([`${BASE}/msp/contacts/active`]);

    matchCallPartyMock.mockResolvedValue({ status: 'matched', contactId: 'inactive', clientId: null, candidates: [] });
    const lookupResults = await threecxLookupByNumber(ctx, '+15550104242');
    expect(lookupResults).toEqual([]);
  });

  it('T071: search returns each contact primary number in E.164', async () => {
    resolveCountryMock.mockResolvedValue('US');
    seedContact({ contact_name_id: 'c1', full_name: 'Dorothy Gale' });
    hoisted.store.contact_phone_numbers.push({
      tenant: TENANT,
      contact_name_id: 'c1',
      phone_number: '(555) 010-4242',
      normalized_phone_number: '5550104242',
      display_order: 0,
    });

    const contacts = await threecxSearchContacts(ctx, 'Gale');
    expect(contacts[0].phone).toBe('+15550104242');
  });

  it('T072: lookup-by-email and search never cross the tenant boundary', async () => {
    seedContact({ tenant: 'tenant-2', contact_name_id: 'other', full_name: 'Dorothy Gale', email: 'dorothy@oz.example' });

    await expect(threecxLookupByEmail(ctx, 'dorothy@oz.example')).resolves.toEqual([]);
    await expect(threecxSearchContacts(ctx, 'Gale')).resolves.toEqual([]);
  });
});
