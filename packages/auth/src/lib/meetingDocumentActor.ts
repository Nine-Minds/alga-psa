import type { IUser } from '@alga-psa/types';
import type { MeetingDocumentActor } from '@alga-psa/shared/lib/meetingDocumentAdmission';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';

/** Same shape and discriminators as the provider's CoManagedSharedWorkError; native code never imports that package. */
class MeetingDocumentForbiddenError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() {
    super('This shared resource is not available for the requested operation.');
    this.name = 'CoManagedSharedWorkError';
  }
}

/** Resolve credentials only when meeting admission needs the tracked browser actor. */
export async function resolveMeetingDocumentBrowserActor(user: IUser, tenant: string): Promise<MeetingDocumentActor> {
  // LEVERAGE: pattern shared-work-browser-actor — scheduling, clients and documents each resolve this same tracked browser identity.
  const session = await getSession();
  if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant
    || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new MeetingDocumentForbiddenError();
  return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
}
