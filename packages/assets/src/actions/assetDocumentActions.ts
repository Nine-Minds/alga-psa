'use server';

import { revalidatePath } from 'next/cache';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import type { IDocument, IDocumentAssociation, IDocumentAssociationInput } from '@alga-psa/types';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

export async function associateDocumentWithAsset(input: IDocumentAssociationInput): Promise<IDocumentAssociation> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No user session found');
    }

    // Check permission for asset updating (document associations are considered update operations)
    if (!await hasPermission(currentUser, 'asset', 'update')) {
        throw new Error('Permission denied: Cannot associate documents with assets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
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
                    created_by: currentUser.user_id,
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
}

export async function removeDocumentFromAsset(tenant: string, association_id: string): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset deletion
    if (!await hasPermission(currentUser, 'asset', 'delete')) {
        throw new Error('Permission denied: Cannot remove documents from assets');
    }

    const { knex } = await createTenantKnex();

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
}

export async function getAssetDocuments(tenant: string, asset_id: string): Promise<(IDocument & { association_id: string, notes?: string })[]> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset reading
    if (!await hasPermission(currentUser, 'asset', 'read')) {
        throw new Error('Permission denied: Cannot read asset documents');
    }

    const { knex } = await createTenantKnex();

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
}

export async function updateAssetDocumentNotes(
    tenant: string,
    association_id: string,
    notes: string
): Promise<IDocumentAssociation> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset updating
    if (!await hasPermission(currentUser, 'asset', 'update')) {
        throw new Error('Permission denied: Cannot update asset document notes');
    }

    const { knex } = await createTenantKnex();

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
}
