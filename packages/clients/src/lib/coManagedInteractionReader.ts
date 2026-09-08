import type { IUser } from '@alga-psa/types';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { CoManagedSharedWorkError, type CoManagedAuthenticatedActor } from '@alga-psa/co-managed';

export async function resolveInteractionBrowserActor(user: IUser, tenant: string): Promise<CoManagedAuthenticatedActor> {
  // LEVERAGE: pattern native-co-managed-session-adapter — scheduling and documents retain this same tracked browser identity; API credential propagation remains a separate boundary.
  const session = await getSession();
  if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
  return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
}
