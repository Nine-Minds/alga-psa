import logger from '../../utils/logger';
import { IDocumentAssociation, IDocumentAssociationInput } from '../../interfaces/document-association.interface';
import { createTenantKnex } from '../db';

const DocumentAssociation = {
    create: async (association: IDocumentAssociationInput): Promise<Pick<IDocumentAssociation, "association_id">> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for creating document association');
            }

            // Remove any tenant from input data to prevent conflicts
            const { tenant: _, ...associationData } = association;
            const [result] = await db<IDocumentAssociation>('document_associations')
                .insert({
                    ...associationData,
                    tenant
                })
                .returning('association_id');
            return result;
        } catch (error) {
            logger.error('Error creating document association:', error);
            throw error;
        }
    },

    getByDocumentId: async (document_id: string): Promise<IDocumentAssociation[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for getting document associations');
            }

            const associations = await db<IDocumentAssociation>('document_associations')
                .select('*')
                .where({
                    document_id,
                    tenant
                });
            return associations;
        } catch (error) {
            logger.error(`Error getting associations for document ${document_id}:`, error);
            throw error;
        }
    },

    getByEntity: async (entity_id: string, entity_type: string): Promise<IDocumentAssociation[]> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for getting entity associations');
            }

            const associations = await db<IDocumentAssociation>('document_associations')
                .select('*')
                .where('entity_id', entity_id)
                .andWhere('entity_type', entity_type)
                .andWhere('tenant', tenant);
            return associations;
        } catch (error) {
            logger.error(`Error getting associations for entity ${entity_id}:`, error);
            throw error;
        }
    },

    delete: async (association_id: string): Promise<void> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for deleting document association');
            }

            await db<IDocumentAssociation>('document_associations')
                .where('association_id', association_id)
                .andWhere('tenant', tenant)
                .delete();
        } catch (error) {
            logger.error(`Error deleting association ${association_id}:`, error);
            throw error;
        }
    },

    deleteByEntity: async (entity_id: string, entity_type: string): Promise<void> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for deleting entity associations');
            }

            await db<IDocumentAssociation>('document_associations')
                .where('entity_id', entity_id)
                .andWhere('entity_type', entity_type)
                .andWhere('tenant', tenant)
                .delete();
        } catch (error) {
            logger.error(`Error deleting associations for entity ${entity_id}:`, error);
            throw error;
        }
    },

    deleteByDocument: async (document_id: string): Promise<void> => {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for deleting document associations');
            }

            await db<IDocumentAssociation>('document_associations')
                .where('document_id', document_id)
                .andWhere('tenant', tenant)
                .delete();
        } catch (error) {
            logger.error(`Error deleting associations for document ${document_id}:`, error);
            throw error;
        }
    }
};

export default DocumentAssociation;
