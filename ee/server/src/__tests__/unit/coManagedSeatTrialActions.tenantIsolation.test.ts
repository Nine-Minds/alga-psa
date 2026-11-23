import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoManagedSeatInvitationError } from '@alga-psa/co-managed';

const mocks = vi.hoisted(() => ({
  intake: vi.fn(), permission: vi.fn(), prepare: vi.fn(), replace: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
  createTenantKnex: vi.fn(), logError: vi.fn(), tenantDb: vi.fn(), permits: vi.fn(), capability: vi.fn(),
  user: { user_id: 'admin-good', user_type: 'internal', tenant: 'sponsor-good' },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => mocks.createTenantKnex(...args),
  tenantDb: (...args: any[]) => mocks.tenantDb(...args),
}));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({ permits: (...args: any[]) => mocks.permits(...args) }),
}));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: mocks.capability }));
vi.mock('@alga-psa/licensing', async (importOriginal: () => Promise<typeof import('@alga-psa/licensing')>) => ({ ...await importOriginal(), isCoManagedPurchaseSurfaceOpen: mocks.intake }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../../../server/src/lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));
vi.mock('../../lib/stripe/StripeService', () => ({ getStripeService: () => ({ refreshSeatTrialBase: vi.fn() }) }));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: vi.fn() }));
vi.mock('../../../../../server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn(async () => undefined) }));
vi.mock('../../lib/co-managed/seatTrial', () => ({
  readCoManagedSeatTrialAdmission: vi.fn(),
  prepareCoManagedSeatTrial: (...args: any[]) => mocks.prepare(...args),
  replaceCoManagedSeatTrialTechnician: (...args: any[]) => mocks.replace(...args),
  resumeCoManagedSeatTrialInvitation: (...args: any[]) => mocks.resume(...args),
  cancelCoManagedSeatTrial: (...args: any[]) => mocks.cancel(...args),
}));

const query = { where: vi.fn().mockReturnThis(), first: vi.fn(async () => ({ client_id: 'client-good', allocation_id: 'allocation-good' })) };
const knex = { tenant: 'fixture' };
const invitation = { email: 'tech@example.test', firstName: 'Client', lastName: 'Tech', token: 'token' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.intake.mockResolvedValue(true);
  mocks.capability.mockResolvedValue(undefined);
  mocks.permission.mockResolvedValue(true);
  mocks.user.tenant = 'sponsor-good';
  mocks.createTenantKnex.mockResolvedValue({ knex });
  mocks.tenantDb.mockImplementation(() => ({ table: () => query }));
  mocks.permits.mockResolvedValue(true);
  mocks.prepare.mockResolvedValue({ trialId: 'trial-good', arrangementId: 'arrangement-good', assignmentId: 'assignment-good', invitation });
  mocks.replace.mockResolvedValue({ invitation });
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.NEXTAUTH_URL;
  delete process.env.HOST;
});

