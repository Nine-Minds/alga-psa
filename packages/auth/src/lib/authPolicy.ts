/**
 * Tenant login policy: SSO-only enforcement and 2FA requirements for password sign-in.
 *
 * This module is PURE (no I/O) and is the single place the decisions are made.
 * `authPolicyStore.ts` loads the policy and writes audit records; callers that
 * accept a password (`authenticateUser`, the NextAuth credentials `authorize`
 * callbacks, password reset) route through the functions here.
 *
 * Scope decisions (approved design, Design Session e896c2d5):
 *  - The SSO requirement is tenant-wide and covers ALL internal (MSP) users. It is
 *    not scoped by email domain or role. "Any SSO" counts: Google, Microsoft/Entra,
 *    or the per-tenant Keycloak (which is how SAML reaches us). There is no
 *    per-provider pinning.
 *  - Client-portal users are never affected by the SSO requirement. They have their
 *    own 2FA toggle.
 *  - API keys are OUT OF SCOPE. They are a separate machine credential and this
 *    policy neither gates nor revokes them.
 *  - Turning on a 2FA policy does NOT revoke existing sessions. Only turning on
 *    `requireSsoForInternalUsers` revokes password-obtained internal sessions
 *    (see `isPasswordSessionRevokedByPolicy`).
 *  - Mobile auth is OTT/OIDC only and inherits the web sign-in it hands off from.
 *
 * Every default is "off", so a tenant with no `settings.sso` policy fields behaves
 * exactly as before this module existed.
 */

export interface TenantAuthPolicy {
  requireSsoForInternalUsers: boolean;
  require2faForInternalUsers: boolean;
  require2faForClientUsers: boolean;
  /** Honor the per-user known-device 2FA skip while a 2FA policy applies. */
  allowKnownDevice2faSkip: boolean;
  /** Internal admins who may still sign in with a password (always with TOTP) while SSO is required. */
  passwordBreakGlassUserIds: string[];
  /** ISO timestamp: internal password sessions issued before this are revoked. */
  passwordAuthDisabledAt: string | null;
}

export const DEFAULT_TENANT_AUTH_POLICY: Readonly<TenantAuthPolicy> = Object.freeze({
  requireSsoForInternalUsers: false,
  require2faForInternalUsers: false,
  require2faForClientUsers: false,
  allowKnownDevice2faSkip: false,
  passwordBreakGlassUserIds: [],
  passwordAuthDisabledAt: null,
});

/** Reads the policy out of the tenant `settings` JSON (the `sso` blob). Tolerates anything. */
export function normalizeTenantAuthPolicy(tenantSettings: unknown): TenantAuthPolicy {
  const sso =
    tenantSettings && typeof tenantSettings === 'object'
      ? (tenantSettings as Record<string, unknown>).sso
      : undefined;
  if (!sso || typeof sso !== 'object') {
    return { ...DEFAULT_TENANT_AUTH_POLICY, passwordBreakGlassUserIds: [] };
  }
  const raw = sso as Record<string, unknown>;
  const ids = Array.isArray(raw.passwordBreakGlassUserIds)
    ? Array.from(
        new Set(
          raw.passwordBreakGlassUserIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
        ),
      )
    : [];
  const disabledAt =
    typeof raw.passwordAuthDisabledAt === 'string' &&
    !Number.isNaN(Date.parse(raw.passwordAuthDisabledAt))
      ? raw.passwordAuthDisabledAt
      : null;
  return {
    requireSsoForInternalUsers: raw.requireSsoForInternalUsers === true,
    require2faForInternalUsers: raw.require2faForInternalUsers === true,
    require2faForClientUsers: raw.require2faForClientUsers === true,
    allowKnownDevice2faSkip: raw.allowKnownDevice2faSkip === true,
    passwordBreakGlassUserIds: ids,
    passwordAuthDisabledAt: disabledAt,
  };
}

export type PolicyUserType = 'internal' | 'client';

export interface PolicySubject {
  userId: string;
  userType: PolicyUserType;
  twoFactorEnabled: boolean;
  /** The existing per-user flag (`two_factor_required_new_device`): skip TOTP on a recognised device. */
  knownDeviceSkipEnabled: boolean;
}

export type PasswordLoginDecision =
  /** Password may not be used at all (SSO is required for this user). */
  | { outcome: 'deny-sso-required' }
  /** Policy needs TOTP but the user has none: send them into forced enrollment. */
  | { outcome: 'require-2fa-enrollment' }
  /**
   * The user must present a TOTP code. `allowKnownDeviceSkip` says whether a
   * recognised device may stand in for it. `policyEnforced` distinguishes a
   * tenant-policy requirement from the user's own opt-in 2FA.
   */
  | { outcome: 'require-2fa'; allowKnownDeviceSkip: boolean; policyEnforced: boolean }
  | { outcome: 'allow' };

export function isBreakGlassUser(policy: TenantAuthPolicy, userId: string): boolean {
  return policy.passwordBreakGlassUserIds.includes(userId);
}

