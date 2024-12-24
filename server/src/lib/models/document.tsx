import logger from '../../utils/logger';
import { IDocument } from '../../interfaces';
import { createTenantKnex } from '../db';

const Document = {
    getAll: async (): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            return await db<IDocument>('documents')
                .select('*')
                .whereRaw('tenant = ?', [tenant]);
        } catch (error) {
            logger.error('Error getting all documents:', error);
            throw error;
        }
    },

    get: async (document_id: string): Promise<IDocument | undefined> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            return await db<IDocument>('documents')
                .select('*')
                .whereRaw('document_id = ? AND tenant = ?', [document_id, tenant])
                .first();
        } catch (error) {
            logger.error(`Error getting document with id ${document_id}:`, error);
            throw error;
        }
    },

    insert: async (document: IDocument): Promise<Pick<IDocument, "document_id">> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            const [document_id] = await db<IDocument>('documents')
                .insert(document)
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
            await db<IDocument>('documents')
                .whereRaw('document_id = ? AND tenant = ?', [document_id, tenant])
                .update(document);
        } catch (error) {
            logger.error(`Error updating document with id ${document_id}:`, error);
            throw error;
        }
    },

    delete: async (document_id: string): Promise<void> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            await db<IDocument>('documents')
                .whereRaw('document_id = ? AND tenant = ?', [document_id, tenant])
                .del();
        } catch (error) {
            logger.error(`Error deleting document with id ${document_id}:`, error);
            throw error;
        }
    },

    getByTicketId: async (ticket_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            return await db<IDocument>('documents')
                .select('documents.*')
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .whereRaw(`
                    documents.tenant = ? AND
                    document_associations.entity_id = ? AND
                    document_associations.entity_type = ?
                `, [tenant, ticket_id, 'ticket']);
        } catch (error) {
            logger.error(`Error getting documents with ticket_id ${ticket_id}:`, error);
            throw error;
        }
    },

    getByCompanyId: async (company_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            return await db<IDocument>('documents')
                .select('documents.*')
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .whereRaw(`
                    documents.tenant = ? AND
                    document_associations.entity_id = ? AND
                    document_associations.entity_type = ?
                `, [tenant, company_id, 'company']);
        } catch (error) {
            logger.error(`Error getting documents with company_id ${company_id}:`, error);
            throw error;
        }
    },

    getByContactNameId: async (contact_name_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            return await db<IDocument>('documents')
                .select('documents.*')
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .whereRaw(`
                    documents.tenant = ? AND
                    document_associations.entity_id = ? AND
                    document_associations.entity_type = ?
                `, [tenant, contact_name_id, 'contact']);
        } catch (error) {
            logger.error(`Error getting documents with contact_name_id ${contact_name_id}:`, error);
            throw error;
        }
    },

    getByScheduleId: async (schedule_id: string): Promise<IDocument[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            return await db<IDocument>('documents')
                .select('documents.*')
                .join('document_associations', function() {
                    this.on('documents.document_id', '=', 'document_associations.document_id')
                        .andOn('documents.tenant', '=', 'document_associations.tenant');
                })
                .whereRaw(`
                    documents.tenant = ? AND
                    document_associations.entity_id = ? AND
                    document_associations.entity_type = ?
                `, [tenant, schedule_id, 'schedule']);
        } catch (error) {
            logger.error(`Error getting documents with schedule_id ${schedule_id}:`, error);
            throw error;
        }
    }
};

export default Document;
