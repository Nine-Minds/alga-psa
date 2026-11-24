import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  declareStage: vi.fn(),
  amendDeclaration: vi.fn(),
  user: { user_id: 'user-1' } as any,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({ trx: true })),
  registerAfterCommit: vi.fn(),
  tenantDb: vi.fn(),
}));
vi.mock('@alga-psa/shared/services/numberingService', () => ({ SharedNumberingService: {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildProjectCreatedPayload: vi.fn() }));
vi.mock('../src/lib/stageEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/stageEngine')>()),
  declareStage: mocks.declareStage,
  amendDeclaration: mocks.amendDeclaration,
}));
vi.mock('../src/lib/closeGates', () => ({ ensureEnterpriseOpportunityCloseGatesRegistered: vi.fn(), runOpportunityCloseGates: vi.fn() }));
vi.mock('../src/lib/opportunityWin', () => ({ prepareOpportunityWinConversions: vi.fn() }));
vi.mock('../src/lib/opportunityHandoff', () => ({ getOpportunityHandoffData: vi.fn() }));
vi.mock('../src/lib/clientLifecyclePromotion', () => ({ promoteProspectClientAfterWin: vi.fn() }));
vi.mock('../src/lib/quoteLifecycleHooks', () => ({ onQuoteAccepted: vi.fn(), onQuoteSent: vi.fn(), recomputeAcceptedQuoteValues: vi.fn() }));
vi.mock('../src/lib/opportunitySteps', () => ({ completeOpportunityNextAction: vi.fn(), removeOpportunityStepScheduleEntries: vi.fn() }));
vi.mock('../src/models/opportunityModel', () => ({ OpportunityModel: {} }));

import { amendOpportunityDeclaration, declareOpportunityStage } from '../src/actions/opportunityActions';
import { OPPORTUNITY_REF_REFUSAL, OpportunityDeclarationError, OpportunityEvidenceRefError } from '../src/lib/stageEngine';

const id = '3f2b8d52-1c4e-4a8e-9a43-0f5b6d7c8e90';

describe('declaration actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.declareStage.mockResolvedValue({ opportunity_id: 'opp-1', stage: 'proposed' });
    mocks.amendDeclaration.mockResolvedValue({ opportunity_id: 'opp-1', stage: 'verbal' });
  });

  it('declareOpportunityStage requires opportunities update, and writes nothing without it', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(declareOpportunityStage('opp-1', 'proposed', { note: 'x' })).rejects.toThrow('Permission denied: opportunities update required');
    expect(mocks.hasPermission).toHaveBeenCalledWith(mocks.user, 'opportunities', 'update');
    expect(mocks.declareStage).not.toHaveBeenCalled();
  });

  it('declareOpportunityStage passes the note and sources to the engine, and nothing when no content is given', async () => {
    await declareOpportunityStage('opp-1', 'proposed', { note: 'Proposal out', citations: [{ type: 'document', id }] });
    expect(mocks.declareStage).toHaveBeenLastCalledWith({ trx: true }, 'tenant-1', 'opp-1', 'proposed', 'user-1', { note: 'Proposal out', citations: [{ type: 'document', id }] });

    await declareOpportunityStage('opp-1', 'proposed');
    expect(mocks.declareStage).toHaveBeenLastCalledWith({ trx: true }, 'tenant-1', 'opp-1', 'proposed', 'user-1', undefined);
  });

  it('declareOpportunityStage maps the engine\'s source refusal to the user-facing message', async () => {
    mocks.declareStage.mockRejectedValue(new OpportunityEvidenceRefError('internal wording'));
    await expect(declareOpportunityStage('opp-1', 'proposed', { citations: [{ type: 'interaction', id }] })).rejects.toThrow(OPPORTUNITY_REF_REFUSAL);
  });

  it('amendOpportunityDeclaration requires opportunities update', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(amendOpportunityDeclaration('opp-1', 'verbal', { note: 'x' })).rejects.toThrow('Permission denied: opportunities update required');
    expect(mocks.amendDeclaration).not.toHaveBeenCalled();
  });

  it('amendOpportunityDeclaration amends through the engine as the caller and returns the opportunity', async () => {
    const result = await amendOpportunityDeclaration('opp-1', 'verbal', { note: null, citations: [] });
    expect(mocks.amendDeclaration).toHaveBeenCalledWith({ trx: true }, 'tenant-1', 'opp-1', 'verbal', 'user-1', { note: null, citations: [] });
    expect(result).toEqual({ opportunity_id: 'opp-1', stage: 'verbal' });
  });

  it('amendOpportunityDeclaration maps the source refusal and surfaces the typed checkpoint refusals', async () => {
    mocks.amendDeclaration.mockRejectedValueOnce(new OpportunityEvidenceRefError());
    await expect(amendOpportunityDeclaration('opp-1', 'verbal', { citations: [{ type: 'document', id }] })).rejects.toThrow('That source is not attached to this opportunity');
    mocks.amendDeclaration.mockRejectedValueOnce(new OpportunityDeclarationError('checkpoint_not_reached', 'The verbal stage has not been reached'));
    await expect(amendOpportunityDeclaration('opp-1', 'verbal', {})).rejects.toThrow('The verbal stage has not been reached');
  });

  it('rejects a malformed citation before reaching the engine', async () => {
    await expect(amendOpportunityDeclaration('opp-1', 'verbal', { citations: [{ type: 'document', id: 'not-a-uuid' }] })).rejects.toThrow();
    expect(mocks.amendDeclaration).not.toHaveBeenCalled();
  });
});