/**
 * Decide what a successful password check is allowed to become.
 *
 * Order matters: SSO denial first, then break-glass (always TOTP, never a
 * known-device skip), then the tenant 2FA toggles, then today's behaviour.
 */
export function evaluatePasswordLogin(
  subject: PolicySubject,
  policy: TenantAuthPolicy,
): PasswordLoginDecision {
  const ssoRequired = subject.userType === 'internal' && policy.requireSsoForInternalUsers;

  if (ssoRequired) {
    if (!isBreakGlassUser(policy, subject.userId)) {
      return { outcome: 'deny-sso-required' };
    }
    // Break-glass: password only ever together with TOTP; the known-device skip is never allowed.
    return subject.twoFactorEnabled
      ? { outcome: 'require-2fa', allowKnownDeviceSkip: false, policyEnforced: true }
      : { outcome: 'require-2fa-enrollment' };
  }

  const twoFactorRequiredByPolicy =
    (subject.userType === 'internal' && policy.require2faForInternalUsers) ||
    (subject.userType === 'client' && policy.require2faForClientUsers);

  if (twoFactorRequiredByPolicy) {
    if (!subject.twoFactorEnabled) {
      return { outcome: 'require-2fa-enrollment' };
    }
    return {
      outcome: 'require-2fa',
      // Under a policy the skip needs the tenant's blessing as well as the user's own flag.
      allowKnownDeviceSkip: policy.allowKnownDevice2faSkip && subject.knownDeviceSkipEnabled,
      policyEnforced: true,
    };
  }

  // No tenant policy applies: exactly the pre-existing behaviour.
  if (subject.twoFactorEnabled) {
    return {
      outcome: 'require-2fa',
      allowKnownDeviceSkip: subject.knownDeviceSkipEnabled,
      policyEnforced: false,
    };
  }
  return { outcome: 'allow' };
}

/** Reason codes written to the audit log and returned to the login forms. */
export type LoginRefusalReason = 'sso_required' | '2fa_enrollment_required';

export function refusalReasonForDecision(
  decision: PasswordLoginDecision,
): LoginRefusalReason | null {
  switch (decision.outcome) {
    case 'deny-sso-required':
      return 'sso_required';
    case 'require-2fa-enrollment':
      return '2fa_enrollment_required';
    default:
      return null;
  }
}

/** Surfaces that accept a password. Recorded with each refusal. */
export type PasswordAuthSurface =
  | 'msp_login'
  | 'client_login'
  | 'password_reset_request'
  | 'password_reset_complete'
  | 'two_factor_enrollment'
  | 'credentials';

/**
 * Should a password reset be honoured for this user? Under SSO-required, an
 * internal non-break-glass user must not be able to request or complete a reset.
 * (Even though a reset never itself creates a session, the reset email and the
 * new password would otherwise be a standing invitation to password login.)
 */
export function isPasswordResetAllowed(
  subject: Pick<PolicySubject, 'userId' | 'userType'>,
  policy: TenantAuthPolicy,
): boolean {
  if (subject.userType !== 'internal' || !policy.requireSsoForInternalUsers) {
    return true;
  }
  return isBreakGlassUser(policy, subject.userId);
}

export interface TokenAuthClaims {
  userId: string | undefined;
  userType: string | undefined;
  /** `login_method` claim: 'credentials' for password sign-ins, else the SSO provider id. */
  loginMethod: string | undefined;
  /** `auth_issued_at` claim: epoch ms when this token was minted by a sign-in. */
  authIssuedAtMs: number | undefined;
}

/**
 * Existing-session revocation. While `requireSsoForInternalUsers` is on, an
 * internal token obtained by password before `passwordAuthDisabledAt` is dead,
 * except for break-glass users. A token with no `auth_issued_at` claim predates
 * this feature and is therefore treated as issued before the cutoff.
 */
export function isPasswordSessionRevokedByPolicy(
  claims: TokenAuthClaims,
  policy: TenantAuthPolicy,
): boolean {
  if (!policy.requireSsoForInternalUsers || !policy.passwordAuthDisabledAt) {
    return false;
  }
  if (claims.userType !== 'internal') {
    return false;
  }
  if (claims.loginMethod !== undefined && claims.loginMethod !== 'credentials') {
    return false; // SSO session
  }
  if (claims.userId && isBreakGlassUser(policy, claims.userId)) {
    return false;
  }
  const cutoff = Date.parse(policy.passwordAuthDisabledAt);
  if (Number.isNaN(cutoff)) {
    return false;
  }
  return (claims.authIssuedAtMs ?? 0) < cutoff;
}

// ---------------------------------------------------------------------------
// Save-time guard
// ---------------------------------------------------------------------------

export interface BreakGlassCandidate {
  userId: string;
  userType: string;
  isInactive: boolean;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
}

export function isValidBreakGlassCandidate(candidate: BreakGlassCandidate): boolean {
  return (
    candidate.userType === 'internal' &&
    !candidate.isInactive &&
    candidate.isAdmin &&
    candidate.twoFactorEnabled
  );
}

