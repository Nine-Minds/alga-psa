import { createTenantKnex } from '@alga-psa/db';
import { getImageUrlInternalAsync } from './documentsHelpers';
import { withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

export type EntityType = 'user' | 'contact' | 'client' | 'tenant';

export async function getEntityImageUrl(
  entityType: EntityType,
  entityId: string,
  tenant: string
): Promise<string | null> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      let query = trx('document_associations')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant
        });

      query = query.andWhere('is_entity_logo', true);

      const association = await query.first();
      if (!association?.document_id) {
        return null;
      }

      const documentRecord = await trx('documents')
        .select('file_id', 'updated_at')
        .where({
          document_id: association.document_id,
          tenant
        })
        .first();

      if (!documentRecord?.file_id) {
        return null;
      }

      return { file_id: documentRecord.file_id, updated_at: documentRecord.updated_at };
    });

    if (!result || !result.file_id) {
      return null;
    }

    const imageUrl = await getImageUrlInternalAsync(result.file_id);

    if (imageUrl) {
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

export async function getUserAvatarUrl(userId: string, tenant: string): Promise<string | null> {
  return getEntityImageUrl('user', userId, tenant);
}

export async function getContactAvatarUrl(contactId: string, tenant: string): Promise<string | null> {
  return getEntityImageUrl('contact', contactId, tenant);
}

export async function getClientLogoUrl(clientId: string, tenant: string): Promise<string | null> {
  return getEntityImageUrl('client', clientId, tenant);
}

