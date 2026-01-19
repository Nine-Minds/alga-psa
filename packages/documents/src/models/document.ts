import type { IDocument } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';

const Document = {
    getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IDocument[]> => {
        try {
            const { tenant } = await createTenantKnex();
            
            if (!tenant) {
                throw new Error('Tenant context is required for getting documents');
            }

            return await knexOrTrx<IDocument>('documents')
                .select(
                    'documents.*',
                    'users.first_name',
                    'users.last_name',
                    knexOrTrx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
                )
                .leftJoin('users', function() {
                    this.on('documents.created_by', '=', 'users.user_id')
                        .andOn('users.tenant', '=', knexOrTrx.raw('?', [tenant]));
                })
                .where({ 'documents.tenant': tenant });
        } catch (error) {
            console.error('Error getting all documents:', error);
            throw error;
        }
    },

    get: async (knexOrTrx: Knex | Knex.Transaction, document_id: string): Promise<IDocument | undefined> => {
        try {
            return await knexOrTrx<IDocument>('documents')
                    .select(
                        'documents.*',
                        'users.first_name as created_by_first_name',
                        'users.last_name as created_by_last_name',
                        knexOrTrx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
                        knexOrTrx.raw("COALESCE(dt.type_name, sdt.type_name) as type_name"),
                        knexOrTrx.raw("COALESCE(dt.icon, sdt.icon) as type_icon")
                    )
                    .leftJoin('users', function() {
                        this.on('documents.created_by', '=', 'users.user_id')
                            .andOn('users.tenant', '=', 'documents.tenant');
                    })
                    .leftJoin('document_types as dt', function() {
                        this.on('documents.type_id', '=', 'dt.type_id')
                            .andOn('documents.tenant', '=', 'dt.tenant');
                    })
                    .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
                    .where('documents.document_id', document_id)
                    .first();
        } catch (error) {
            console.error(`Error getting document with id ${document_id}:`, error);
            throw error;
        }
    },

    insert: async (knexOrTrx: Knex | Knex.Transaction, document: IDocument): Promise<Pick<IDocument, "document_id">> => {
        try {
            const [document_id] = await knexOrTrx<IDocument>('documents')
                .insert(document)
                .returning('document_id');
            return document_id;
        } catch (error) {
            console.error('Error inserting document:', error);
            throw error;
        }
    },

    update: async (knexOrTrx: Knex | Knex.Transaction, document_id: string, document: Partial<IDocument>): Promise<void> => {
        try {
            const { tenant: _, ...updateData } = document;
            await knexOrTrx<IDocument>('documents')
                .where('document_id', document_id)
                .update(updateData);
        } catch (error) {
            console.error(`Error updating document with id ${document_id}:`, error);
            throw error;
        }
    },

    delete: async (knexOrTrx: Knex | Knex.Transaction, document_id: string): Promise<void> => {
        try {
            await knexOrTrx<IDocument>('documents')
                .where('document_id', document_id)
                .del();
        } catch (error) {
            console.error(`Error deleting document with id ${document_id}:`, error);
            throw error;
        }
    },

    getByTicketId: async (knexOrTrx: Knex | Knex.Transaction, ticket_id: string): Promise<IDocument[]> => {
        try {
            // First, get document IDs from associations
            const associations = await knexOrTrx('document_associations')
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
            const documents = await knexOrTrx<IDocument>('documents')
                .select('documents.*')
                .whereIn('document_id', documentIds)
                .andWhere({ tenant });

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await knexOrTrx('users')
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
            console.error(`Error getting documents with ticket_id ${ticket_id}:`, error);
            throw error;
        }
    },

    getByClientId: async (knexOrTrx: Knex | Knex.Transaction, client_id: string): Promise<IDocument[]> => {
        try {
            // First, get document IDs from associations
            const associations = await knexOrTrx('document_associations')
                .select('document_id', 'tenant')
                .where({
                    entity_id: client_id,
                    entity_type: 'client'
                });

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);
            const tenant = associations[0].tenant;

            // Get documents
            const documents = await knexOrTrx<IDocument>('documents')
                .select('documents.*')
                .whereIn('document_id', documentIds)
                .andWhere({ tenant });

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await knexOrTrx('users')
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
            console.error(`Error getting documents with client_id ${client_id}:`, error);
            throw error;
        }
    },

    getByContactNameId: async (knexOrTrx: Knex | Knex.Transaction, contact_name_id: string): Promise<IDocument[]> => {
        try {
            // First, get document IDs from associations
            const associations = await knexOrTrx('document_associations')
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
            const documents = await knexOrTrx<IDocument>('documents')
                .select('documents.*')
                .whereIn('document_id', documentIds)
                .andWhere({ tenant });

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await knexOrTrx('users')
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
            console.error(`Error getting documents with contact_name_id ${contact_name_id}:`, error);
            throw error;
        }
    }
};

export default Document;
