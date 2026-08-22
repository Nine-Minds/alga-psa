import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ContactPhoneRow {
  tenant: string;
  contact_name_id: string;
  full_name: string;
  client_id: string | null;
  normalized_phone_number: string;
  phone_number: string;
}

interface LocationRow {
  tenant: string;
  client_id: string;
  phone: string | null;
}

const fixtures = vi.hoisted(() => ({
  contactPhones: [] as ContactPhoneRow[],
  locations: [] as LocationRow[],
}));

/**
 * Minimal stand-in for the tenantDb facade: enough of the builder surface for
 * the two queries the ladder issues, with tenant scoping enforced so the
 * cross-tenant test is meaningful.
 */
vi.mock('@alga-psa/db', () => {
  const build = (rows: any[], tenant: string) => {
    let working = rows.filter((row) => row.tenant === tenant);
    let take: number | null = null;
    let skip = 0;
    const page = () => working.slice(skip, take === null ? undefined : skip + take);
    const builder: any = {
      whereIn(column: string, values: any[]) {
        // The client-location branch compares a raw SQL digits expression.
        const isDigitsExpression = String(column).includes('regexp_replace');
        const key = isDigitsExpression ? null : String(column).split('.').pop()!;
        working = working.filter((row) => {
          const value = key === null
            ? String(row.phone ?? '').replace(/\D+/g, '')
            : row[key];
          return values.includes(value);
        });
        return builder;
      },
      whereNotNull(column: string) {
        const key = column.split('.').pop()!;
        working = working.filter((row) => row[key] !== null && row[key] !== undefined);
        return builder;
      },
      where(conditions: Record<string, unknown>) {
        working = working.filter((row) => Object.entries(conditions)
          .every(([key, value]) => row[key.split('.').pop()!] === value));
        return builder;
      },
      distinct() {
        return builder;
      },
      select() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit(count: number) {
        take = count;
        return builder;
      },
      offset(count: number) {
        skip = count;
        return builder;
      },
      first() {
        return Promise.resolve(page()[0]);
      },
      then(resolve: (rows: any[]) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(page()).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    tenantDb: (_knex: any, tenant: string) => ({
      table: (expression: string) => {
        const name = expression.split(' ')[0];
        if (name === 'contact_phone_numbers') return build(fixtures.contactPhones, tenant);
        if (name === 'client_locations') return build(fixtures.locations, tenant);
        return build([], tenant);
      },
      tenantJoin: (builder: any) => builder,
    }),
  };
});

import { auditContactPhoneNormalization, matchCallParty } from './callMatching';

const knex: any = { raw: (sql: string) => sql };

describe('matchCallParty', () => {
  beforeEach(() => {
    fixtures.contactPhones.length = 0;
    fixtures.locations.length = 0;
  });

  it('T017: an exact contact phone match returns the contact and its client', async () => {
    fixtures.contactPhones.push({
      tenant: 't1',
      contact_name_id: 'contact-1',
      full_name: 'Dorothy Gale',
      client_id: 'client-1',
      normalized_phone_number: '5551234567',
      phone_number: '(555) 123-4567',
    });

    await expect(matchCallParty({ knex, tenantId: 't1', phoneNumber: '+15551234567' })).resolves.toEqual({
      status: 'matched',
      contactId: 'contact-1',
      clientId: 'client-1',
      candidates: [
        { contactId: 'contact-1', clientId: 'client-1', contactName: 'Dorothy Gale', source: 'contact_phone' },
      ],
    });
  });

  it('T018: a client location phone match returns a client-only match', async () => {
    fixtures.locations.push({ tenant: 't1', client_id: 'client-9', phone: '+1 (555) 999-0000' });

    await expect(matchCallParty({ knex, tenantId: 't1', phoneNumber: '5559990000' })).resolves.toEqual({
      status: 'matched',
      contactId: null,
      clientId: 'client-9',
      candidates: [{ contactId: null, clientId: 'client-9', source: 'client_location_phone' }],
    });
  });

  it('T019: two contacts on one number are ambiguous with no auto-attribution', async () => {
    fixtures.contactPhones.push(
      {
        tenant: 't1',
        contact_name_id: 'contact-1',
        full_name: 'Dorothy Gale',
        client_id: 'client-1',
        normalized_phone_number: '5551234567',
        phone_number: '555-123-4567',
      },
      {
        tenant: 't1',
        contact_name_id: 'contact-2',
        full_name: 'Toto',
        client_id: 'client-2',
        normalized_phone_number: '5551234567',
        phone_number: '555-123-4567',
      },
    );

    const result = await matchCallParty({ knex, tenantId: 't1', phoneNumber: '+15551234567' });
    expect(result.status).toBe('ambiguous');
    expect(result.contactId).toBeNull();
    expect(result.clientId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('T020: an unknown number is unmatched', async () => {
    await expect(matchCallParty({ knex, tenantId: 't1', phoneNumber: '+15550001111' })).resolves.toMatchObject({
      status: 'unmatched',
      contactId: null,
      clientId: null,
    });
  });

  it('T020: an unnormalizable number never reaches the database', async () => {
    await expect(matchCallParty({ knex, tenantId: 't1', phoneNumber: 'anonymous' })).resolves.toMatchObject({
      status: 'unmatched',
    });
  });

  it('T021: the same number in another tenant never matches', async () => {
    fixtures.contactPhones.push({
      tenant: 't2',
      contact_name_id: 'contact-other',
      full_name: 'Wicked Witch',
      client_id: 'client-other',
      normalized_phone_number: '5551234567',
      phone_number: '555-123-4567',
    });

    await expect(matchCallParty({ knex, tenantId: 't1', phoneNumber: '+15551234567' })).resolves.toMatchObject({
      status: 'unmatched',
    });
  });
});

describe('auditContactPhoneNormalization', () => {
  beforeEach(() => {
    fixtures.contactPhones.length = 0;
  });

  it('T022: flags rows whose number cannot be normalized', async () => {
    fixtures.contactPhones.push(
      {
        tenant: 't1',
        contact_name_id: 'contact-1',
        full_name: 'Dorothy Gale',
        client_id: 'client-1',
        normalized_phone_number: '5551234567',
        phone_number: '555-123-4567',
      },
      {
        tenant: 't1',
        contact_name_id: 'contact-3',
        full_name: 'Scarecrow',
        client_id: 'client-1',
        normalized_phone_number: '',
        phone_number: 'call the farm',
      },
    );

    const rows = await auditContactPhoneNormalization({ knex, tenantId: 't1' });
    expect(rows.map((row) => row.contact_name_id)).toEqual(['contact-3']);
  });

  it('T022: limit bounds the flagged rows, not the slice that gets examined', async () => {
    // Good numbers first: a limit applied to the query instead of the result
    // would report nothing to fix.
    for (let index = 0; index < 5; index += 1) {
      fixtures.contactPhones.push({
        tenant: 't1',
        contact_name_id: `ok-${index}`,
        full_name: 'Munchkin',
        client_id: 'client-1',
        normalized_phone_number: `555000000${index}`,
        phone_number: `+1555000000${index}`,
      });
    }
    fixtures.contactPhones.push({
      tenant: 't1',
      contact_name_id: 'bad-1',
      full_name: 'Scarecrow',
      client_id: 'client-1',
      normalized_phone_number: '',
      phone_number: 'ask the wizard',
    });

    const rows = await auditContactPhoneNormalization({ knex, tenantId: 't1', limit: 2 });
    expect(rows.map((row) => row.contact_name_id)).toEqual(['bad-1']);
  });
});
