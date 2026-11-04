import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { checkMultiplePermissions } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { canAccessAttachmentTicket } from '@shared/lib/ticketCommentAttachments';

/** Byte-serving routes already load a document before authorization. Embed the
 * customer product restriction in that existing read instead of adding a
 * product/RBAC round trip to every native PSA file request. The ordinary
 * document relationship/redaction policy still runs on the result. */
export function applyDocumentProductReadScope(query: Knex.QueryBuilder, conn: Knex | Knex.Transaction, user: IUser): void {
  const db = tenantDb(conn, user.tenant);
  const grants = (resource: string) => {
    const permissions = db.table('permissions as p').select('p.permission_id')
      .where({ 'p.resource': resource, 'p.action': 'read', [user.user_type === 'client' ? 'p.client' : 'p.msp']: true });
    db.tenantJoin(permissions, 'role_permissions as rp', 'rp.permission_id', 'p.permission_id');
    db.tenantJoin(permissions, 'user_roles as ur', 'ur.role_id', 'rp.role_id');
    db.tenantJoin(permissions, 'roles as r', 'r.role_id', 'ur.role_id');
    return permissions.where({ 'ur.user_id': user.user_id, [user.user_type === 'client' ? 'r.client' : 'r.msp']: true });
  };
  const associations = db.table('document_associations as da').select('da.document_id')
    .where('da.entity_type', 'ticket').where('da.document_id', conn.ref('documents.document_id'));
  db.tenantJoin(associations, 'tickets as t', 't.ticket_id', 'da.entity_id');
  const drafts = db.table('ticket_comment_attachments as a').select('a.document_id')
    .where({ 'a.created_by': user.user_id, 'a.state': 'draft' }).where('a.document_id', conn.ref('documents.document_id'));
  db.tenantJoin(drafts, 'tickets as t', 't.ticket_id', 'a.ticket_id');
  query.andWhere(function () {
    this.whereNotExists(db.table('tenants').select('tenant').where('product_code', 'co_managed'))
      .orWhereExists(grants('document'))
      .orWhere(function () {
        this.whereExists(grants('ticket_attachment')).whereExists(grants('ticket'))
          .andWhere(function () { this.whereExists(associations).orWhereExists(drafts); });
      });
  });
}

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
  return canAccessAttachmentTicket(knex, user.tenant, user.user_id, target.ticketId);
}
