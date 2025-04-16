import { createTenantKnex } from 'server/src/lib/db';
import { getImageUrl } from 'server/src/lib/actions/document-actions/documentActions';

/**
 * Entity types that can have associated images
 */
export type EntityType = 'user' | 'contact' | 'company';

/**
 * Retrieves the image URL for an entity (user avatar, contact avatar, company logo).
 *
 * @param entityType The type of entity ('user', 'contact', or 'company')
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
    
    // Find the document association for the entity
    const association = await knex('document_associations')
      .where({
        entity_id: entityId,
        entity_type: entityType,
        tenant
      })
      .first();
    
    // If no association found, return null
    if (!association?.document_id) {
      return null;
    }
    
    // Get the file_id from the documents table
    const documentRecord = await knex('documents')
      .select('file_id')
      .where({
        document_id: association.document_id,
        tenant
      })
      .first();
    
    // If no document record or no file_id, return null
    if (!documentRecord?.file_id) {
      return null;
    }
    
    // Use the existing getImageUrl function to get the URL
    return await getImageUrl(documentRecord.file_id);
  } catch (error) {
    console.error(`Error retrieving image URL for ${entityType} ${entityId}:`, error);
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
 * Convenience function to get a company's logo URL
 */
export async function getCompanyLogoUrl(
  companyId: string,
  tenant: string
): Promise<string | null> {
  return getEntityImageUrl('company', companyId, tenant);
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
 * const companyLogoUrl = await getCompanyLogoUrl(companyId, tenant);
 *
 * // Then use the URL in a component:
 * <UserAvatar
 *   userId={userId}
 *   userName={userName}
 *   avatarUrl={userAvatarUrl}
 * />
 */