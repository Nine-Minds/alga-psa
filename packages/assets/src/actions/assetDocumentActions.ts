'use server';

import { revalidatePath } from 'next/cache';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import type { IDocument, IDocumentAssociation, IDocumentAssociationInput } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';

export const associateDocumentWithAsset = withAuth(async (
    user,
    { tenant },
    input: IDocumentAssociationInput
): Promise<IDocumentAssociation> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset updating (document associations are considered update operations)
    if (!await hasPermission(user, 'asset', 'update')) {
        throw new Error('Permission denied: Cannot associate documents with assets');
    }

    try {
        // Create association in the standard document_associations table
        const [association] = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('document_associations')
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
        throw new Error('Failed to associate document with asset');
    }
});

export const removeDocumentFromAsset = withAuth(async (
    user,
    { tenant },
    association_id: string
): Promise<void> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset deletion
    if (!await hasPermission(user, 'asset', 'delete')) {
        throw new Error('Permission denied: Cannot remove documents from assets');
    }

    try {
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            // First get the entity_id for revalidation
            const association = await trx('document_associations')
                .where({ tenant, association_id })
                .first();

            if (association) {
                // Then delete the association
                await trx('document_associations')
                    .where({ tenant, association_id })
                    .delete();

                revalidatePath(`/assets/${association.entity_id}`);
            }
        });
    } catch (error) {
        console.error('Error removing document from asset:', error);
        throw new Error('Failed to remove document from asset');
    }
});

export const getAssetDocuments = withAuth(async (
    user,
    { tenant },
    asset_id: string
): Promise<(IDocument & { association_id: string, notes?: string })[]> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset reading
    if (!await hasPermission(user, 'asset', 'read')) {
        throw new Error('Permission denied: Cannot read asset documents');
    }

    try {
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('document_associations as da')
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
            .join('documents', function() {
                this.on('documents.document_id', '=', 'da.document_id')
                    .andOn('documents.tenant', '=', 'da.tenant');
            })
            .leftJoin('users', function() {
                this.on('documents.created_by', '=', 'users.user_id')
                    .andOn('users.tenant', '=', trx.raw('?', [tenant]));
            })
            .leftJoin('document_types as dt', function() {
                this.on('documents.type_id', '=', 'dt.type_id')
                    .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
            })
            .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
            .where({
                'da.tenant': tenant,
                'da.entity_id': asset_id,
                'da.entity_type': 'asset'
            })
            .orderBy('documents.entered_at', 'desc');
        });
    } catch (error) {
        console.error('Error getting asset documents:', error);
        throw new Error('Failed to get asset documents');
    }
});

export const updateAssetDocumentNotes = withAuth(async (
    user,
    { tenant },
    association_id: string,
    notes: string
): Promise<IDocumentAssociation> => {
    const { knex } = await createTenantKnex();

    // Check permission for asset updating
    if (!await hasPermission(user, 'asset', 'update')) {
        throw new Error('Permission denied: Cannot update asset document notes');
    }

    try {
        const [association] = await knex('document_associations')
            .where({ tenant, association_id })
            .update({ notes })
            .returning(['association_id', 'tenant', 'entity_id', 'entity_type', 'document_id', 'notes', 'created_by', 'entered_at']);

        if (association) {
            revalidatePath(`/assets/${association.entity_id}`);
        }

        return association;
    } catch (error) {
        console.error('Error updating asset document notes:', error);
        throw new Error('Failed to update asset document notes');
    }
});