describe('co-managed Seat trial action tenant binding', () => {
  it('prepares only in the authenticated sponsor when the request adds a forged tenant field', async () => {
    const { prepareCoManagedSeatTrialAction } = await import('../../lib/actions/coManagedSeatTrialActions');
    const input = { tenant: 'sponsor-evil', clientId: 'client-good', contactId: 'contact-good', operationId: 'operation-good', boards: [] } as any;
    await prepareCoManagedSeatTrialAction(input);

    expect(mocks.capability).toHaveBeenCalledWith('co-managed-seat', 'sponsor-good', 'admits');
    expect(mocks.tenantDb.mock.calls.every(([_, tenant]) => tenant === 'sponsor-good')).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith(knex, {
      tenant: 'sponsor-good', clientId: 'client-good', contactId: 'contact-good', operationId: 'operation-good', boards: [], invitedBy: 'admin-good',
    });
  });

  it('replaces only in the authenticated sponsor when the request adds a forged tenant field', async () => {
    const { replaceCoManagedSeatTrialTechnicianAction } = await import('../../lib/actions/coManagedSeatTrialActions');
    const input = { tenant: 'sponsor-evil', trialId: 'trial-good', contactId: 'contact-new' } as any;
    await replaceCoManagedSeatTrialTechnicianAction(input);

    expect(mocks.capability).toHaveBeenCalledWith('co-managed-seat', 'sponsor-good', 'admits');
    expect(mocks.tenantDb.mock.calls.every(([_, tenant]) => tenant === 'sponsor-good')).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith(knex, {
      tenant: 'sponsor-good', allocationId: 'allocation-good', trialId: 'trial-good', contactId: 'contact-new', invitedBy: 'admin-good',
    });
  });

  it('rejects denied intake before looking up or resending an invitation', async () => {
    const { resumeCoManagedSeatTrialAction } = await import('../../lib/actions/coManagedSeatTrialActions');
    mocks.capability.mockRejectedValue(new Error('Capability closed'));

    await expect(resumeCoManagedSeatTrialAction('trial-good')).rejects.toThrow('Capability closed');
    expect(mocks.capability).toHaveBeenCalledWith('co-managed-seat', 'sponsor-good', 'admits');
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it('denies account-only purchasers, out-of-scope clients and closed intake before preparing', async () => {
    const { prepareCoManagedSeatTrialAction } = await import('../../lib/actions/coManagedSeatTrialActions');
    const request = { clientId: 'client-A', operationId: 'operation', contactId: 'contact', boards: [] };
    mocks.permission.mockImplementation(async (_, resource) => resource === 'account_management');
    await expect(prepareCoManagedSeatTrialAction(request)).rejects.toThrow('Permission denied');
    mocks.permission.mockResolvedValue(true);
    mocks.permits.mockResolvedValue(false);
    await expect(prepareCoManagedSeatTrialAction(request)).rejects.toThrow('Permission denied');
    mocks.intake.mockResolvedValue(false);
    await expect(prepareCoManagedSeatTrialAction(request)).rejects.toThrow('intake is closed');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  // A thrown error reaches the browser redacted, so a refusal the screen can name returns as data.
  describe('named refusals', () => {
    // The real class lives in the mocked module, so build the same shape: refused() recognises it by name.
    const trialError = (code: string) => Object.assign(new Error(code), { name: 'CoManagedSeatTrialError', code });
    const request = { clientId: 'client-good', operationId: 'operation', contactId: 'contact', boards: [] };

    it.each(['SPONSOR_NOT_ELIGIBLE', 'TRIAL_CLAIM_UNAVAILABLE', 'OPERATION_CONFLICT'])('returns %s as a rejection and logs the cause', async code => {
      const { prepareCoManagedSeatTrialAction } = await import('../../lib/actions/coManagedSeatTrialActions');
      const cause = trialError(code);
      mocks.prepare.mockRejectedValue(cause);
      await expect(prepareCoManagedSeatTrialAction(request)).resolves.toEqual({ rejected: true, errorCode: code });
      expect(mocks.logError).toHaveBeenCalledWith('co-managed seat trial: prepare failed', cause);
    });

    it('returns a mapped invitation refusal from the replace action', async () => {
      const { replaceCoManagedSeatTrialTechnicianAction } = await import('../../lib/actions/coManagedSeatTrialActions');
      mocks.replace.mockRejectedValue(new CoManagedSeatInvitationError('EMAIL_IN_USE'));
      await expect(replaceCoManagedSeatTrialTechnicianAction({ trialId: 'trial-good', contactId: 'contact-new' }))
        .resolves.toEqual({ rejected: true, errorCode: 'EMAIL_IN_USE' });
      expect(mocks.logError).toHaveBeenCalledWith('co-managed seat trial: replace failed', expect.any(CoManagedSeatInvitationError));
    });

    it('names the refusal for resume and cancel too', async () => {
      const { resumeCoManagedSeatTrialAction, cancelCoManagedSeatTrialAction } = await import('../../lib/actions/coManagedSeatTrialActions');
      mocks.resume.mockRejectedValue(trialError('TRIAL_CLAIM_UNAVAILABLE'));
      mocks.cancel.mockRejectedValue(trialError('TRIAL_CLAIM_UNAVAILABLE'));
      await expect(resumeCoManagedSeatTrialAction('trial-good')).resolves.toEqual({ rejected: true, errorCode: 'TRIAL_CLAIM_UNAVAILABLE' });
      await expect(cancelCoManagedSeatTrialAction('trial-good')).resolves.toEqual({ rejected: true, errorCode: 'TRIAL_CLAIM_UNAVAILABLE' });
    });

    it('logs and still throws an error nobody named', async () => {
      const { prepareCoManagedSeatTrialAction } = await import('../../lib/actions/coManagedSeatTrialActions');
      const cause = Object.assign(new Error('complex joins are only supported when all distributed tables are co-located'), { code: '0A000' });
      mocks.prepare.mockRejectedValue(cause);
      await expect(prepareCoManagedSeatTrialAction(request)).rejects.toBe(cause);
      expect(mocks.logError).toHaveBeenCalledWith('co-managed seat trial: prepare failed', cause);
    });
  });
});
