import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { requireTenantId } from '@alga-psa/db';
import type { FileStore } from '../types/storage';

export class FileStoreModel {
  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    data: Omit<
      FileStore,
      'tenant' | 'file_id' | 'created_at' | 'updated_at' | 'is_deleted' | 'deleted_at' | 'deleted_by_id'
    >
  ): Promise<FileStore> {
    const tenant = await requireTenantId(knexOrTrx);
    const file_id = data.fileId || uuidv4();

    const [file] = await knexOrTrx<FileStore>('external_files')
      .insert({
        file_id,
        file_name: data.file_name,
        original_name: data.original_name,
        mime_type: data.mime_type,
        file_size: data.file_size,
        storage_path: data.storage_path,
        uploaded_by_id: data.uploaded_by_id,
        metadata: data.metadata,
        tenant,
      })
      .returning('*');

    return file;
  }

  static async updateMetadata(
    knexOrTrx: Knex | Knex.Transaction,
    fileId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const tenant = await requireTenantId(knexOrTrx);

    await knexOrTrx('external_files').where({ file_id: fileId, tenant }).update({ metadata });
  }

  static async findById(knexOrTrx: Knex | Knex.Transaction, file_id: string): Promise<FileStore | null> {
    const tenant = await requireTenantId(knexOrTrx);

    const file = await knexOrTrx<FileStore>('external_files').where({ tenant, file_id, is_deleted: false }).first();

    return file || null;
  }

  static async softDelete(
    knexOrTrx: Knex | Knex.Transaction,
    file_id: string,
    deleted_by_id: string
  ): Promise<FileStore> {
    const tenant = await requireTenantId(knexOrTrx);

    const [file] = await knexOrTrx<FileStore>('external_files')
      .where({ tenant, file_id })
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by_id,
      })
      .returning('*');

    return file;
  }

  static async list(knexOrTrx: Knex | Knex.Transaction): Promise<FileStore[]> {
    const tenant = await requireTenantId(knexOrTrx);
    return await knexOrTrx<FileStore>('external_files').where({ tenant, is_deleted: false });
  }

  static async createDocumentSystemEntry(
    knexOrTrx: Knex | Knex.Transaction,
    options: {
      fileId: string;
      category: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    const tenant = await requireTenantId(knexOrTrx);
    await knexOrTrx('document_system_entries').insert({
      tenant,
      file_id: options.fileId,
      category: options.category,
      metadata: options.metadata,
      created_at: new Date().toISOString(),
    });
  }
}

