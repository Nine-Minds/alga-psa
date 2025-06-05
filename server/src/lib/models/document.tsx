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
            const [document_id] = await trx<IDocument>('documents')
                .insert(document)
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
            // First, get document IDs from associations
            const associations = await trx('document_associations')
                .select('document_id', 'tenant')
                .where({
                    entity_id: ticket_id,
                    entity_type: 'ticket'
                });

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);
            const tenant = associations[0].tenant;

            // Get documents
            const documents = await trx<IDocument>('documents')
                .select('documents.*')
                .whereIn('document_id', documentIds)
                .andWhere({ tenant });

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await trx('users')
                    .select('user_id', 'first_name', 'last_name')
                    .whereIn('user_id', userIds)
                    .andWhere({ tenant });
                
                usersMap = users.reduce((acc, user) => {
                    acc[user.user_id] = user;
                    return acc;
                }, {} as Record<string, any>);
            }

            // Combine the data
            return documents.map(doc => {
                const user = usersMap[doc.created_by];
                return {
                    ...doc,
                    first_name: user?.first_name,
                    last_name: user?.last_name,
                    created_by_full_name: user ? `${user.first_name} ${user.last_name}` : null
                };
            });
        } catch (error) {
            logger.error(`Error getting documents with ticket_id ${ticket_id}:`, error);
            throw error;
        }
    },

    getByCompanyId: async (company_id: string, trx: Knex.Transaction): Promise<IDocument[]> => {
        try {
            // First, get document IDs from associations
            const associations = await trx('document_associations')
                .select('document_id', 'tenant')
                .where({
                    entity_id: company_id,
                    entity_type: 'company'
                });

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);
            const tenant = associations[0].tenant;

            // Get documents
            const documents = await trx<IDocument>('documents')
                .select('documents.*')
                .whereIn('document_id', documentIds)
                .andWhere({ tenant });

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await trx('users')
                    .select('user_id', 'first_name', 'last_name')
                    .whereIn('user_id', userIds)
                    .andWhere({ tenant });
                
                usersMap = users.reduce((acc, user) => {
                    acc[user.user_id] = user;
                    return acc;
                }, {} as Record<string, any>);
            }

            // Combine the data
            return documents.map(doc => {
                const user = usersMap[doc.created_by];
                return {
                    ...doc,
                    first_name: user?.first_name,
                    last_name: user?.last_name,
                    created_by_full_name: user ? `${user.first_name} ${user.last_name}` : null
                };
            });
        } catch (error) {
            logger.error(`Error getting documents with company_id ${company_id}:`, error);
            throw error;
        }
    },

    getByContactNameId: async (contact_name_id: string, trx: Knex.Transaction): Promise<IDocument[]> => {
        try {
            // First, get document IDs from associations
            const associations = await trx('document_associations')
                .select('document_id', 'tenant')
                .where({
                    entity_id: contact_name_id,
                    entity_type: 'contact'
                });

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);
            const tenant = associations[0].tenant;

            // Get documents
            const documents = await trx<IDocument>('documents')
                .select('documents.*')
                .whereIn('document_id', documentIds)
                .andWhere({ tenant });

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await trx('users')
                    .select('user_id', 'first_name', 'last_name')
                    .whereIn('user_id', userIds)
                    .andWhere({ tenant });
                
                usersMap = users.reduce((acc, user) => {
                    acc[user.user_id] = user;
                    return acc;
                }, {} as Record<string, any>);
            }

            // Combine the data
            return documents.map(doc => {
                const user = usersMap[doc.created_by];
                return {
                    ...doc,
                    first_name: user?.first_name,
                    last_name: user?.last_name,
                    created_by_full_name: user ? `${user.first_name} ${user.last_name}` : null
                };
            });
        } catch (error) {
            logger.error(`Error getting documents with contact_name_id ${contact_name_id}:`, error);
            throw error;
        }
    }
};

export default Document;
