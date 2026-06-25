import type { Knex } from 'knex';
import type { IDocumentAssociation, IDocumentAssociationInput } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { createTenantScopedQuery, requireTenantId } from '@alga-psa/db';

class DocumentAssociation {
  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    data: IDocumentAssociationInput
  ): Promise<Pick<IDocumentAssociation, 'association_id'>> {
    const tenant = await requireTenantId(knexOrTrx);

    const association: IDocumentAssociation = {
      ...data,
      association_id: uuidv4(),
      tenant,
    };

    await knexOrTrx('document_associations').insert(association);

    return { association_id: association.association_id };
  }

  static async deleteByDocument(knexOrTrx: Knex | Knex.Transaction, document_id: string): Promise<void> {
    const tenant = await requireTenantId(knexOrTrx);

    await createTenantScopedQuery(knexOrTrx, {
      table: 'document_associations',
      tenant,
    }).builder
      .where({ document_id })
      .delete();
  }

  static async deleteByEntity(
    knexOrTrx: Knex | Knex.Transaction,
    entity_id: string,
    entity_type: string
  ): Promise<void> {
    const tenant = await requireTenantId(knexOrTrx);

    await createTenantScopedQuery(knexOrTrx, {
      table: 'document_associations',
      tenant,
    }).builder
      .where({ entity_id, entity_type })
      .delete();
  }

  static async getByDocumentId(
    knexOrTrx: Knex | Knex.Transaction,
    document_id: string
  ): Promise<IDocumentAssociation[]> {
    const tenant = await requireTenantId(knexOrTrx);
    return createTenantScopedQuery(knexOrTrx, {
      table: 'document_associations',
      tenant,
    }).builder
      .where({ document_id })
      .orderBy('created_at', 'desc');
  }

  static async getByEntity(
    knexOrTrx: Knex | Knex.Transaction,
    entity_id: string,
    entity_type: string
  ): Promise<IDocumentAssociation[]> {
    const tenant = await requireTenantId(knexOrTrx);

    return createTenantScopedQuery(knexOrTrx, {
      table: 'document_associations',
      tenant,
    }).builder
      .where({ entity_id, entity_type })
      .orderBy('created_at', 'desc');
  }

  static async isAssociated(
    knexOrTrx: Knex | Knex.Transaction,
    document_id: string,
    entity_id: string,
    entity_type: string
  ): Promise<boolean> {
    const tenant = await requireTenantId(knexOrTrx);

    const result = await createTenantScopedQuery(knexOrTrx, {
      table: 'document_associations',
      tenant,
    }).builder
      .where({ document_id, entity_id, entity_type })
      .first();

    return !!result;
  }
}

export default DocumentAssociation;
