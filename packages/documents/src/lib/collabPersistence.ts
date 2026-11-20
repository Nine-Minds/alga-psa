import { createTenantKnex, runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { verifyDocumentRoomToken } from '@shared/lib/documentRoomToken';
import { isDocumentFieldRedacted } from '@shared/lib/documentAuthorization';
import { getAuthorizedDocumentById } from '../actions/documentActions';
import { CacheFactory } from '../cache/CacheFactory';

export interface PersistCollabResult {
  success: boolean;
  message?: string;
  permissionDenied?: boolean;
}

type RoomAuthorization = { allowed: true; user: IUser } | { allowed: false; message: string };

async function authorizeWriterInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  documentId: string,
  credential: string,
): Promise<RoomAuthorization> {
  let claims;
  try {
    claims = verifyDocumentRoomToken(credential);
  } catch {
    return { allowed: false, message: 'Permission denied: Invalid document room credential' };
  }
  if (claims.tenantId !== tenant || claims.documentId !== documentId) {
    return { allowed: false, message: 'Permission denied: Document room credential scope mismatch' };
  }

  const db = tenantDb(trx, tenant);
  const row = await db.table('users').where({ user_id: claims.userId }).first();
  if (!row || row.is_inactive) {
    return { allowed: false, message: 'Permission denied: Document writer is inactive or no longer exists' };
  }

  let clientId: string | undefined;
  if (row.contact_id) {
    const contact = await db.table('contacts').select('client_id').where({ contact_name_id: row.contact_id }).first();
    clientId = contact?.client_id ?? undefined;
  }
  const user = { ...row, tenant, clientId } as IUser;
  if (!await hasPermission(user, 'document', 'read', trx) || !await hasPermission(user, 'document', 'update', trx)) {
    return { allowed: false, message: 'Permission denied: Cannot update documents' };
  }

  const authorizedDocument = await getAuthorizedDocumentById(trx, tenant, user, documentId);
  if (!authorizedDocument) {
    return { allowed: false, message: 'Permission denied: Cannot update documents' };
  }
  if (isDocumentFieldRedacted(authorizedDocument, 'content')) {
    return { allowed: false, message: 'Permission denied: Cannot update redacted document content' };
  }
  return { allowed: true, user };
}

/** Current authorization check used when admitting or revalidating a room writer. */
export async function authorizeCollabWriter(
  tenant: string,
  documentId: string,
  credential: string,
): Promise<{ allowed: boolean; message?: string }> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async trx => {
      const result = await authorizeWriterInTransaction(trx, tenant, documentId, credential);
      return result.allowed ? { allowed: true } : { allowed: false, message: result.message };
    });
  });
}

/** Reauthorizes and persists a room snapshot atomically. */
export async function persistCollabSnapshot(
  tenant: string,
  documentId: string,
  json: unknown,
  credential: string,
): Promise<PersistCollabResult> {
  const result = await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async trx => {
      const authorization = await authorizeWriterInTransaction(trx, tenant, documentId, credential);
      if (!authorization.allowed) {
        return { success: false, permissionDenied: true, message: authorization.message };
      }

      const scoped = tenantDb(trx, tenant);
      const existing = await scoped.table('document_block_content').where({ document_id: documentId }).first();
      if (!existing) return { success: false, message: 'Document content not found.' };

      const [updated] = await scoped.table('document_block_content')
        .where({ document_id: documentId })
        .update({ block_data: JSON.stringify(json), updated_at: trx.fn.now() })
        .returning(['content_id']);
      await scoped.table('documents').where({ document_id: documentId }).update({
        updated_at: trx.fn.now(), edited_by: authorization.user.user_id,
      });
      return updated ? { success: true } : { success: false, message: 'Document content not found.' };
    });
  });

  if (!result.success) return result;
  const cache = CacheFactory.getPreviewCache(tenant);
  await cache.delete(documentId);
  return result;
}
