import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { resolveMeetingDocumentBrowserActor } from '@alga-psa/auth/lib/meetingDocumentActor';
import { admitMeetingDocumentsForBrowser as admitDocuments } from '@shared/lib/meetingDocumentAdmission';

export { meetingDocumentsSeam } from '@shared/lib/meetingDocumentAdmission';
export type { SharedWorkMeetingDocumentsProvider } from '@shared/lib/meetingDocumentAdmission';

export async function admitMeetingDocumentsForBrowser<T extends { document_id: string }>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: T[],
): Promise<{ documents: T[]; assertCurrent?: () => Promise<void> }> {
  return admitDocuments(trx, tenant, () => resolveMeetingDocumentBrowserActor(user, tenant), documents);
}
