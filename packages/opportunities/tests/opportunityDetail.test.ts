import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
  tenantJoin: vi.fn((builder: unknown) => builder),
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
      opportunity_evidence_citations: makeQuery([]),
      quotes: makeQuery([]),
    };
    dbMocks.tenantDb.mockReturnValue({
      table: vi.fn((name: string) => tables[String(name).split(' ')[0]]),
      tenantJoin: dbMocks.tenantJoin,
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

  describe('declarations on the ladder', () => {
    const evidence = (overrides: Record<string, unknown>) => ({
      evidence_id: 'ev-1',
      opportunity_id: 'opp-1',
      checkpoint: 'qualified',
      source: 'user_declared',
      ref_type: null,
      ref_id: null,
      detail: 'Call went well',
      recorded_at: '2026-10-01T00:00:00.000Z',
      corrected_at: null,
      ...overrides,
    });
    const citation = (overrides: Record<string, unknown>) => ({
      citation_id: 'c-1',
      evidence_id: 'ev-1',
      ref_type: 'interaction',
      ref_id: 'int-1',
      interaction_title: null,
      document_name: null,
      resolved_interaction_id: null,
      resolved_document_id: null,
      ...overrides,
    });
    const rungFor = (detail: any, checkpoint = 'qualified') => detail.ladder.find((step: any) => step.checkpoint === checkpoint);

    it('exposes the note and the cited sources, resolved to labels, in the order the query returns them', async () => {
      tables.opportunity_evidence = makeQuery([evidence({})]);
      tables.opportunity_evidence_citations = makeQuery([
        citation({ citation_id: 'c-1', ref_type: 'document', ref_id: 'doc-1', document_name: 'Scope.pdf', resolved_document_id: 'doc-1' }),
        citation({ citation_id: 'c-2', ref_type: 'interaction', ref_id: 'int-1', interaction_title: 'Discovery call', resolved_interaction_id: 'int-1' }),
      ]);
      const detail = await getOpportunityDetail({} as any, 'tenant-1', 'opp-1');
      expect(rungFor(detail).declaration).toEqual({
        evidence_id: 'ev-1',
        note: 'Call went well',
        recorded_at: '2026-10-01T00:00:00.000Z',
        citations: [
          { citation_id: 'c-1', type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false },
          { citation_id: 'c-2', type: 'interaction', id: 'int-1', label: 'Discovery call', missing: false },
        ],
      });
      // Ordered by position, and every join is tenant-constrained through tenantDb.tenantJoin.
      expect(tables.opportunity_evidence_citations.orderBy).toHaveBeenCalledWith([{ column: 'cc.evidence_id' }, { column: 'cc.position', order: 'asc' }]);
      expect(dbMocks.tenantJoin).toHaveBeenCalledWith(expect.anything(), 'documents as cd', 'cd.document_id', 'cda.document_id', expect.objectContaining({ type: 'left' }));
      expect(dbMocks.tenantJoin).toHaveBeenCalledWith(expect.anything(), 'interactions as ci', 'ci.interaction_id', 'cc.ref_id', expect.objectContaining({ type: 'left' }));
    });

    it('flags a deleted interaction and a detached document as missing with a null label, and every rung still renders', async () => {
      tables.opportunity_evidence = makeQuery([evidence({}), evidence({ evidence_id: 'ev-2', checkpoint: 'proposed' })]);
      tables.opportunity_evidence_citations = makeQuery([
        citation({ citation_id: 'c-1', ref_type: 'interaction', ref_id: 'gone-int' }),
        citation({ citation_id: 'c-2', ref_type: 'document', ref_id: 'gone-doc' }),
      ]);
      const detail = await getOpportunityDetail({} as any, 'tenant-1', 'opp-1');
      expect(rungFor(detail).declaration.citations).toEqual([
        { citation_id: 'c-1', type: 'interaction', id: 'gone-int', label: null, missing: true },
        { citation_id: 'c-2', type: 'document', id: 'gone-doc', label: null, missing: true },
      ]);
      expect(rungFor(detail).state).toBe('reached');
      expect(rungFor(detail, 'proposed').state).toBe('reached');
      expect(rungFor(detail, 'assessment').state).toBe('skipped');
    });

    it('gives a declaration with no sources an empty list, and an unreached or system-only rung no declaration', async () => {
      tables.opportunity_evidence = makeQuery([
        evidence({ detail: null }),
        evidence({ evidence_id: 'ev-sys', checkpoint: 'proposed', source: 'system', ref_type: 'quote', ref_id: 'q-1', detail: 'Quote sent' }),
      ]);
      const detail = await getOpportunityDetail({} as any, 'tenant-1', 'opp-1');
      expect(rungFor(detail).declaration).toMatchObject({ note: null, citations: [] });
      expect(rungFor(detail, 'proposed').declaration).toBeNull();
      expect(rungFor(detail, 'proposed').evidence).toMatchObject({ source: 'system', ref_type: 'quote' });
      expect(rungFor(detail, 'verbal').declaration).toBeNull();
      expect(rungFor(detail).evidence).not.toHaveProperty('ref_label');
    });
  });
});
