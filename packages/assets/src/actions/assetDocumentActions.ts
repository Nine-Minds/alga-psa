'use server';

import { revalidatePath } from 'next/cache';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import type { IDocument, IDocumentAssociation, IDocumentAssociationInput } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import {
    assetActionErrorFrom,
    type AssetActionError,
} from './assetActionErrors';

function tenantScopedTable(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder<any, any> {
    return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

export const associateDocumentWithAsset = withAuth(async (
    user,
    { tenant },
    input: IDocumentAssociationInput
): Promise<IDocumentAssociation | AssetActionError> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset updating (document associations are considered update operations)
    if (!await hasPermission(user, 'asset', 'update')) {
        return permissionError('Permission denied: Cannot associate documents with assets');
    }

    try {
        // Create association in the standard document_associations table
        const [association] = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await tenantScopedTable(trx, tenant, 'document_associations')
                .insert({
                    tenant,
                    entity_id: input.entity_id,
                    entity_type: 'asset',
                    document_id: input.document_id,
                    created_by: user.user_id,
                    notes: input.notes
                })
                .returning(['association_id', 'tenant', 'entity_id', 'entity_type', 'document_id', 'created_by', 'entered_at']);
        });

        revalidatePath(`/assets/${input.entity_id}`);
        return association;
    } catch (error) {
        console.error('Error associating document with asset:', error);
        const expectedError = assetActionErrorFrom(error);
        if (expectedError) {
            return expectedError;
        }
        throw error;
    }
});

export const removeDocumentFromAsset = withAuth(async (
    user,
    { tenant },
    association_id: string
): Promise<void | AssetActionError> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset deletion
    if (!await hasPermission(user, 'asset', 'delete')) {
        return permissionError('Permission denied: Cannot remove documents from assets');
    }

    try {
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            // First get the entity_id for revalidation
            const association = await tenantScopedTable(trx, tenant, 'document_associations')
                .where({ association_id })
                .first();

            if (association) {
                // Then delete the association
                await tenantScopedTable(trx, tenant, 'document_associations')
                    .where({ association_id })
                    .delete();

                revalidatePath(`/assets/${association.entity_id}`);
            }
        });
    } catch (error) {
        console.error('Error removing document from asset:', error);
        const expectedError = assetActionErrorFrom(error);
        if (expectedError) {
            return expectedError;
        }
        throw error;
    }
});

export const getAssetDocuments = withAuth(async (
    user,
    { tenant },
    asset_id: string
): Promise<(IDocument & { association_id: string, notes?: string })[] | AssetActionError> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset reading
    if (!await hasPermission(user, 'asset', 'read')) {
        return permissionError('Permission denied: Cannot read asset documents');
    }

    try {
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            const db = tenantDb(trx, tenant);
            const query = db.table('document_associations as da');
            db.tenantJoin(query, 'documents', 'documents.document_id', 'da.document_id');
            db.tenantJoin(query, 'users', 'documents.created_by', 'users.user_id', {
                type: 'left',
                rootTenantColumn: 'documents.tenant',
            });
            db.tenantJoin(query, 'document_types as dt', 'documents.type_id', 'dt.type_id', {
                type: 'left',
                rootTenantColumn: 'documents.tenant',
            });
            return await query
            .select(
                'documents.*',
                'da.association_id',
                'da.notes',
                trx.raw(`
                    COALESCE(dt.type_name, sdt.type_name) as type_name,
                    COALESCE(dt.icon, sdt.icon) as type_icon
                `),
                trx.raw(`
                    CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name
                `)
            )
            .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
            .where({
                'da.entity_id': asset_id,
                'da.entity_type': 'asset'
            })
            .orderBy('documents.entered_at', 'desc');
        });
    } catch (error) {
        console.error('Error getting asset documents:', error);
        const expectedError = assetActionErrorFrom(error);
        if (expectedError) {
            return expectedError;
        }
        throw error;
    }
});

export const updateAssetDocumentNotes = withAuth(async (
    user,
    { tenant },
    association_id: string,
    notes: string
): Promise<IDocumentAssociation | AssetActionError> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset updating
    if (!await hasPermission(user, 'asset', 'update')) {
        return permissionError('Permission denied: Cannot update asset document notes');
    }

    try {
        const [association] = await tenantScopedTable(knex, tenant, 'document_associations')
            .where({ association_id })
            .update({ notes })
            .returning(['association_id', 'tenant', 'entity_id', 'entity_type', 'document_id', 'notes', 'created_by', 'entered_at']);

        if (association) {
            revalidatePath(`/assets/${association.entity_id}`);
        } else {
            return assetActionErrorFrom(new Error('Asset document association not found'))!;
        }

        return association;
    } catch (error) {
        console.error('Error updating asset document notes:', error);
        const expectedError = assetActionErrorFrom(error);
        if (expectedError) {
            return expectedError;
        }
        throw error;
    }
});
