// CE stub: tenant login policies (SSO-required, 2FA) are an Enterprise feature.
// With no policy saved, login enforcement in packages/auth is a no-op.
export type LoginPolicyErrorCode =
  | 'sso_provider_required'
  | 'break_glass_required'
  | 'break_glass_invalid_user'
  | 'client_portal_sso_provider_invalid'
  | 'save_failed';

export interface LoginPolicyState {
  policy: {
    requireSsoForInternalUsers: boolean;
    require2faForInternalUsers: boolean;
    require2faForClientUsers: boolean;
    allowKnownDevice2faSkip: boolean;
    passwordBreakGlassUserIds: string[];
    passwordAuthDisabledAt: string | null;
    clientPortalSsoProviders: Array<'google' | 'azure-ad' | 'keycloak'> | null;
  };
  eligibleBreakGlassAdmins: Array<{ userId: string; name: string; email: string }>;
  ineligibleBreakGlassUsers: Array<{
    userId: string;
    name?: string;
    email?: string;
    reason?: 'inactive' | 'not_admin' | 'no_two_factor' | 'not_internal' | 'not_found';
  }>;
  hasConfiguredSsoProvider: boolean;
  availableClientPortalSsoProviders: Array<'google' | 'azure-ad' | 'keycloak'>;
}

export type LoginPolicyUpdate = Partial<
  Omit<LoginPolicyState['policy'], 'passwordAuthDisabledAt'>
>;

export interface UpdateLoginPolicyResult {
  success: boolean;
  errors?: LoginPolicyErrorCode[];
  invalidBreakGlassUserIds?: string[];
  state?: LoginPolicyState;
}

export async function getLoginPolicyAction(): Promise<LoginPolicyState> {
  return {
    policy: {
      requireSsoForInternalUsers: false,
      require2faForInternalUsers: false,
      require2faForClientUsers: false,
      allowKnownDevice2faSkip: false,
      passwordBreakGlassUserIds: [],
      passwordAuthDisabledAt: null,
      clientPortalSsoProviders: null,
    },
    eligibleBreakGlassAdmins: [],
    ineligibleBreakGlassUsers: [],
    hasConfiguredSsoProvider: false,
    availableClientPortalSsoProviders: [],
  };
}

export async function updateLoginPolicyAction(
  _updates: LoginPolicyUpdate
): Promise<UpdateLoginPolicyResult> {
  return { success: false };
}
