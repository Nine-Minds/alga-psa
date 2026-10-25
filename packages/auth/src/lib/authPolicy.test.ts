import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_AUTH_POLICY,
  applyPolicyChange,
  evaluatePasswordLogin,
  isPasswordResetAllowed,
  isPasswordSessionRevokedByPolicy,
  normalizeTenantAuthPolicy,
  refusalReasonForDecision,
  validatePolicyChange,
  type BreakGlassCandidate,
  type PolicySubject,
  type TenantAuthPolicy,
} from './authPolicy';

const policy = (over: Partial<TenantAuthPolicy> = {}): TenantAuthPolicy => ({
  ...DEFAULT_TENANT_AUTH_POLICY,
  passwordBreakGlassUserIds: [],
  ...over,
});

const subject = (over: Partial<PolicySubject> = {}): PolicySubject => ({
  userId: 'u1',
  userType: 'internal',
  twoFactorEnabled: false,
  knownDeviceSkipEnabled: false,
  ...over,
});

const admin = (over: Partial<BreakGlassCandidate> = {}): BreakGlassCandidate => ({
  userId: 'a1',
  userType: 'internal',
  isInactive: false,
  isAdmin: true,
  twoFactorEnabled: true,
  ...over,
});

describe('defaults leave login behavior unchanged', () => {
  it('normalizes missing or malformed settings to all-off', () => {
    for (const raw of [undefined, null, 'x', {}, { sso: null }, { sso: { requireSsoForInternalUsers: 'yes' } }]) {
      expect(normalizeTenantAuthPolicy(raw)).toEqual(DEFAULT_TENANT_AUTH_POLICY);
    }
  });

  it('allows a user without 2FA', () => {
    expect(evaluatePasswordLogin(subject(), policy())).toEqual({ outcome: 'allow' });
    expect(evaluatePasswordLogin(subject({ userType: 'client' }), policy())).toEqual({ outcome: 'allow' });
  });

  it('keeps opt-in 2FA exactly as before, honoring the per-user known-device flag', () => {
    expect(
      evaluatePasswordLogin(subject({ twoFactorEnabled: true, knownDeviceSkipEnabled: true }), policy()),
    ).toEqual({ outcome: 'require-2fa', allowKnownDeviceSkip: true, policyEnforced: false });
    expect(evaluatePasswordLogin(subject({ twoFactorEnabled: true }), policy())).toEqual({
      outcome: 'require-2fa',
      allowKnownDeviceSkip: false,
      policyEnforced: false,
    });
  });

  it('never revokes sessions or blocks resets by default', () => {
    expect(
      isPasswordSessionRevokedByPolicy(
        { userId: 'u1', userType: 'internal', loginMethod: 'credentials', authIssuedAtMs: undefined },
        policy(),
      ),
    ).toBe(false);
    expect(isPasswordResetAllowed({ userId: 'u1', userType: 'internal' }, policy())).toBe(true);
  });
});

describe('SSO required', () => {
  const sso = policy({ requireSsoForInternalUsers: true, passwordBreakGlassUserIds: ['bg'] });

  it('denies password login for internal users and reports sso_required', () => {
    const decision = evaluatePasswordLogin(subject({ twoFactorEnabled: true }), sso);
    expect(decision).toEqual({ outcome: 'deny-sso-required' });
    expect(refusalReasonForDecision(decision)).toBe('sso_required');
  });

  it('never affects client portal users', () => {
    expect(evaluatePasswordLogin(subject({ userType: 'client' }), sso)).toEqual({ outcome: 'allow' });
  });

  it('lets break-glass users in only with TOTP and never with the known-device skip', () => {
    expect(
      evaluatePasswordLogin(
        subject({ userId: 'bg', twoFactorEnabled: true, knownDeviceSkipEnabled: true }),
        policy({ ...sso, allowKnownDevice2faSkip: true }),
      ),
    ).toEqual({ outcome: 'require-2fa', allowKnownDeviceSkip: false, policyEnforced: true });
  });

  it('sends a break-glass user without 2FA to enrollment rather than letting the password through', () => {
    expect(evaluatePasswordLogin(subject({ userId: 'bg' }), sso)).toEqual({ outcome: 'require-2fa-enrollment' });
  });

  it('blocks password reset for non-break-glass internal users only', () => {
    expect(isPasswordResetAllowed({ userId: 'u1', userType: 'internal' }, sso)).toBe(false);
    expect(isPasswordResetAllowed({ userId: 'bg', userType: 'internal' }, sso)).toBe(true);
    expect(isPasswordResetAllowed({ userId: 'c1', userType: 'client' }, sso)).toBe(true);
  });
});

