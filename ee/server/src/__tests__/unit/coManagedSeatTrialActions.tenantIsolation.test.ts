import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), replace: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
  createTenantKnex: vi.fn(), tenantDb: vi.fn(), permits: vi.fn(),
  user: { user_id: 'admin-good', user_type: 'internal', tenant: 'sponsor-good' },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => mocks.createTenantKnex(...args),
  tenantDb: (...args: any[]) => mocks.tenantDb(...args),
}));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({ permits: (...args: any[]) => mocks.permits(...args) }),
}));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: vi.fn() }));
vi.mock('../../../../../server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn(async () => undefined) }));
vi.mock('../../lib/co-managed/seatTrial', () => ({
  prepareCoManagedSeatTrial: (...args: any[]) => mocks.prepare(...args),
  replaceCoManagedSeatTrialTechnician: (...args: any[]) => mocks.replace(...args),
  resumeCoManagedSeatTrialInvitation: (...args: any[]) => mocks.resume(...args),
  cancelCoManagedSeatTrial: (...args: any[]) => mocks.cancel(...args),
}));

const query = { where: vi.fn().mockReturnThis(), first: vi.fn(async () => ({ client_id: 'client-good' })) };
const knex = { tenant: 'fixture' };
const invitation = { email: 'tech@example.test', firstName: 'Client', lastName: 'Tech', token: 'token' };

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(mocks.tenantDb.mock.calls.every(([_, tenant]) => tenant === 'sponsor-good')).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith(knex, {
      tenant: 'sponsor-good', clientId: 'client-good', contactId: 'contact-good', operationId: 'operation-good', boards: [], invitedBy: 'admin-good',
    });
  });

  it('replaces only in the authenticated sponsor when the request adds a forged tenant field', async () => {
    const { replaceCoManagedSeatTrialTechnicianAction } = await import('../../lib/actions/coManagedSeatTrialActions');
    const input = { tenant: 'sponsor-evil', trialId: 'trial-good', contactId: 'contact-new' } as any;
    await replaceCoManagedSeatTrialTechnicianAction(input);

    expect(mocks.tenantDb.mock.calls.every(([_, tenant]) => tenant === 'sponsor-good')).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith(knex, {
      tenant: 'sponsor-good', trialId: 'trial-good', contactId: 'contact-new', invitedBy: 'admin-good',
    });
  });
});
