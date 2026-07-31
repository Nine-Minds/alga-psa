import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  assembleWorkQueue: vi.fn(),
  listOpportunityTimelineCore: vi.fn(),
  completeOpportunityNextAction: vi.fn(),
  correctEvidence: vi.fn(),
  getOpportunityDetail: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({})),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: mocks.tenantDb,
    withTransaction: mocks.withTransaction,
  };
});

vi.mock('@alga-psa/opportunities', () => ({
  OpportunityModel: {
    list: mocks.list,
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  assembleWorkQueue: mocks.assembleWorkQueue,
  buildOpportunityCreatedPayload: vi.fn(),
  buildOpportunityStatusChangedPayload: vi.fn(),
  completeOpportunityNextAction: mocks.completeOpportunityNextAction,
  correctEvidence: mocks.correctEvidence,
  getOpportunityDetail: mocks.getOpportunityDetail,
  onQuoteAccepted: vi.fn(),
  onQuoteSent: vi.fn(),
  publishOpportunityEventAfterCommit: vi.fn(),
  recomputeAcceptedQuoteValues: vi.fn(),
  recordEvidence: vi.fn(),
  listOpportunityTimelineCore: mocks.listOpportunityTimelineCore,
}));

import { OpportunityService } from '../../../lib/api/services/OpportunityService';

const context = {
  tenant: 'tenant-1',
  userId: 'user-1',
  user: {},
  db: {} as any,
};

describe('OpportunityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates list filters while the model resolves the tenant stalled threshold', async () => {
    mocks.list.mockResolvedValue({ data: [{ opportunity_id: 'opportunity-1' }], total: 1, page: 2, page_size: 50 });
    const service = new OpportunityService();

    const result = await service.list({
      status: 'open',
      stalled_only: true,
      page: 2,
      page_size: 50,
      sort_by: 'created_at',
      sort_direction: 'desc',
    }, context);

    expect(mocks.list).toHaveBeenCalledWith(context.db, 'tenant-1', {
      status: 'open',
      stage: undefined,
      owner_id: undefined,
      client_id: undefined,
      opportunity_type: undefined,
      stalled_only: true,
      search: undefined,
      page: 2,
      page_size: 50,
      sort_by: 'created_at',
      sort_direction: 'desc',
    });
    expect(result).toEqual({ data: [{ opportunity_id: 'opportunity-1' }], total: 1 });
  });

  it('uses the shared completion operation so REST completion also writes timeline history', async () => {
    mocks.completeOpportunityNextAction.mockResolvedValue({ opportunity_id: 'opportunity-1', next_action: 'Send proposal' });
    const service = new OpportunityService();

    const result = await service.completeAction('opportunity-1', {
      next_action: 'Send proposal',
      next_action_due: '2026-07-15T12:00:00.000Z',
    }, context);

    expect(mocks.completeOpportunityNextAction).toHaveBeenCalledWith(
      {},
      'tenant-1',
      'opportunity-1',
      {
        next_action: 'Send proposal',
        next_action_due: '2026-07-15T12:00:00.000Z',
      },
      'user-1',
    );
    expect(result).toEqual({ opportunity_id: 'opportunity-1', next_action: 'Send proposal' });
  });

  it('refuses to correct evidence that is not active on the opportunity in the URL', async () => {
    const query: any = {
      where: vi.fn(),
      whereNull: vi.fn(),
      select: vi.fn(),
      first: vi.fn().mockResolvedValue(undefined),
    };
    query.where.mockReturnValue(query);
    query.whereNull.mockReturnValue(query);
    query.select.mockReturnValue(query);
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });

    const service = new OpportunityService();
    await expect(service.correctEvidence(
      'opportunity-1',
      'evidence-from-another-opportunity',
      { correction_note: 'Wrong deal' },
      context,
    )).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.correctEvidence).not.toHaveBeenCalled();
  });
});
