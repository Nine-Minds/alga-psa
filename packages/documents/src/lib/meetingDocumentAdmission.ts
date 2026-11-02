import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

type MeetingDocumentActor =
  | { kind: 'session'; tenant: string; userId: string; sessionId: string }
  | { kind: 'api_key'; tenant: string; userId: string; apiKeyId: string };

export interface SharedWorkMeetingDocumentsProvider {
  admitMeetingDocuments(db: Knex, tenant: string, documentIds: string[], identify: () => Promise<MeetingDocumentActor>
  ): Promise<{ handled: false } | { handled: true; deniedDocumentIds: string[]; assertCurrent?: () => Promise<void> }>;
}

// LEVERAGE: pattern shared-work-seam — scheduling, clients and documents each declare one seam over the same generic registry.
export const meetingDocumentsSeam = sharedWorkSeam<SharedWorkMeetingDocumentsProvider>('meetingDocuments');

/** Same shape and discriminators as the provider's CoManagedSharedWorkError; native code never imports that package. */
class MeetingDocumentForbiddenError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() {
    super('This shared resource is not available for the requested operation.');
    this.name = 'CoManagedSharedWorkError';
  }
}

/**
 * Deny-only admission for meeting recordings/transcripts stored as documents. A served
 * workspace's provider withholds artifact documents whose meeting the browser actor cannot
 * reach; it never admits a document the shared authorization engine would refuse, because the
 * engine still runs on the narrowed set afterwards. A plain PSA tenant gets the input back from
 * the cached participation verdict with no SQL.
 *
 * `assertCurrent` re-checks the admitting credential after the engine's decision, so a session
 * revoked mid-read cannot carry the result out.
 */
export async function admitMeetingDocumentsForBrowser<T extends { document_id: string }>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: T[],
): Promise<{ documents: T[]; assertCurrent?: () => Promise<void> }> {
  if (documents.length === 0) return { documents };
  const admission = await meetingDocumentsSeam.delegate(tenant, provider =>
    provider.admitMeetingDocuments(trx, tenant, documents.map(document => document.document_id), async () => {
      // LEVERAGE: pattern shared-work-browser-actor — scheduling, clients and documents each resolve this same tracked browser identity; the packages cannot import one another.
      const session = await getSession();
      if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant
        || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new MeetingDocumentForbiddenError();
      return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
    }));
  if (!admission.handled) return { documents };
  const denied = new Set(admission.deniedDocumentIds);
  return { documents: documents.filter(document => !denied.has(document.document_id)), assertCurrent: admission.assertCurrent };
}
