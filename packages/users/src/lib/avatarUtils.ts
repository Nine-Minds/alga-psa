import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

type EntityType = 'user' | 'contact' | 'client' | 'tenant';

async function getImageUrlInternalLite(
  trx: Knex.Transaction,
  tenant: string,
  fileId: string,
): Promise<string | null> {
  const fileDetails = await trx('external_files')
    .select('mime_type')
    .where({ file_id: fileId, tenant })
    .first();

  if (!fileDetails?.mime_type?.startsWith('image/')) {
    return null;
  }

  return `/api/documents/view/${fileId}`;
}

export async function getEntityImageUrl(
  entityType: EntityType,
  entityId: string,
  tenant: string,
): Promise<string | null> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const association = await trx('document_associations')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant,
          is_entity_logo: true,
        })
        .first();

      if (!association?.document_id) {
        return null;
      }

      const documentRecord = await trx('documents')
        .select('file_id', 'updated_at')
        .where({
          document_id: association.document_id,
          tenant,
        })
        .first();

      if (!documentRecord?.file_id) {
        return null;
      }

      return { file_id: documentRecord.file_id as string, updated_at: documentRecord.updated_at as Date | null };
    });

    if (!result?.file_id) {
      return null;
    }

    const imageUrl = await withTransaction(knex, async (trx: Knex.Transaction) =>
      getImageUrlInternalLite(trx, tenant, result.file_id),
    );

    if (!imageUrl) {
      return null;
    }

    const timestamp = result.updated_at ? new Date(result.updated_at).getTime() : 0;
    return `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
  } catch {
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
  tenant: string,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  entityIds.forEach((id) => result.set(id, null));

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
        tenant,
      });

    if (associations.length === 0) {
      return result;
    }

    const documentIds = associations.map((a: any) => a.document_id);
    const documents = await knex('documents')
      .select('document_id', 'file_id', 'updated_at')
      .whereIn('document_id', documentIds)
      .andWhere({ tenant });

    const docToInfo = new Map(
      documents.map((d: any) => [
        d.document_id,
        { file_id: d.file_id as string | null, updated_at: d.updated_at as Date | null },
      ]),
    );

    const fileIds = documents.map((d: any) => d.file_id).filter(Boolean);
    const imageFileIds = new Set<string>();
    if (fileIds.length > 0) {
      const files = await knex('external_files')
        .select('file_id', 'mime_type')
        .whereIn('file_id', fileIds)
        .andWhere({ tenant });
      for (const file of files) {
        if (file?.mime_type?.startsWith('image/')) {
          imageFileIds.add(file.file_id);
        }
      }
    }

    for (const association of associations) {
      const docInfo = docToInfo.get(association.document_id);
      const fileId = docInfo?.file_id;
      if (!fileId || !imageFileIds.has(fileId)) {
        continue;
      }
      const baseUrl = `/api/documents/view/${fileId}`;
      const timestamp = docInfo?.updated_at ? new Date(docInfo.updated_at).getTime() : 0;
      result.set(association.entity_id, `${baseUrl}?t=${timestamp}`);
    }

    return result;
  } catch {
    return result;
  }
}
