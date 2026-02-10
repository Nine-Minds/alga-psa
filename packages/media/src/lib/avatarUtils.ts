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

export async function getEntityImageUrlsBatch(
  entityType: EntityType,
  entityIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();

  entityIds.forEach(id => result.set(id, null));

  if (entityIds.length === 0) {
    return result;
  }

  try {
    const { knex } = await createTenantKnex(tenant);

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

    const documentIds = associations.map(a => a.document_id);
    const documents = await knex('documents')
      .select('document_id', 'file_id', 'updated_at')
      .whereIn('document_id', documentIds)
      .andWhere({ tenant });

    const docToFileMap = new Map(documents.map(d => [d.document_id, { file_id: d.file_id, updated_at: d.updated_at }]));
    const entityToDocMap = new Map(associations.map(a => [a.entity_id, a.document_id]));

    for (const [entityId, documentId] of entityToDocMap) {
      const docInfo = docToFileMap.get(documentId);
      if (docInfo?.file_id) {
        try {
          const imageUrl = await getImageUrlInternalAsync(docInfo.file_id);
          if (imageUrl) {
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

export async function getClientLogoUrlsBatch(
  clientIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('client', clientIds, tenant);
}

export async function getContactAvatarUrlsBatch(
  contactIds: string[],
  tenant: string
): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('contact', contactIds, tenant);
}

