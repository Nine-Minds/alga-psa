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
  declareStageFromStep: vi.fn(),
  amendDeclaration: vi.fn(),
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
  declareStageFromStep: mocks.declareStageFromStep,
  amendDeclaration: mocks.amendDeclaration,
  // The real wire-to-engine mapping: refType/refId is shorthand for one citation.
  declarationContentFromInput: (input: any) => ({
    note: input.detail,
    citations: input.citations ?? (input.refType != null && input.refId != null ? [{ type: input.refType, id: input.refId }] : undefined),
  }),
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

    // Same flow on a closed row, where the next-action pair reads back as null.
    it('ignores the null next-action pair a closed opportunity echoes back', async () => {
      mocks.getById.mockResolvedValue({
        ...current,
        status: 'won',
        stage: 'won',
        next_action: null,
        next_action_due: null,
      });
      const service = new OpportunityService();

      await service.update('opportunity-1', {
        title: 'Renamed deal',
        stage: 'won',
        status: 'won',
        next_action: null,
        next_action_due: null,
        client_id: 'client-1',
      } as any, context);

      expect(mocks.update).toHaveBeenCalledWith({}, 'tenant-1', 'opportunity-1', { title: 'Renamed deal' });
    });

    // The lenient instant compare is for timestamps only: free text that happens
    // to be date-parseable is still a change, not an echo.
    it('compares next_action as text rather than as an instant', async () => {
      mocks.getById.mockResolvedValue({ ...current, next_action: '2026' });
      const service = new OpportunityService();

      await expect(service.update('opportunity-1', { next_action: '2026-01-01' } as any, context))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('next_action') });
      expect(mocks.update).not.toHaveBeenCalled();
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
        { note: 'Proposal sent', citations: undefined },
      );
      expect(result).toEqual({ opportunity_id: 'opportunity-1', stage: 'proposed' });
    });

    it('passes citations through, and leaves note and sources undefined (keep) when none are sent', async () => {
      mocks.declareStage.mockResolvedValue({ opportunity_id: 'opportunity-1', stage: 'proposed' });
      const service = new OpportunityService();
      const citations = [{ type: 'document', id: 'doc-1' }];

      await service.setStage('opportunity-1', { stage: 'proposed', citations } as any, context);
      expect(mocks.declareStage).toHaveBeenLastCalledWith({}, 'tenant-1', 'opportunity-1', 'proposed', 'user-1', { note: undefined, citations });

      await service.setStage('opportunity-1', { stage: 'proposed' } as any, context);
      expect(mocks.declareStage).toHaveBeenLastCalledWith({}, 'tenant-1', 'opportunity-1', 'proposed', 'user-1', { note: undefined, citations: undefined });
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

  describe('amendDeclaration', () => {
    it('amends through the engine with the caller as editor', async () => {
      mocks.amendDeclaration.mockResolvedValue({ opportunity_id: 'opportunity-1', stage: 'verbal' });
      const service = new OpportunityService();

      const result = await service.amendDeclaration('opportunity-1', 'verbal', { detail: 'Edited', citations: [{ type: 'interaction', id: 'int-1' }] } as any, context);

      expect(mocks.amendDeclaration).toHaveBeenCalledWith({}, 'tenant-1', 'opportunity-1', 'verbal', 'user-1', { note: 'Edited', citations: [{ type: 'interaction', id: 'int-1' }] });
      expect(result).toEqual({ opportunity_id: 'opportunity-1', stage: 'verbal' });
    });

    it.each([
      ['checkpoint_not_reached', 409],
      ['checkpoint_not_amendable', 400],
      ['too_many_citations', 400],
    ])('maps the engine refusal %s to HTTP %i', async (code, status) => {
      mocks.amendDeclaration.mockRejectedValue(Object.assign(new Error('refused'), { name: 'OpportunityDeclarationError', code }));
      const service = new OpportunityService();
      await expect(service.amendDeclaration('opportunity-1', 'verbal', {} as any, context)).rejects.toMatchObject({ statusCode: status });
    });

    it('maps a refused source to a 400 naming the refusal', async () => {
      mocks.amendDeclaration.mockRejectedValue(Object.assign(new Error('That source is not attached to this opportunity'), { name: 'OpportunityEvidenceRefError' }));
      const service = new OpportunityService();
      await expect(service.amendDeclaration('opportunity-1', 'verbal', {} as any, context)).rejects.toMatchObject({ statusCode: 400 });
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