export type PolicyGuardErrorCode =
  | 'sso_provider_required'
  | 'break_glass_required'
  | 'break_glass_invalid_user';

export interface PolicyGuardInput {
  next: TenantAuthPolicy;
  /** The policy as currently stored. Ids already in its break-glass list are "stored"; all others are "newly added". */
  previous?: TenantAuthPolicy;
  /** True when the tenant has at least one active, configured SSO provider. */
  hasConfiguredSsoProvider: boolean;
  /** Candidate records for every id in `next.passwordBreakGlassUserIds` that could be found. */
  breakGlassCandidates: BreakGlassCandidate[];
}

export interface PolicyGuardResult {
  ok: boolean;
  errors: PolicyGuardErrorCode[];
  /** Newly added ids in the request that are not valid break-glass admins (the reason for `break_glass_invalid_user`). */
  invalidBreakGlassUserIds: string[];
  /** The break-glass list to persist: `next`'s list minus every ineligible id. */
  breakGlassUserIds: string[];
  /** Stored ids that were dropped because they are no longer eligible (2FA reset, deactivated, demoted, deleted). */
  prunedBreakGlassUserIds: string[];
}

/**
 * Save-time guard, run by the server on EVERY save (not just on the transition to
 * "on"), so the last valid break-glass admin cannot be removed while the SSO
 * requirement is active.
 *
 * Prune-vs-reject: an id that was already stored and has since lost eligibility is
 * stale state the admin may not even see, so it is pruned from the persisted list
 * rather than blocking the save. An id newly added by this request that is not
 * eligible is a bad request and is rejected, except when the save turns Require
 * SSO off from on: an OFF transition must always succeed, so it prunes instead.
 *
 *  - With SSO required: at least one configured provider AND >= 1 valid admin
 *    (counted after pruning).
 */
export function validatePolicyChange(input: PolicyGuardInput): PolicyGuardResult {
  const errors: PolicyGuardErrorCode[] = [];
  const byId = new Map(input.breakGlassCandidates.map((c) => [c.userId, c]));
  const stored = new Set(input.previous?.passwordBreakGlassUserIds ?? []);
  const isValid = (id: string) => {
    const candidate = byId.get(id);
    return Boolean(candidate && isValidBreakGlassCandidate(candidate));
  };
  const requested = input.next.passwordBreakGlassUserIds;
  const breakGlassUserIds = requested.filter(isValid);
  const ineligible = requested.filter((id) => !isValid(id));
  const prunedBreakGlassUserIds = ineligible.filter((id) => stored.has(id));
  const newlyInvalid = ineligible.filter((id) => !stored.has(id));

  const turningOff =
    !input.next.requireSsoForInternalUsers && Boolean(input.previous?.requireSsoForInternalUsers);
  if (turningOff) {
    // Never block an OFF transition: drop everything ineligible.
    return {
      ok: true,
      errors,
      invalidBreakGlassUserIds: [],
      breakGlassUserIds,
      prunedBreakGlassUserIds: ineligible,
    };
  }

  if (newlyInvalid.length > 0) {
    errors.push('break_glass_invalid_user');
  }
  if (input.next.requireSsoForInternalUsers) {
    if (!input.hasConfiguredSsoProvider) {
      errors.push('sso_provider_required');
    }
    if (breakGlassUserIds.length < 1) {
      errors.push('break_glass_required');
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    invalidBreakGlassUserIds: newlyInvalid,
    breakGlassUserIds,
    prunedBreakGlassUserIds,
  };
}

/**
 * Compute the persisted policy from the previous one and the requested change.
 * Stamps/clears `passwordAuthDisabledAt` on SSO transitions; leaves it alone
 * otherwise so unrelated saves do not re-revoke sessions.
 */
export function applyPolicyChange(
  previous: TenantAuthPolicy,
  requested: Partial<Omit<TenantAuthPolicy, 'passwordAuthDisabledAt'>>,
  now: Date = new Date(),
): TenantAuthPolicy {
  const next: TenantAuthPolicy = {
    requireSsoForInternalUsers:
      requested.requireSsoForInternalUsers ?? previous.requireSsoForInternalUsers,
    require2faForInternalUsers:
      requested.require2faForInternalUsers ?? previous.require2faForInternalUsers,
    require2faForClientUsers:
      requested.require2faForClientUsers ?? previous.require2faForClientUsers,
    allowKnownDevice2faSkip:
      requested.allowKnownDevice2faSkip ?? previous.allowKnownDevice2faSkip,
    passwordBreakGlassUserIds: Array.from(
      new Set(requested.passwordBreakGlassUserIds ?? previous.passwordBreakGlassUserIds),
    ),
    passwordAuthDisabledAt: previous.passwordAuthDisabledAt,
  };
  if (next.requireSsoForInternalUsers && !previous.requireSsoForInternalUsers) {
    next.passwordAuthDisabledAt = now.toISOString();
  } else if (!next.requireSsoForInternalUsers) {
    next.passwordAuthDisabledAt = null;
  }
  return next;
}