describe('2FA policy', () => {
  it('sends an unenrolled internal user to enrollment and reports 2fa_enrollment_required', () => {
    const decision = evaluatePasswordLogin(subject(), policy({ require2faForInternalUsers: true }));
    expect(decision).toEqual({ outcome: 'require-2fa-enrollment' });
    expect(refusalReasonForDecision(decision)).toBe('2fa_enrollment_required');
  });

  it('keeps internal and client toggles separate', () => {
    const internalOnly = policy({ require2faForInternalUsers: true });
    expect(evaluatePasswordLogin(subject({ userType: 'client' }), internalOnly)).toEqual({ outcome: 'allow' });
    const clientOnly = policy({ require2faForClientUsers: true });
    expect(evaluatePasswordLogin(subject(), clientOnly)).toEqual({ outcome: 'allow' });
    expect(evaluatePasswordLogin(subject({ userType: 'client' }), clientOnly)).toEqual({
      outcome: 'require-2fa-enrollment',
    });
  });

  it('honors the known-device skip only when the tenant allows it and the user opted in', () => {
    const enrolled = subject({ twoFactorEnabled: true, knownDeviceSkipEnabled: true });
    expect(
      evaluatePasswordLogin(enrolled, policy({ require2faForInternalUsers: true })),
    ).toMatchObject({ outcome: 'require-2fa', allowKnownDeviceSkip: false, policyEnforced: true });
    expect(
      evaluatePasswordLogin(enrolled, policy({ require2faForInternalUsers: true, allowKnownDevice2faSkip: true })),
    ).toMatchObject({ allowKnownDeviceSkip: true });
    expect(
      evaluatePasswordLogin(
        subject({ twoFactorEnabled: true }),
        policy({ require2faForInternalUsers: true, allowKnownDevice2faSkip: true }),
      ),
    ).toMatchObject({ allowKnownDeviceSkip: false });
  });
});

describe('session invalidation by passwordAuthDisabledAt', () => {
  const cutoff = '2026-01-01T00:00:00.000Z';
  const cutoffMs = Date.parse(cutoff);
  const on = policy({ requireSsoForInternalUsers: true, passwordAuthDisabledAt: cutoff, passwordBreakGlassUserIds: ['bg'] });
  const claims = (over = {}) => ({
    userId: 'u1',
    userType: 'internal',
    loginMethod: 'credentials' as string | undefined,
    authIssuedAtMs: cutoffMs - 1000 as number | undefined,
    ...over,
  });

  it('revokes internal password sessions issued before the cutoff', () => {
    expect(isPasswordSessionRevokedByPolicy(claims(), on)).toBe(true);
  });
  it('treats tokens without an issue-time claim as older than the cutoff', () => {
    expect(isPasswordSessionRevokedByPolicy(claims({ authIssuedAtMs: undefined }), on)).toBe(true);
    expect(isPasswordSessionRevokedByPolicy(claims({ authIssuedAtMs: undefined, loginMethod: undefined }), on)).toBe(true);
  });
  it('keeps sessions issued after the cutoff, SSO sessions, break-glass and client sessions', () => {
    expect(isPasswordSessionRevokedByPolicy(claims({ authIssuedAtMs: cutoffMs + 1 }), on)).toBe(false);
    expect(isPasswordSessionRevokedByPolicy(claims({ loginMethod: 'google' }), on)).toBe(false);
    expect(isPasswordSessionRevokedByPolicy(claims({ userId: 'bg' }), on)).toBe(false);
    expect(isPasswordSessionRevokedByPolicy(claims({ userType: 'client' }), on)).toBe(false);
  });
  it('does nothing once SSO is no longer required', () => {
    expect(isPasswordSessionRevokedByPolicy(claims(), { ...on, requireSsoForInternalUsers: false })).toBe(false);
  });
  it('is not triggered by a 2FA policy', () => {
    expect(isPasswordSessionRevokedByPolicy(claims(), policy({ require2faForInternalUsers: true }))).toBe(false);
  });
});

