import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';

/** Browser credentials cannot lend their authority to API or automation overrides. */
async function browserActor(user: { user_id: string; user_type?: string }, tenant: string, userType: 'internal' | 'client') {
  if (getApiKeyUserOverride() || user.user_type !== userType) throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern co-managed-browser-identity — browser adapters must reject API overrides and bind the tracked home session.
  const session = await getSession();
  if (!session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== userType) {
    throw new CoManagedSharedWorkError();
  }
  return { kind: 'session' as const, tenant, userId: user.user_id, sessionId: session.session_id };
}

export const coManagedBrowserActor = (user: { user_id: string; user_type?: string }, tenant: string) => browserActor(user, tenant, 'internal');
export const coManagedPortalBrowserActor = (user: { user_id: string; user_type?: string }, tenant: string) => browserActor(user, tenant, 'client');
