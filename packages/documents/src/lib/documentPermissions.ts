import type { IUser } from '@alga-psa/types';
import { checkMultiplePermissions } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { canAccessAttachmentTicket, canWriteAttachmentTicket } from '@shared/lib/ticketCommentAttachments';

export { applyDocumentProductReadScope } from '@shared/lib/documentProductReadScope';

async function ticketDocumentGrants(user: IUser, action: 'read' | 'create') {
  const permissions = await checkMultiplePermissions(user, [
    { resource: 'document', action },
    { resource: 'ticket_attachment', action },
    { resource: 'ticket', action: action === 'read' ? 'read' : 'update' },
  ]);
  return { general: permissions[0].granted, scoped: permissions[1].granted && permissions[2].granted };
}

export async function canReadTicketDocuments(user: IUser, ticketId: string): Promise<boolean> {
  const grants = await ticketDocumentGrants(user, 'read');
  if (grants.general) return true;
  if (!grants.scoped) return false;
  const { knex } = await createTenantKnex(user.tenant);
  return canAccessAttachmentTicket(knex, user.tenant, user.user_id, ticketId);
}

export async function canReadDocument(user: IUser, identifier: string): Promise<boolean> {
  const grants = await ticketDocumentGrants(user, 'read');
  if (grants.general) return true;
  if (!grants.scoped) return false;
  const { knex } = await createTenantKnex(user.tenant);
  const db = tenantDb(knex, user.tenant);
  const document = await db.table('documents').where(builder => {
    builder.where('document_id', identifier).orWhere('file_id', identifier);
  }).first('document_id');
  if (!document) return false;
  const associations = await db.table('document_associations')
    .where({ document_id: document.document_id, entity_type: 'ticket' }).select('entity_id');
  for (const association of associations) {
    if (await canAccessAttachmentTicket(knex, user.tenant, user.user_id, association.entity_id)) return true;
  }
  // A draft has not acquired a public association yet. Its existing visibility
  // and ownership checks still run in authorizeAndRedactDocuments afterward.
  const draft = await db.table('ticket_comment_attachments')
    .where({ document_id: document.document_id, created_by: user.user_id, state: 'draft' }).first('ticket_id');
  return Boolean(draft && await canAccessAttachmentTicket(knex, user.tenant, user.user_id, draft.ticket_id));
}

export interface DocumentUploadTarget {
  ticketId?: string;
  clientId?: string;
  contactNameId?: string;
  assetId?: string;
  projectTaskId?: string;
  contractId?: string;
  opportunityId?: string;
  parentDocumentId?: string;
}

export async function canUploadDocument(user: IUser, target: DocumentUploadTarget): Promise<boolean> {
  const grants = await ticketDocumentGrants(user, 'create');
  if (grants.general) return true;
  if (!grants.scoped || !target.ticketId || target.clientId || target.contactNameId || target.assetId ||
      target.projectTaskId || target.contractId || target.opportunityId || target.parentDocumentId) return false;
  const { knex } = await createTenantKnex(user.tenant);
  return canWriteAttachmentTicket(knex, user.tenant, user.user_id, target.ticketId);
}
