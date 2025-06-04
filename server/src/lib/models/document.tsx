import logger from '../../utils/logger';
import { IDocument } from '../../interfaces';
import { createTenantKnex } from '../db';
import { Knex } from 'knex';

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

    get: async (document_id: string, trx: Knex.Transaction): Promise<IDocument | undefined> => {
        try {
            return await trx<IDocument>('documents')
                    .select(
                        'documents.*',
                        'users.first_name as created_by_first_name',
                        'users.last_name as created_by_last_name',
                        trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
                        trx.raw("COALESCE(dt.type_name, sdt.type_name) as type_name"),
                        trx.raw("COALESCE(dt.icon, sdt.icon) as type_icon")
                    )
                    .leftJoin('users', function() {
                        this.on('documents.created_by', '=', 'users.user_id');
                    })
                    .leftJoin('document_types as dt', function() {
                        this.on('documents.type_id', '=', 'dt.type_id')
                            .andOn('documents.tenant', '=', 'dt.tenant');
                    })
                    .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
                    .where('documents.document_id', document_id)
                    .first();
        } catch (error) {
            logger.error(`Error getting document with id ${document_id}:`, error);
            throw error;
        }
    },

    insert: async (document: IDocument, trx: Knex.Transaction): Promise<Pick<IDocument, "document_id">> => {
        try {
            const { tenant: _, ...documentData } = document;
            const [document_id] = await trx<IDocument>('documents')
                .insert(documentData)
                .returning('document_id');
            return document_id;
        } catch (error) {
            logger.error('Error inserting document:', error);
            throw error;
        }
    },

    update: async (document_id: string, document: Partial<IDocument>, trx: Knex.Transaction): Promise<void> => {
        try {
            const { tenant: _, ...updateData } = document;
            await trx<IDocument>('documents')
                .where('document_id', document_id)
                .update(updateData);
        } catch (error) {
            logger.error(`Error updating document with id ${document_id}:`, error);
            throw error;
        }
    },

    delete: async (document_id: string, trx: Knex.Transaction): Promise<void> => {
        try {
            await trx<IDocument>('documents')
                .where('document_id', document_id)
                .del();
        } catch (error) {
            logger.error(`Error deleting document with id ${document_id}:`, error);
            throw error;
        }
    },

    getByTicketId: async (ticket_id: string, trx: Knex.Transaction): Promise<IDocument[]> => {
        try {
            return await trx<IDocument>('documents')
                    .select(
                        'documents.*',
                        'users.first_name',
                        'users.last_name',
                        trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                    )
                    .join('document_associations', function() {
                        this.on('documents.document_id', '=', 'document_associations.document_id')
                            .andOn('documents.tenant', '=', 'document_associations.tenant');
                    })
                    .leftJoin('users', function() {
                        this.on('documents.created_by', '=', 'users.user_id');
                    })
                    .where({
                        'document_associations.entity_id': ticket_id,
                        'document_associations.entity_type': 'ticket'
                    });
        } catch (error) {
            logger.error(`Error getting documents with ticket_id ${ticket_id}:`, error);
            throw error;
        }
    },

    getByCompanyId: async (company_id: string, trx: Knex.Transaction): Promise<IDocument[]> => {
        try {
            return await trx<IDocument>('documents')
                    .select(
                        'documents.*',
                        'users.first_name',
                        'users.last_name',
                        trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                    )
                    .join('document_associations', function() {
                        this.on('documents.document_id', '=', 'document_associations.document_id')
                            .andOn('documents.tenant', '=', 'document_associations.tenant');
                    })
                    .leftJoin('users', function() {
                        this.on('documents.created_by', '=', 'users.user_id');
                    })
                    .where({
                        'document_associations.entity_id': company_id,
                        'document_associations.entity_type': 'company'
                    });
        } catch (error) {
            logger.error(`Error getting documents with company_id ${company_id}:`, error);
            throw error;
        }
    },

    getByContactNameId: async (contact_name_id: string, trx: Knex.Transaction): Promise<IDocument[]> => {
        try {
            return await trx<IDocument>('documents')
                    .select(
                        'documents.*',
                        'users.first_name',
                        'users.last_name',
                        trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                    )
                    .join('document_associations', function() {
                        this.on('documents.document_id', '=', 'document_associations.document_id')
                            .andOn('documents.tenant', '=', 'document_associations.tenant');
                    })
                    .leftJoin('users', function() {
                        this.on('documents.created_by', '=', 'users.user_id');
                    })
                    .where({
                        'document_associations.entity_id': contact_name_id,
                        'document_associations.entity_type': 'contact'
                    });
        } catch (error) {
            logger.error(`Error getting documents with contact_name_id ${contact_name_id}:`, error);
            throw error;
        }
    }
};

export default Document;
