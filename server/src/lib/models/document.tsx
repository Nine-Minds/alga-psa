import logger from '../../utils/logger';
import { IDocument } from '../../interfaces';
import { createTenantKnex } from '../db';

const Document = {
    getAll: async (): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting documents');
            }

            return await db<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name',
                    'users.last_name',
                    db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                )
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', db.raw('?', [tenant]));
                })
                .where({ 'documents.tenant': tenant });
        } catch (error) {
            logger.error('Error getting all documents:', error);
            throw error;
        }
    },

    get: async (document_id: string): Promise<IDocument | undefined> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting document');
            }

            return await db<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name as created_by_first_name',
                    'users.last_name as created_by_last_name',
                    db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
                    db.raw("COALESCE(dt.type_name, sdt.type_name) as type_name"),
                    db.raw("COALESCE(dt.icon, sdt.icon) as type_icon")
                )
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', db.raw('?', [tenant]));
                })
                .leftJoin('document_types as dt', function() {
                    this.on('documents.type_id', '=', 'dt.type_id')
                        .andOn('documents.tenant', '=', 'dt.tenant');
                })
                .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
                .where({
                    'documents.document_id': document_id,
                    'documents.tenant': tenant
                })
                .first();
        } catch (error) {
            logger.error(`Error getting document with id ${document_id}:`, error);
            throw error;
        }
    },

    insert: async (document: IDocument): Promise<Pick<IDocument, "document_id">> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for inserting document');
            }

            const { tenant: _, ...documentData } = document;
            const [document_id] = await db<IDocument>('documents')
                .insert({
                    ...documentData,
                    tenant
                })
                .returning('document_id');
            return document_id;
        } catch (error) {
            logger.error('Error inserting document:', error);
            throw error;
        }
    },

    update: async (document_id: string, document: Partial<IDocument>): Promise<void> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for updating document');
            }

            const { tenant: _, ...updateData } = document;
            await db<IDocument>('documents')
                .where({
                    document_id,
                    tenant
                })
                .update(updateData);
        } catch (error) {
            logger.error(`Error updating document with id ${document_id}:`, error);
            throw error;
        }
    },

    delete: async (document_id: string): Promise<void> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for deleting document');
            }

            await db<IDocument>('documents')
                .where({
                    document_id,
                    tenant
                })
                .del();
        } catch (error) {
            logger.error(`Error deleting document with id ${document_id}:`, error);
            throw error;
        }
    },

    getByTicketId: async (ticket_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting documents by ticket');
            }

            return await db<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name',
                    'users.last_name',
                    db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                )
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', db.raw('?', [tenant]));
                })
                .where({
                    'documents.tenant': tenant,
                    'document_associations.entity_id': ticket_id,
                    'document_associations.entity_type': 'ticket'
                });
        } catch (error) {
            logger.error(`Error getting documents with ticket_id ${ticket_id}:`, error);
            throw error;
        }
    },

    getByCompanyId: async (company_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting documents by company');
            }

            return await db<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name',
                    'users.last_name',
                    db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                )
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', db.raw('?', [tenant]));
                })
                .where({
                    'documents.tenant': tenant,
                    'document_associations.entity_id': company_id,
                    'document_associations.entity_type': 'company'
                });
        } catch (error) {
            logger.error(`Error getting documents with company_id ${company_id}:`, error);
            throw error;
        }
    },

    getByContactNameId: async (contact_name_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting documents by contact');
            }

            return await db<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name',
                    'users.last_name',
                    db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                )
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', db.raw('?', [tenant]));
                })
                .where({
                    'documents.tenant': tenant,
                    'document_associations.entity_id': contact_name_id,
                    'document_associations.entity_type': 'contact'
                });
        } catch (error) {
            logger.error(`Error getting documents with contact_name_id ${contact_name_id}:`, error);
            throw error;
        }
    },

    getByScheduleId: async (schedule_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting documents by schedule');
            }

            return await db<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name',
                    'users.last_name',
                    db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                )
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', db.raw('?', [tenant]));
                })
                .where({
                    'documents.tenant': tenant,
                    'document_associations.entity_id': schedule_id,
                    'document_associations.entity_type': 'schedule'
                });
        } catch (error) {
            logger.error(`Error getting documents with schedule_id ${schedule_id}:`, error);
            throw error;
        }
    }
};

export default Document;
