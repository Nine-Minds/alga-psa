import { BaseModel } from './BaseModel';
import { IDocumentAssociation, IDocumentAssociationInput } from '../interfaces/document-association.interface';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

class DocumentAssociation extends BaseModel {
    /**
     * Create a new document association
     */
    static async create(knexOrTrx: Knex | Knex.Transaction, data: IDocumentAssociationInput): Promise<Pick<IDocumentAssociation, "association_id">> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const association: IDocumentAssociation = {
            ...data,
            association_id: uuidv4(),
            tenant
        };

        await knexOrTrx('document_associations').insert(association);

        return { association_id: association.association_id };
    }

    /**
     * Delete document associations by document ID
     */
    static async deleteByDocument(knexOrTrx: Knex | Knex.Transaction, document_id: string): Promise<void> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        await knexOrTrx('document_associations')
            .where({ document_id, tenant })
            .delete();
    }

    /**
     * Delete document associations by entity
     */
    static async deleteByEntity(knexOrTrx: Knex | Knex.Transaction, entity_id: string, entity_type: string): Promise<void> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        await knexOrTrx('document_associations')
            .where({ entity_id, entity_type, tenant })
            .delete();
    }

    /**
     * Get document associations by entity
     */
    static async getByEntity(knexOrTrx: Knex | Knex.Transaction, entity_id: string, entity_type: string): Promise<IDocumentAssociation[]> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        return knexOrTrx('document_associations')
            .where({ entity_id, entity_type, tenant })
            .orderBy('created_at', 'desc');
    }

    /**
     * Check if a document is associated with an entity
     */
    static async isAssociated(knexOrTrx: Knex | Knex.Transaction, document_id: string, entity_id: string, entity_type: string): Promise<boolean> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const result = await knexOrTrx('document_associations')
            .where({ document_id, entity_id, entity_type, tenant })
            .first();

        return !!result;
    }
}

export default DocumentAssociation;