describe('save-time guard', () => {
  const ssoOn = (ids: string[]) => policy({ requireSsoForInternalUsers: true, passwordBreakGlassUserIds: ids });

  it('accepts SSO-required with a provider and a valid break-glass admin', () => {
    expect(
      validatePolicyChange({ next: ssoOn(['a1']), hasConfiguredSsoProvider: true, breakGlassCandidates: [admin()] }),
    ).toMatchObject({ ok: true, errors: [] });
  });

  it('rejects SSO-required without a configured provider', () => {
    expect(
      validatePolicyChange({ next: ssoOn(['a1']), hasConfiguredSsoProvider: false, breakGlassCandidates: [admin()] }).errors,
    ).toContain('sso_provider_required');
  });

  it('rejects SSO-required with no break-glass admin', () => {
    expect(
      validatePolicyChange({ next: ssoOn([]), hasConfiguredSsoProvider: true, breakGlassCandidates: [] }).errors,
    ).toContain('break_glass_required');
  });

  it('rejects non-admins, users without 2FA, inactive and client users as break-glass', () => {
    for (const bad of [
      admin({ isAdmin: false }),
      admin({ twoFactorEnabled: false }),
      admin({ isInactive: true }),
      admin({ userType: 'client' }),
    ]) {
      const result = validatePolicyChange({ next: ssoOn(['a1']), hasConfiguredSsoProvider: true, breakGlassCandidates: [bad] });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('break_glass_invalid_user');
      expect(result.invalidBreakGlassUserIds).toEqual(['a1']);
    }
  });

  it('rejects an unknown break-glass id and revalidates when SSO is already on (last admin removed / lost 2FA)', () => {
    expect(
      validatePolicyChange({ next: ssoOn(['ghost']), hasConfiguredSsoProvider: true, breakGlassCandidates: [] }).ok,
    ).toBe(false);
    const removedLast = validatePolicyChange({ next: ssoOn([]), hasConfiguredSsoProvider: true, breakGlassCandidates: [] });
    expect(removedLast.errors).toContain('break_glass_required');
  });

  it('does not require a provider or admins while SSO is off, but still rejects a newly added invalid id', () => {
    expect(validatePolicyChange({ next: policy(), hasConfiguredSsoProvider: false, breakGlassCandidates: [] }).ok).toBe(true);
    const result = validatePolicyChange({
      next: policy({ passwordBreakGlassUserIds: ['a1'] }),
      previous: policy(),
      hasConfiguredSsoProvider: false,
      breakGlassCandidates: [admin({ twoFactorEnabled: false })],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['break_glass_invalid_user']);
    expect(result.invalidBreakGlassUserIds).toEqual(['a1']);
  });

  describe('stale stored break-glass ids', () => {
    const stale = admin({ userId: 'stale', twoFactorEnabled: false });
    const stored = (over: Partial<TenantAuthPolicy> = {}) =>
      policy({ passwordBreakGlassUserIds: ['stale'], ...over });

    it('(a) turning SSO off succeeds and prunes the stale id', () => {
      const result = validatePolicyChange({
        next: stored({ requireSsoForInternalUsers: false }),
        previous: stored({ requireSsoForInternalUsers: true }),
        hasConfiguredSsoProvider: false,
        breakGlassCandidates: [stale],
      });
      expect(result).toMatchObject({ ok: true, errors: [], breakGlassUserIds: [], prunedBreakGlassUserIds: ['stale'] });
    });

    it('(a2) an OFF transition succeeds even when it also adds an invalid id (pruned, not rejected)', () => {
      const result = validatePolicyChange({
        next: policy({ passwordBreakGlassUserIds: ['stale', 'bad'] }),
        previous: stored({ requireSsoForInternalUsers: true }),
        hasConfiguredSsoProvider: false,
        breakGlassCandidates: [stale, admin({ userId: 'bad', isAdmin: false })],
      });
      expect(result.ok).toBe(true);
      expect(result.prunedBreakGlassUserIds).toEqual(['stale', 'bad']);
    });

    it('(b) SSO on with another valid admin succeeds and prunes the stale id', () => {
      const prev = stored({ requireSsoForInternalUsers: true });
      const result = validatePolicyChange({
        next: { ...prev, passwordBreakGlassUserIds: ['stale', 'a1'] },
        previous: prev,
        hasConfiguredSsoProvider: true,
        breakGlassCandidates: [stale, admin()],
      });
      expect(result).toMatchObject({ ok: true, breakGlassUserIds: ['a1'], prunedBreakGlassUserIds: ['stale'] });
    });

    it('(c) a stale id as the only admin with SSO on gives break_glass_required', () => {
      const prev = stored();
      const result = validatePolicyChange({
        next: { ...prev, requireSsoForInternalUsers: true },
        previous: prev,
        hasConfiguredSsoProvider: true,
        breakGlassCandidates: [stale],
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['break_glass_required']);
    });

    it('(d) a newly added invalid id is rejected even next to a stale one', () => {
      const prev = stored({ requireSsoForInternalUsers: true });
      const result = validatePolicyChange({
        next: { ...prev, passwordBreakGlassUserIds: ['stale', 'a1', 'new-bad'] },
        previous: prev,
        hasConfiguredSsoProvider: true,
        breakGlassCandidates: [stale, admin(), admin({ userId: 'new-bad', isInactive: true })],
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('break_glass_invalid_user');
      expect(result.invalidBreakGlassUserIds).toEqual(['new-bad']);
    });
  });
});

describe('applyPolicyChange', () => {
  const now = new Date('2026-02-02T10:00:00.000Z');

  it('stamps passwordAuthDisabledAt only on the off to on transition', () => {
    const first = applyPolicyChange(policy(), { requireSsoForInternalUsers: true }, now);
    expect(first.passwordAuthDisabledAt).toBe(now.toISOString());
    const later = applyPolicyChange(first, { require2faForClientUsers: true }, new Date('2026-03-03T00:00:00Z'));
    expect(later.passwordAuthDisabledAt).toBe(now.toISOString());
  });

  it('clears the cutoff when SSO is turned off and leaves 2FA toggles from revoking anything', () => {
    const on = applyPolicyChange(policy(), { requireSsoForInternalUsers: true }, now);
    expect(applyPolicyChange(on, { requireSsoForInternalUsers: false }, now).passwordAuthDisabledAt).toBeNull();
    expect(applyPolicyChange(policy(), { require2faForInternalUsers: true }, now).passwordAuthDisabledAt).toBeNull();
  });

  it('de-duplicates break-glass ids and keeps unspecified fields', () => {
    const next = applyPolicyChange(policy({ allowKnownDevice2faSkip: true }), { passwordBreakGlassUserIds: ['a', 'a', 'b'] }, now);
    expect(next.passwordBreakGlassUserIds).toEqual(['a', 'b']);
    expect(next.allowKnownDevice2faSkip).toBe(true);
  });
});
