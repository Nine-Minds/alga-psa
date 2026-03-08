import {
  getSession,
  getSessionWithRevocationCheck,
  resolveTeamsMicrosoftProviderConfig,
} from '@alga-psa/auth';

type TeamsTabForbiddenReason = 'missing_tenant' | 'client_user' | 'wrong_tenant' | 'unauthorized';

export type TeamsTabAuthState =
  | {
      status: 'ready';
      tenantId: string;
      userId: string;
      userName: string | null;
      userEmail: string | null;
      profileId: string;
      microsoftTenantId: string;
    }
  | {
      status: 'unauthenticated';
      message: string;
    }
  | {
      status: 'forbidden';
      reason: TeamsTabForbiddenReason;
      tenantId?: string;
      message: string;
    }
  | {
      status: 'not_configured' | 'invalid_profile';
      tenantId: string;
      message: string;
    };

interface ResolveTeamsTabAuthStateOptions {
  expectedTenantId?: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function resolveTeamsTabAuthState(
  options: ResolveTeamsTabAuthStateOptions = {}
): Promise<TeamsTabAuthState> {
  const session =
    (await getSessionWithRevocationCheck()) ??
    (process.env.NODE_ENV !== 'production' ? await getSession() : null);

  if (!session?.user) {
    return {
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    };
  }

  const tenantId = normalizeOptionalString((session.user as any).tenant);
  if (!tenantId) {
    return {
      status: 'forbidden',
      reason: 'missing_tenant',
      message: 'Your account is missing the MSP tenant context required for Teams.',
    };
  }

  if (session.user.user_type !== 'internal') {
    return {
      status: 'forbidden',
      reason: 'client_user',
      tenantId,
      message: 'Microsoft Teams access is available only to MSP users in v1.',
    };
  }

  const expectedTenantId = normalizeOptionalString(options.expectedTenantId);
  if (expectedTenantId && expectedTenantId !== tenantId) {
    return {
      status: 'forbidden',
      reason: 'wrong_tenant',
      tenantId,
      message: 'This Teams tab request does not match your PSA tenant.',
    };
  }

  const userId = normalizeOptionalString((session.user as any).id);
  if (!userId) {
    return {
      status: 'forbidden',
      reason: 'unauthorized',
      tenantId,
      message: 'Your session is missing the PSA user context required for Teams.',
    };
  }

  const provider = await resolveTeamsMicrosoftProviderConfig(tenantId);
  if (provider.status !== 'ready') {
    return {
      status: provider.status,
      tenantId,
      message:
        provider.message ||
        (provider.status === 'not_configured'
          ? 'Teams has not been configured for this tenant yet.'
          : 'The selected Teams Microsoft profile is not ready.'),
    };
  }

  return {
    status: 'ready',
    tenantId,
    userId,
    userName: normalizeOptionalString(session.user.name),
    userEmail: normalizeOptionalString(session.user.email),
    profileId: provider.profileId!,
    microsoftTenantId: provider.microsoftTenantId || 'common',
  };
}
