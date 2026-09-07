import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import type { IUser } from '@alga-psa/types';
import { CoManagedSharedWorkError, type CoManagedAuthenticatedActor } from '@alga-psa/co-managed';

/** Native browser actions retain their actual tracked session. API time
 * endpoints have a separate adapter for their verified API credential. */
export async function resolveNativeTimeBrowserActor(user: IUser, tenant: string): Promise<CoManagedAuthenticatedActor> {
  const session = await getSession();
  if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
  return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
}
