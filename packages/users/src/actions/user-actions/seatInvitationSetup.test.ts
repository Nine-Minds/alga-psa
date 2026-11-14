/**
 * A seat technician's invitation completes through the team setup flow (the link in the invitation email
 * opens /auth/team/setup). The flow recognises the seat-kind token by the metadata the seat invite stamps
 * on it and hands completion to `acceptCoManagedSeatInvitation`; every ordinary token takes the path it
 * always took; and a seat token is refused when `co-managed-seat` does not serve the sponsor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ seatServed: true, coManagedServed: true }));
const accept = vi.hoisted(() => vi.fn());
const createFromInvitation = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn(async () => undefined));
const txRows = vi.hoisted(() => ({ productCode: 'psa', role: { role_id: 'role-1' } }));

class SeatError extends Error { constructor(public code: string) { super(code); } }

vi.mock('@alga-psa/core/capability', () => ({
  isCapabilityServed: async (key: string) => (key === 'co-managed-seat' ? gate.seatServed : gate.coManagedServed),
}));
vi.mock('@alga-psa/co-managed/seatInvitation', () => ({
  acceptCoManagedSeatInvitation: (...a: unknown[]) => accept(...a),
  CoManagedSeatInvitationError: SeatError,
}));
const tenantDbMock = vi.hoisted(() => (_c: unknown, _t: string) => ({
  table: (name: string) => ({
    first: async () => (name === 'tenants' ? { product_code: txRows.productCode } : undefined),
    where: () => ({ first: async () => (name === 'roles' ? txRows.role : undefined), update: async () => 1 }),
  }),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { transaction: async (fn: any) => fn({ trx: true, fn: { now: () => 0 } }) }, tenant: 't1' }),
  tenantDb: tenantDbMock,
  runWithTenant: async (_t: string, fn: any) => fn(),
  runAsSystem: async (_n: string, fn: any) => fn(),
  createSystemContext: () => ({}),
  UserPreferences: { upsert },
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => fn }));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: vi.fn(), getSystemEmailService: vi.fn(), TenantEmailService: {} }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: vi.fn() }));
vi.mock('@alga-psa/core', () => ({ isValidEmail: () => true }));
vi.mock('@alga-psa/validation', () => ({ validatePassword: (pw: string) => (pw.length < 8 ? 'Password too short' : null) }));
vi.mock('@alga-psa/licensing', () => ({ findPendingInvitation: vi.fn(), assertCoManagedSeatAdmission: vi.fn(), CoManagedAdmissionError: class extends Error {} }));
vi.mock('../../lib/internalUserLicenseGuard', () => ({
  checkInternalUserLicenseLimit: vi.fn(), countPendingInvitationSeats: vi.fn(), isInternalUserLicenseLimitRejected: vi.fn(), lockInternalUserSeats: vi.fn(),
}));
vi.mock('../../services/UserService', () => ({ UserService: class { createFromInvitation = (...a: unknown[]) => createFromInvitation(...a); } }));

const verify = vi.hoisted(() => vi.fn());
vi.mock('../../services/UserInvitationService', () => ({
  UserInvitationService: { verifyToken: (...a: unknown[]) => verify(...a), cleanupExpiredTokens: vi.fn(async () => 0) },
}));

const invitee = { email: 'dana@client.example', first_name: 'Dana', last_name: 'Reyes', role_id: null, role_name: null };
const seatVerification = { valid: true, tenant: 't1', invitee, invitation: { role_id: null, metadata: { co_managed_seat_assignment_id: 'as-1' } } };
const ordinaryVerification = { valid: true, tenant: 't1', invitee: { ...invitee, role_id: 'role-1', role_name: 'User' }, invitation: { role_id: 'role-1', metadata: {} } };

const load = () => import('./userInvitationActions');

beforeEach(() => {
  gate.seatServed = true; gate.coManagedServed = true; txRows.productCode = 'psa';
  for (const fn of [accept, createFromInvitation, upsert, verify]) fn.mockReset();
  upsert.mockResolvedValue(undefined);
  createFromInvitation.mockResolvedValue({ user: { user_id: 'ordinary-user' }, coManaged: false });
});

describe('completing a seat invitation through team setup', () => {
  it('hands a seat token to the seat command, which lands a seat assignment, not an ordinary user', async () => {
    verify.mockResolvedValue(seatVerification);
    accept.mockResolvedValue({ created: true, user_id: 'seat-user', email: invitee.email, assignment_id: 'as-1', arrangement_id: 'arr', sponsor_tenant: 't1', state: 'active' });
    const { completeUserInvitationSetup } = await load();
    const result = await completeUserInvitationSetup('a'.repeat(64), 'Sup3r-secret-pass!');
    expect(result).toEqual({ success: true, userId: 'seat-user', username: invitee.email, message: 'Account created successfully' });
    expect(accept).toHaveBeenCalledWith(expect.anything(), { token: 'a'.repeat(64), password: 'Sup3r-secret-pass!' });
    expect(createFromInvitation).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ user_id: 'seat-user', setting_name: 'has_reset_password' }));
  });

  it('holds the seat flow to the same password policy as the ordinary one', async () => {
    verify.mockResolvedValue(seatVerification);
    const { completeUserInvitationSetup } = await load();
    expect(await completeUserInvitationSetup('a'.repeat(64), 'short')).toMatchObject({ success: false, errorCode: 'PASSWORD_POLICY' });
    expect(accept).not.toHaveBeenCalled();
  });

  it('a spent, expired or revoked seat token answers as an ordinary invalid token does', async () => {
    verify.mockResolvedValue(seatVerification);
    const { completeUserInvitationSetup } = await load();
    for (const code of ['INVITATION_NOT_FOUND', 'INVITATION_EXPIRED', 'INVITATION_REVOKED']) {
      accept.mockRejectedValueOnce(new SeatError(code));
      expect(await completeUserInvitationSetup('a'.repeat(64), 'Sup3r-secret-pass!'))
        .toEqual({ success: false, error: 'Invalid or expired invitation token', errorCode: 'INVALID_OR_EXPIRED_TOKEN' });
    }
    // verifyToken itself answers an unknown, used or expired token before the seat branch is reached.
    verify.mockResolvedValue({ valid: false, errorCode: 'INVALID_OR_EXPIRED_TOKEN' });
    expect(await completeUserInvitationSetup('b'.repeat(64), 'Sup3r-secret-pass!')).toMatchObject({ errorCode: 'INVALID_OR_EXPIRED_TOKEN' });
  });

  it('names the refusals that are not about the token', async () => {
    verify.mockResolvedValue(seatVerification);
    const { completeUserInvitationSetup } = await load();
    accept.mockRejectedValueOnce(new SeatError('EMAIL_IN_USE'));
    expect(await completeUserInvitationSetup('a'.repeat(64), 'Sup3r-secret-pass!')).toMatchObject({ errorCode: 'CREATE_USER_FAILED' });
    accept.mockRejectedValueOnce(new SeatError('ENTITLEMENT_LAPSED'));
    expect(await completeUserInvitationSetup('a'.repeat(64), 'Sup3r-secret-pass!')).toMatchObject({ errorCode: 'CO_MANAGED_LICENSE_LAPSED' });
  });

  it('an unexpected failure is a setup failure, not a leaked error', async () => {
    verify.mockResolvedValue(seatVerification);
    accept.mockRejectedValue(new Error('connection reset'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { completeUserInvitationSetup } = await load();
    expect(await completeUserInvitationSetup('a'.repeat(64), 'Sup3r-secret-pass!')).toMatchObject({ success: false, errorCode: 'SETUP_FAILED' });
  });
});

describe('ordinary invitations', () => {
  it('take the path they always took: the seat module is never reached', async () => {
    verify.mockResolvedValue(ordinaryVerification);
    const { completeUserInvitationSetup } = await load();
    const result = await completeUserInvitationSetup('c'.repeat(64), 'Sup3r-secret-pass!');
    expect(result).toMatchObject({ success: true, userId: 'ordinary-user', username: invitee.email });
    expect(createFromInvitation).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();
  });

  it('are unaffected by the seat capability being closed', async () => {
    gate.seatServed = false;
    verify.mockResolvedValue(ordinaryVerification);
    const { completeUserInvitationSetup } = await load();
    expect(await completeUserInvitationSetup('c'.repeat(64), 'Sup3r-secret-pass!')).toMatchObject({ success: true, userId: 'ordinary-user' });
  });
});
