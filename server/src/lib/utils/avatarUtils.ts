import { createTenantKnex } from 'server/src/lib/db';
import { getImageUrlInternal } from 'server/src/lib/actions/document-actions/documentActions';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';

/**
 * Entity types that can have associated images
 */
export type EntityType = 'user' | 'contact' | 'client' | 'tenant';

/**
 * Retrieves the image URL for an entity (user avatar, contact avatar, client logo).
 *
 * @param entityType The type of entity ('user', 'contact', or 'client')
 * @param entityId The ID of the entity
 * @param tenant The tenant context
 * @returns A promise resolving to the image URL string, or null if no image is found
 */
export async function getEntityImageUrl(
  entityType: EntityType,
  entityId: string,
  tenant: string
): Promise<string | null> {
  try {
    const { knex } = await createTenantKnex();

    // Wrap database queries in a transaction for consistency
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Query for document association
      let query = trx('document_associations')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant
        });

      query = query.andWhere('is_entity_logo', true);

      const association = await query.first();
      
      // If no association found, return null (this is expected - many entities don't have logos)
      if (!association?.document_id) {
        return null;
      }
      
      // Get the file_id and updated_at from the documents table within the same transaction
      const documentRecord = await trx('documents')
        .select('file_id', 'updated_at')
        .where({
          document_id: association.document_id,
          tenant
        })
        .first();
      
      // If no document record or no file_id, return null (document may have been deleted)
      if (!documentRecord?.file_id) {
        return null;
      }

      return { file_id: documentRecord.file_id, updated_at: documentRecord.updated_at };
    });

    // If no result was found, return null
    if (!result || !result.file_id) {
      return null;
    }

    // Use the existing getImageUrl function to get the URL
    // This function manages its own transaction internally
    const imageUrl = await getImageUrlInternal(result.file_id);
    
    if (imageUrl) {
      // Add the document's updated_at timestamp for cache busting
      // This ensures the URL changes only when the document is actually updated
      const timestamp = result.updated_at ? new Date(result.updated_at).getTime() : 0;
      return `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
    }

    return null;
  } catch (error) {
    console.error(`[AvatarUtils] Failed to retrieve image URL for ${entityType} (ID: ${entityId}):`, {
      operation: 'getEntityImageUrl',
      entityType,
      entityId,
      tenant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    return null;
  }
}

/**
 * Convenience function to get a user's avatar URL
 */
export async function getUserAvatarUrl(
  userId: string,
  tenant: string
): Promise<string | null> {
  return getEntityImageUrl('user', userId, tenant);
}

/**
 * Convenience function to get a contact's avatar URL
 */
export async function getContactAvatarUrl(
  contactId: string,
  tenant: string
): Promise<string | null> {
  return getEntityImageUrl('contact', contactId, tenant);
}

/**
 * Convenience function to get a client's logo URL
 */
export async function getClientLogoUrl(
  clientId: string,
  tenant: string
): Promise<string | null> {
  return getEntityImageUrl('client', clientId, tenant);
}

/**
 * Batch function to get image URLs for multiple entities at once.
 * This is more efficient than calling getEntityImageUrl multiple times in a loop.
 *
 * @param entityType The type of entity ('user', 'contact', or 'client')
 * @param entityIds Array of entity IDs
 * @param tenant The tenant context
 * @returns A promise resolving to a Map of entityId -> imageUrl (or null)
 */
export async function getEntityImageUrlsBatch(
  entityType: EntityType,
  entityIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  
  // Initialize all IDs with null
  entityIds.forEach(id => result.set(id, null));
  
  if (entityIds.length === 0) {
    return result;
  }

  try {
    const { knex } = await createTenantKnex();

    // Get all associations in one query
    const associations = await knex('document_associations')
      .select('entity_id', 'document_id')
      .whereIn('entity_id', entityIds)
      .andWhere({
        entity_type: entityType,
        is_entity_logo: true,
        tenant
      });

    if (associations.length === 0) {
      return result;
    }

    // Get all documents in one query, including updated_at for cache busting
    const documentIds = associations.map(a => a.document_id);
    const documents = await knex('documents')
      .select('document_id', 'file_id', 'updated_at')
      .whereIn('document_id', documentIds)
      .andWhere({ tenant });

    // Create maps for quick lookup
    const docToFileMap = new Map(documents.map(d => [d.document_id, { file_id: d.file_id, updated_at: d.updated_at }]));
    const entityToDocMap = new Map(associations.map(a => [a.entity_id, a.document_id]));

    // Process each entity
    for (const [entityId, documentId] of entityToDocMap) {
      const docInfo = docToFileMap.get(documentId);
      if (docInfo?.file_id) {
        try {
          const imageUrl = await getImageUrlInternal(docInfo.file_id);
          if (imageUrl) {
            // Add the document's updated_at timestamp for cache busting
            const timestamp = docInfo.updated_at ? new Date(docInfo.updated_at).getTime() : 0;
            const urlWithTimestamp = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
            result.set(entityId, urlWithTimestamp);
          }
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error(`[getEntityImageUrlsBatch] Failed to get image URL for ${entityType} ${entityId}:`, error);
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`[getEntityImageUrlsBatch] Failed to retrieve image URLs for ${entityType}:`, {
      operation: 'getEntityImageUrlsBatch',
      entityType,
      entityCount: entityIds.length,
      tenant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
    return result;
  }
}

/**
 * Convenience function to get multiple client logo URLs at once
 */
export async function getClientLogoUrlsBatch(
  clientIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('client', clientIds, tenant);
}

/**
 * Convenience function to get multiple contact avatar URLs at once
 */
export async function getContactAvatarUrlsBatch(
  contactIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('contact', contactIds, tenant);
}

/**
 * Example usage:
 *
 * // Using the general function:
 * const avatarUrl = await getEntityImageUrl('user', userId, tenant);
 *
 * // Or using the convenience functions:
 * const userAvatarUrl = await getUserAvatarUrl(userId, tenant);
 * const contactAvatarUrl = await getContactAvatarUrl(contactId, tenant);
 * const clientLogoUrl = await getClientLogoUrl(clientId, tenant);
 *
 * // Batch loading:
 * const clientIds = ['id1', 'id2', 'id3'];
 * const logoUrls = await getClientLogoUrlsBatch(clientIds, tenant);
 * const logoUrl1 = logoUrls.get('id1'); // string | null
 *
 * // Then use the URL in a component:
 * <UserAvatar
 *   userId={userId}
 *   userName={userName}
 *   avatarUrl={userAvatarUrl}
 * />
 */
