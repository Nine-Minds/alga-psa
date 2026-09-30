import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  assembleWorkQueue: vi.fn(),
  listOpportunityTimelineCore: vi.fn(),
  completeOpportunityNextAction: vi.fn(),
  correctEvidence: vi.fn(),
  declareStage: vi.fn(),
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
    getById: mocks.getById,
    create: vi.fn(),
    update: mocks.update,
    delete: vi.fn(),
  },
  declareStage: mocks.declareStage,
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

  describe('update', () => {
    const current = {
      opportunity_id: 'opportunity-1',
      client_id: 'client-1',
      status: 'open',
      stage: 'qualified',
      next_action: 'Review assessment',
      next_action_due: '2026-07-15T14:00:00.000Z',
      values_locked_by_quote: false,
    };

    beforeEach(() => {
      mocks.getById.mockResolvedValue(current);
      mocks.update.mockImplementation(async (_trx, _tenant, id, patch) => ({ opportunity_id: id, ...patch }));
    });

    // The full-body read-modify-write case: a caller GETs, edits one field and
    // PUTs the whole thing back. Echoing the flow-owned fields must not fail.
    it('ignores flow-owned fields that are echoed back unchanged', async () => {
      const service = new OpportunityService();

      await service.update('opportunity-1', {
        title: 'Renamed deal',
        stage: 'qualified',
        status: 'open',
        next_action: 'Review assessment',
        // Same instant, different ISO spelling: still unchanged.
        next_action_due: '2026-07-15T14:00:00Z',
        client_id: 'client-1',
      } as any, context);

      expect(mocks.update).toHaveBeenCalledWith({}, 'tenant-1', 'opportunity-1', { title: 'Renamed deal' });
    });

    it.each([
      ['stage', { stage: 'proposed' }, '/api/v1/opportunities/{id}/stage'],
      ['status', { status: 'won' }, '/api/v1/opportunities/{id}/win'],
      ['next_action', { next_action: 'Send the proposal' }, '/api/v1/opportunities/{id}/complete-action'],
      ['next_action_due', { next_action_due: '2026-09-01T14:00:00.000Z' }, '/api/v1/opportunities/{id}/complete-action'],
      ['client_id', { client_id: 'client-2' }, 'cannot be moved between clients'],
    ])('rejects a changed %s with a 400 naming the canonical endpoint', async (field, patch, pointer) => {
      const service = new OpportunityService();

      await expect(service.update('opportunity-1', patch as any, context)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(pointer),
      });
      await expect(service.update('opportunity-1', patch as any, context)).rejects.toMatchObject({
        message: expect.stringContaining(field),
      });
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('still guards quote-locked values', async () => {
      mocks.getById.mockResolvedValue({ ...current, values_locked_by_quote: true });
      const service = new OpportunityService();

      await expect(service.update('opportunity-1', { mrr_cents: 50000 } as any, context))
        .rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('setStage', () => {
    it('delegates open stages to the declared-evidence flow the board drag uses', async () => {
      mocks.declareStage.mockResolvedValue({ opportunity_id: 'opportunity-1', stage: 'proposed' });
      const service = new OpportunityService();

      const result = await service.setStage('opportunity-1', { stage: 'proposed', detail: 'Proposal sent' }, context);

      expect(mocks.declareStage).toHaveBeenCalledWith(
        {},
        'tenant-1',
        'opportunity-1',
        'proposed',
        'user-1',
        'Proposal sent',
      );
      expect(result).toEqual({ opportunity_id: 'opportunity-1', stage: 'proposed' });
    });

    it.each([
      ['won', 'win'],
      ['lost', 'lose'],
    ])('refuses to close via stage=%s and points at /%s', async (stage, endpoint) => {
      const service = new OpportunityService();

      await expect(service.setStage('opportunity-1', { stage } as any, context)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(`/api/v1/opportunities/{id}/${endpoint}`),
      });
      expect(mocks.declareStage).not.toHaveBeenCalled();
    });
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
