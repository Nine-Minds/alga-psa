import { createTenantKnex } from '../lib/db';
import { BaseModel } from './BaseModel';
import { FileStore } from '../types/storage';
import type { Knex } from 'knex';

export class FileStoreModel extends BaseModel {
  static async getKnex(): Promise<Knex> {
    return super.getKnex();
  }

    static async create(data: Omit<FileStore, 'tenant' | 'file_id' | 'created_at' | 'updated_at' | 'is_deleted' | 'deleted_at' | 'deleted_by_id'>): Promise<FileStore> {
      const knex = await this.getKnex();
      const { tenant } = await createTenantKnex();
      const [file] = await knex('external_files')
        .insert({
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
  
  
  
    static async updateMetadata(fileId: string, metadata: Record<string, unknown>): Promise<void> {
      const knex = await this.getKnex();
      const { tenant } = await createTenantKnex();
      await knex('external_files')
        .where({ file_id: fileId, tenant })
        .update({ metadata });
    }

    static async findById(file_id: string): Promise<FileStore> {
        const { knex, tenant } = await createTenantKnex();
        const file = await knex('external_files')
            .where({ tenant, file_id, is_deleted: false })
            .first();
        
        if (!file) {
            throw new Error('File not found');
        }
        return file;
    }

    static async softDelete(file_id: string, deleted_by_id: string): Promise<FileStore> {
        const { knex, tenant } = await createTenantKnex();
        const [file] = await knex('external_files')
            .where({ tenant, file_id })
            .update({
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                deleted_by_id,
            })
            .returning('*');
        return file;
    }

    static async list(): Promise<FileStore[]> {
        const { knex, tenant } = await createTenantKnex();
        return knex('external_files').where({ tenant, is_deleted: false });
    }
  
    static async createDocumentSystemEntry(options: {
      fileId: string;
      category: string;
      metadata: Record<string, unknown>;
    }): Promise<void> {
      const knex = await this.getKnex();
      await knex('document_system_entries').insert({
        file_id: options.fileId,
        category: options.category,
        metadata: options.metadata,
        created_at: new Date().toISOString()
      });
    }
  }
