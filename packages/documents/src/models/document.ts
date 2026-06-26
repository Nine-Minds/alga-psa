import type { IDocument } from '@alga-psa/types';
import { requireTenantId, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

type DocumentAssociationLookupRow = {
    document_id: string;
    tenant: string;
};

type DocumentUserSummaryRow = {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
};

const Document = {
    getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IDocument[]> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);

            return await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
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
        } catch (error) {
            console.error('Error getting all documents:', error);
            throw error;
        }
    },

    get: async (knexOrTrx: Knex | Knex.Transaction, document_id: string): Promise<IDocument | undefined> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);

            return await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
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
            const tenant = document.tenant || await requireTenantId(knexOrTrx);
            const [document_id] = await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
                .insert({ ...document, tenant })
                .returning('document_id');
            return document_id;
        } catch (error) {
            console.error('Error inserting document:', error);
            throw error;
        }
    },

    update: async (knexOrTrx: Knex | Knex.Transaction, document_id: string, document: Partial<IDocument>): Promise<void> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);
            const { tenant: _, ...updateData } = document;
            await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
                .where('document_id', document_id)
                .update(updateData);
        } catch (error) {
            console.error(`Error updating document with id ${document_id}:`, error);
            throw error;
        }
    },

    delete: async (knexOrTrx: Knex | Knex.Transaction, document_id: string): Promise<void> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);
            await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
                .where('document_id', document_id)
                .del();
        } catch (error) {
            console.error(`Error deleting document with id ${document_id}:`, error);
            throw error;
        }
    },

    getByTicketId: async (knexOrTrx: Knex | Knex.Transaction, ticket_id: string): Promise<IDocument[]> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);

            // First, get document IDs from associations
            const associations = await tenantDb(knexOrTrx, tenant).table<DocumentAssociationLookupRow>('document_associations')
                .select('document_id', 'tenant')
                .where('entity_id', ticket_id)
                .andWhere('entity_type', 'ticket') as DocumentAssociationLookupRow[];

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);

            // Get documents
            const documents = await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
                .select('*')
                .whereIn('document_id', documentIds);

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await tenantDb(knexOrTrx, tenant).table<DocumentUserSummaryRow>('users')
                    .select('user_id', 'first_name', 'last_name')
                    .whereIn('user_id', userIds) as DocumentUserSummaryRow[];
                
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
                    created_by_full_name: user ? `${user.first_name} ${user.last_name}` : undefined
                };
            });
        } catch (error) {
            console.error(`Error getting documents with ticket_id ${ticket_id}:`, error);
            throw error;
        }
    },

    getByClientId: async (knexOrTrx: Knex | Knex.Transaction, client_id: string): Promise<IDocument[]> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);

            // First, get document IDs from associations
            const associations = await tenantDb(knexOrTrx, tenant).table<DocumentAssociationLookupRow>('document_associations')
                .select('document_id', 'tenant')
                .where('entity_id', client_id)
                .andWhere('entity_type', 'client') as DocumentAssociationLookupRow[];

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);

            // Get documents
            const documents = await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
                .select('*')
                .whereIn('document_id', documentIds);

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await tenantDb(knexOrTrx, tenant).table<DocumentUserSummaryRow>('users')
                    .select('user_id', 'first_name', 'last_name')
                    .whereIn('user_id', userIds) as DocumentUserSummaryRow[];
                
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
                    created_by_full_name: user ? `${user.first_name} ${user.last_name}` : undefined
                };
            });
        } catch (error) {
            console.error(`Error getting documents with client_id ${client_id}:`, error);
            throw error;
        }
    },

    getByContactNameId: async (knexOrTrx: Knex | Knex.Transaction, contact_name_id: string): Promise<IDocument[]> => {
        try {
            const tenant = await requireTenantId(knexOrTrx);

            // First, get document IDs from associations
            const associations = await tenantDb(knexOrTrx, tenant).table<DocumentAssociationLookupRow>('document_associations')
                .select('document_id', 'tenant')
                .where('entity_id', contact_name_id)
                .andWhere('entity_type', 'contact') as DocumentAssociationLookupRow[];

            if (associations.length === 0) {
                return [];
            }

            // Extract document IDs and tenant
            const documentIds = associations.map(a => a.document_id);

            // Get documents
            const documents = await tenantDb(knexOrTrx, tenant).table<IDocument>('documents')
                .select('*')
                .whereIn('document_id', documentIds);

            // Get user information separately
            const userIds = [...new Set(documents.map(d => d.created_by).filter(Boolean))];
            let usersMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
                const users = await tenantDb(knexOrTrx, tenant).table<DocumentUserSummaryRow>('users')
                    .select('user_id', 'first_name', 'last_name')
                    .whereIn('user_id', userIds) as DocumentUserSummaryRow[];
                
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
                    created_by_full_name: user ? `${user.first_name} ${user.last_name}` : undefined
                };
            });
        } catch (error) {
            console.error(`Error getting documents with contact_name_id ${contact_name_id}:`, error);
            throw error;
        }
    }
};

export default Document;
