import { createTenantKnex } from '../lib/db';
import { FileStore } from '../types/storage';

export class FileStoreModel {
    static async create(data: Omit<FileStore, 'tenant' | 'file_id' | 'created_at' | 'updated_at' | 'is_deleted' | 'deleted_at' | 'deleted_by_id'>): Promise<FileStore> {
        const { knex, tenant } = await createTenantKnex();
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

    static async findById(file_id: string): Promise<FileStore | null> {
        const { knex, tenant } = await createTenantKnex();
        const file = await knex('external_files')
            .where({ tenant, file_id, is_deleted: false })
            .first();
        return file || null;
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
}
