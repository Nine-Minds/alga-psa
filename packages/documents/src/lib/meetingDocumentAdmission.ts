import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { admitCoManagedMeetingDocuments, CoManagedSharedWorkError } from '@alga-psa/co-managed';

export function admitMeetingDocumentsForBrowser(trx: Knex.Transaction, tenant: string, user: IUser, documentIds: string[]) {
  return admitCoManagedMeetingDocuments(trx, tenant, documentIds, async () => {
    // LEVERAGE: pattern native-co-managed-session-adapter — scheduling retains the same actual tracked browser credential.
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
    return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
  });
}
