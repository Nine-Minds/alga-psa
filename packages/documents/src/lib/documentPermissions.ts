import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { checkMultiplePermissions } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { canAccessAttachmentTicket } from '@shared/lib/ticketCommentAttachments';
import { assertAuthorizedAssociationTarget } from '@shared/lib/documentAssociationTargetAuthorization';

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

export function getDocumentUploadTargets(target: DocumentUploadTarget): Array<{ entityType: string; entityId: string }> {
  const targets = [
    { entityType: 'ticket', entityId: target.ticketId },
    { entityType: 'client', entityId: target.clientId },
    { entityType: 'contact', entityId: target.contactNameId },
    { entityType: 'asset', entityId: target.assetId },
    { entityType: 'project_task', entityId: target.projectTaskId },
    { entityType: 'contract', entityId: target.contractId },
    { entityType: 'opportunity', entityId: target.opportunityId },
    { entityType: 'document', entityId: target.parentDocumentId },
  ];
  return targets.filter((target): target is { entityType: string; entityId: string } => Boolean(target.entityId));
}

export async function areDocumentUploadTargetsAuthorized(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  target: DocumentUploadTarget,
): Promise<boolean> {
  for (const { entityType, entityId } of getDocumentUploadTargets(target)) {
    if (!await assertAuthorizedAssociationTarget(trx, tenant, user, entityType, entityId, 'update')) return false;
  }
  return true;
}

export async function canUploadDocument(user: IUser, target: DocumentUploadTarget): Promise<boolean> {
  const grants = await ticketDocumentGrants(user, 'create');
  const { knex } = await createTenantKnex(user.tenant);
  const targets = getDocumentUploadTargets(target);
  if (!grants.general && (!grants.scoped || !target.ticketId ||
    targets.some(({ entityType }) => entityType !== 'ticket'))) return false;
  if (targets.length === 0) return grants.general;

  if (target.parentDocumentId && !grants.general) return false;
  return knex.transaction((trx) => areDocumentUploadTargetsAuthorized(trx, user.tenant, user, target));
}
