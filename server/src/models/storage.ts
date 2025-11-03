import { BaseModel } from './BaseModel';
import { FileStore } from '../types/storage';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export class FileStoreModel extends BaseModel {
  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    data: Omit<FileStore, 'tenant' | 'file_id' | 'created_at' | 'updated_at' | 'is_deleted' | 'deleted_at' | 'deleted_by_id'>
  ): Promise<FileStore> {
    const tenant = await this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const newFileId = uuidv4();
    
    const [file] = await knexOrTrx('external_files')
      .insert({
        file_id: newFileId,
        file_name: data.file_name,
        original_name: data.original_name,
        mime_type: data.mime_type,
        file_size: data.file_size,
        storage_path: data.storage_path,
        uploaded_by_id: data.uploaded_by_id,
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
    const tenant = await this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    
    await knexOrTrx('external_files')
      .where({ file_id: fileId, tenant })
      .update({ metadata });
  }

  static async findById(
    knexOrTrx: Knex | Knex.Transaction,
    file_id: string
  ): Promise<FileStore | null> {
    const tenant = await this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    const file = await knexOrTrx('external_files')
      .where({ tenant, file_id, is_deleted: false })
      .first();

    return file || null;
  }

  static async softDelete(
    knexOrTrx: Knex | Knex.Transaction,
    file_id: string,
    deleted_by_id: string
  ): Promise<FileStore> {
    const tenant = await this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    
    const [file] = await knexOrTrx('external_files')
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
    const tenant = await this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    
    return await knexOrTrx('external_files').where({ tenant, is_deleted: false });
  }

  static async createDocumentSystemEntry(
    knexOrTrx: Knex | Knex.Transaction,
    options: {
      fileId: string;
      category: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    const tenant = await this.getTenant();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    await knexOrTrx('document_system_entries').insert({
      tenant,
      file_id: options.fileId,
      category: options.category,
      metadata: options.metadata,
      created_at: new Date().toISOString()
    });
  }
}
