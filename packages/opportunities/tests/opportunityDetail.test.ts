import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: dbMocks.tenantDb,
}));

vi.mock('../src/models/opportunityModel', () => ({
  OpportunityModel: { getById: modelMocks.getById },
}));

import { getOpportunityDetail } from '../src/lib/opportunityDetail';

type QueryResult = Record<string, unknown> | Array<Record<string, unknown>> | null;

function makeQuery(result: QueryResult) {
  const query: any = {
    where: vi.fn(),
    whereNull: vi.fn(),
    orderBy: vi.fn(),
    select: vi.fn(),
    first: vi.fn(() => Promise.resolve(Array.isArray(result) ? result[0] ?? null : result)),
    then: (resolve: (value: QueryResult) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(Array.isArray(result) ? result : []).then(resolve, reject),
  };
  query.where.mockReturnValue(query);
  query.whereNull.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

const OPPORTUNITY = {
  opportunity_id: 'opp-1',
  opportunity_number: 'OPP-1',
  client_id: 'client-1',
  contact_id: 'contact-1',
  owner_id: 'user-1',
  stage: 'qualified',
};

describe('getOpportunityDetail', () => {
  let tables: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    tables = {
      clients: makeQuery({ client_name: 'Acme', lifecycle_status: 'active' }),
      contacts: makeQuery({ full_name: 'Jane Doe', email: 'jane@acme.com' }),
      contact_phone_numbers: makeQuery({ phone_number: '+15551234567' }),
      users: makeQuery({ first_name: 'Rep', last_name: 'One' }),
      opportunity_evidence: makeQuery([]),
      quotes: makeQuery([]),
    };
    dbMocks.tenantDb.mockReturnValue({
      table: vi.fn((name: string) => tables[String(name).split(' ')[0]]),
    });
    modelMocks.getById.mockResolvedValue({ ...OPPORTUNITY });
  });

  it('returns the linked contact with email and default-first phone', async () => {
    const detail = await getOpportunityDetail({} as any, 'tenant-1', 'opp-1');

    expect(detail).not.toBeNull();
    expect(detail?.contact_name).toBe('Jane Doe');
    expect(detail?.contact_email).toBe('jane@acme.com');
    expect(detail?.contact_phone).toBe('+15551234567');
    expect(tables.contact_phone_numbers.where).toHaveBeenCalledWith({ contact_name_id: 'contact-1' });
    expect(tables.contact_phone_numbers.orderBy).toHaveBeenCalledWith([
      { column: 'is_default', order: 'desc' },
      { column: 'display_order', order: 'asc' },
    ]);
  });

  it('returns null contact fields when the deal has no linked contact', async () => {
    modelMocks.getById.mockResolvedValue({ ...OPPORTUNITY, contact_id: null });

    const detail = await getOpportunityDetail({} as any, 'tenant-1', 'opp-1');

    expect(detail?.contact_name).toBeNull();
    expect(detail?.contact_phone).toBeNull();
    expect(detail?.contact_email).toBeNull();
    expect(tables.contact_phone_numbers.where).not.toHaveBeenCalled();
  });

  it('returns null phone when the contact has no phone numbers', async () => {
    tables.contact_phone_numbers = makeQuery(null);

    const detail = await getOpportunityDetail({} as any, 'tenant-1', 'opp-1');

    expect(detail?.contact_name).toBe('Jane Doe');
    expect(detail?.contact_phone).toBeNull();
  });
});
