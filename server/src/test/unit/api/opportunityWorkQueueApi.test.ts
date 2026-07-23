import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assembleWorkQueue: vi.fn(),
  listOpportunityTimelineCore: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: mocks.tenantDb,
  };
});

vi.mock('@alga-psa/opportunities', () => ({
  OpportunityModel: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  assembleWorkQueue: mocks.assembleWorkQueue,
  buildOpportunityCreatedPayload: vi.fn(),
  buildOpportunityStatusChangedPayload: vi.fn(),
  completeOpportunityNextAction: vi.fn(),
  correctEvidence: vi.fn(),
  getOpportunityDetail: vi.fn(),
  onQuoteAccepted: vi.fn(),
  onQuoteSent: vi.fn(),
  publishOpportunityEventAfterCommit: vi.fn(),
  recomputeAcceptedQuoteValues: vi.fn(),
  recordEvidence: vi.fn(),
  acceptSuggestionInternal: vi.fn(),
  dismissSuggestionInternal: vi.fn(),
  listSuggestionsInternal: vi.fn(),
  snoozeSuggestionInternal: vi.fn(),
  ensureEnterpriseOpportunityCloseGatesRegistered: vi.fn(),
  runOpportunityCloseGates: vi.fn(),
  prepareOpportunityWinConversions: vi.fn(),
  listOpportunityTimelineCore: mocks.listOpportunityTimelineCore,
}));

import { OpportunityService } from '../../../lib/api/services/OpportunityService';

const db = {} as any;
const context = {
  tenant: 'tenant-1',
  userId: 'api-user-1',
  user: {
    user_id: 'api-user-1',
    first_name: 'Ada',
  },
  db,
};

function opportunityLookup(result: { opportunity_id: string } | undefined) {
  const query: any = {
    where: vi.fn(),
    select: vi.fn(),
    first: vi.fn().mockResolvedValue(result),
  };
  query.where.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe('OpportunityService mobile REST additions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T040 delegates the work queue to the shared core for the API-key user', async () => {
    const queue = {
      user_first_name: 'Ada',
      date: '2026-07-16T14:00:00.000Z',
      found_mrr_cents: 0,
      found_nrr_cents: 0,
      currency_code: 'USD',
      do_today: [{ opportunity_id: 'opportunity-1', why: { segments: [{ text: 'Call today.' }] } }],
      going_quiet: [],
      money_found: [],
      lesson: null,
    };
    mocks.assembleWorkQueue.mockResolvedValue(queue);
    const service = new OpportunityService();

    const result = await service.getWorkQueue(context);

    expect(mocks.assembleWorkQueue).toHaveBeenCalledWith(
      db,
      'tenant-1',
      'api-user-1',
      'Ada',
    );
    expect(result).toBe(queue);
  });

  it('returns 404 without querying timeline data when the tenant-scoped opportunity is missing', async () => {
    const query = opportunityLookup(undefined);
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });
    const service = new OpportunityService();

    await expect(service.listTimeline('missing-opportunity', context)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Opportunity not found',
    });
    expect(mocks.tenantDb).toHaveBeenCalledWith(db, 'tenant-1');
    expect(mocks.listOpportunityTimelineCore).not.toHaveBeenCalled();
  });

  it('delegates an existing tenant opportunity to the shared timeline core', async () => {
    const query = opportunityLookup({ opportunity_id: 'opportunity-1' });
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });
    const timeline = [{ interaction_id: 'interaction-1' }];
    mocks.listOpportunityTimelineCore.mockResolvedValue(timeline);
    const service = new OpportunityService();

    const result = await service.listTimeline('opportunity-1', context);

    expect(mocks.listOpportunityTimelineCore).toHaveBeenCalledWith(
      db,
      'tenant-1',
      'opportunity-1',
    );
    expect(result).toBe(timeline);
  });
});
