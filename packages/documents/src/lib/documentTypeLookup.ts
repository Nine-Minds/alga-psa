import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Finds the document type for a MIME type: a tenant type, then a shared type, each by exact name
 * and then by its general `type/*` name, and finally the shared `application/octet-stream` type.
 * No permission check: callers authorize first (`getDocumentTypeId` for actions, the upload
 * routes through their own authentication).
 */
export async function resolveDocumentTypeForMime(
  conn: Knex | Knex.Transaction,
  tenant: string,
  mimeType: string,
): Promise<{ typeId: string; isShared: boolean }> {
  const scopedDb = tenantDb(conn, tenant);

  // First try to find a tenant-specific type
  const tenantType = await scopedDb.table('document_types')
    .where({ type_name: mimeType })
    .first();

  if (tenantType) {
    return { typeId: tenantType.type_id, isShared: false };
  }

  // Then try to find a shared type
  const sharedType = await scopedDb.table('shared_document_types')
    .where({ type_name: mimeType })
    .first();

  if (sharedType) {
    return { typeId: sharedType.type_id, isShared: true };
  }

  // If no exact match, try to find a match for the general type (e.g., "image/*" for "image/png")
  const generalType = mimeType.split('/')[0] + '/*';

  // Check tenant-specific general type first
  const generalTenantType = await scopedDb.table('document_types')
    .where({ type_name: generalType })
    .first();

  if (generalTenantType) {
    return { typeId: generalTenantType.type_id, isShared: false };
  }

  // Then check shared general type
  const generalSharedType = await scopedDb.table('shared_document_types')
    .where({ type_name: generalType })
    .first();

  if (generalSharedType) {
    return { typeId: generalSharedType.type_id, isShared: true };
  }

  // If no match found, return the unknown type (application/octet-stream) from shared types
  const unknownType = await scopedDb.table('shared_document_types')
    .where({ type_name: 'application/octet-stream' })
    .first();

  if (!unknownType) {
    throw new Error('Unknown document type not found in shared document types');
  }

  return { typeId: unknownType.type_id, isShared: true };
}
