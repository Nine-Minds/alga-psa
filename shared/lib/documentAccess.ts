import type { Knex } from 'knex';
import type { IDocument, IUser } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  authorizeAndRedactDocumentsForAction as authorizeDocumentRowsForAction,
  type DocumentAuthorizationAction,
} from './documentAuthorization';
import { applyDocumentProductReadScope } from './documentProductReadScope';
import { admitMeetingDocumentsForBrowser, type MeetingDocumentActor } from './meetingDocumentAdmission';

/** `authorizeAndRedactDocuments` for any document action; `update` and `delete` also pass the kernel's mutation decision. */
export async function authorizeDocumentsForAction<T extends IDocument>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: T[],
  action: DocumentAuthorizationAction,
  identify: () => Promise<MeetingDocumentActor>,
  verifiedRecipientLifecycleAccess?: (documentId: string) => Promise<boolean>
): Promise<T[]> {
  const admitted = await admitMeetingDocumentsForBrowser(trx, tenant, identify, documents);
  const authorized = await authorizeDocumentRowsForAction(trx, tenant, user, admitted.documents, action, verifiedRecipientLifecycleAccess);
  await admitted.assertCurrent?.();
  return authorized;
}

/** Load a tenant-scoped document through product, meeting, relationship and redaction policy.
 * Callers remain responsible for the operation's RBAC gate.
 */
export async function getAuthorizedDocumentById(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documentId: string,
  identify: () => Promise<MeetingDocumentActor>
): Promise<IDocument | null> {
  return loadAuthorizedDocumentById(trx, tenant, user, documentId, 'read', identify);
}

export async function loadAuthorizedDocumentById(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documentId: string,
  action: DocumentAuthorizationAction,
  identify: () => Promise<MeetingDocumentActor>
): Promise<IDocument | null> {
  const document = await tenantDb(trx, tenant).table('documents')
    .modify(query => applyDocumentProductReadScope(query, trx, user))
    .where('document_id', documentId)
    .first();

  if (!document) {
    return null;
  }

  const [authorizedDocument] = await authorizeDocumentsForAction(trx, tenant, user, [document as IDocument], action, identify);
  return authorizedDocument ?? null;
}
