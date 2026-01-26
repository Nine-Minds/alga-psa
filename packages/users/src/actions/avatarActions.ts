'use server';

import { getUserAvatarUrl, getContactAvatarUrl, getClientLogoUrl, getEntityImageUrlsBatch } from '../lib/avatarUtils';
import { linkExistingDocumentAsEntityImage, EntityType } from '@alga-psa/media';
import { withAuth } from '@alga-psa/auth';

export async function getUserAvatarUrlAction(userId: string, tenant: string): Promise<string | null> {
  return getUserAvatarUrl(userId, tenant);
}

export async function getContactAvatarUrlAction(contactId: string, tenant: string): Promise<string | null> {
  return getContactAvatarUrl(contactId, tenant);
}

export async function getClientLogoUrlAction(clientId: string, tenant: string): Promise<string | null> {
  return getClientLogoUrl(clientId, tenant);
}

export async function getUserAvatarUrlsBatchAction(userIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('user', userIds, tenant);
}

export async function getContactAvatarUrlsBatchAction(contactIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('contact', contactIds, tenant);
}

/**
 * Server action to link an existing document as an entity's avatar/logo
 *
 * @param entityType - Type of entity ('user', 'contact', 'client', 'tenant')
 * @param entityId - ID of the entity
 * @param documentId - ID of the existing document to link
 * @returns Result with success status and image URL
 */
export const linkDocumentAsAvatarAction = withAuth(async (
  user,
  { tenant },
  entityType: EntityType,
  entityId: string,
  documentId: string
): Promise<{ success: boolean; message?: string; imageUrl?: string | null }> => {
  try {
    const result = await linkExistingDocumentAsEntityImage(
      entityType,
      entityId,
      documentId,
      user.user_id,
      tenant
    );

    return result;
  } catch (error) {
    console.error('[linkDocumentAsAvatarAction] Error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to link document'
    };
  }
});
