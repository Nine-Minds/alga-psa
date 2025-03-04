'use server';

import { revalidatePath } from 'next/cache';
import { createTenantKnex } from 'server/src/lib/db';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IDocumentAssociation, IDocumentAssociationInput } from 'server/src/interfaces/document-association.interface';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

export async function associateDocumentWithAsset(input: IDocumentAssociationInput): Promise<IDocumentAssociation> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No user session found');
        }

        // Create association in the standard document_associations table
        const [association] = await knex('document_associations')
            .insert({
                tenant,
                entity_id: input.entity_id,
                entity_type: 'asset',
                document_id: input.document_id,
                created_by: currentUser.user_id,
                notes: input.notes
            })
            .returning(['association_id', 'tenant', 'entity_id', 'entity_type', 'document_id', 'created_by', 'entered_at']);

        revalidatePath(`/assets/${input.entity_id}`);
        return association;
    } catch (error) {
        console.error('Error associating document with asset:', error);
        throw new Error('Failed to associate document with asset');
    }
}

export async function removeDocumentFromAsset(tenant: string, association_id: string): Promise<void> {
    const { knex } = await createTenantKnex();

    try {
        // First get the entity_id for revalidation
        const association = await knex('document_associations')
            .where({ tenant, association_id })
            .first();

        if (association) {
            // Then delete the association
            await knex('document_associations')
                .where({ tenant, association_id })
                .delete();

            revalidatePath(`/assets/${association.entity_id}`);
        }
    } catch (error) {
        console.error('Error removing document from asset:', error);
        throw new Error('Failed to remove document from asset');
    }
}

export async function getAssetDocuments(tenant: string, asset_id: string): Promise<(IDocument & { association_id: string, notes?: string })[]> {
    const { knex } = await createTenantKnex();

    try {
        return knex('document_associations as da')
            .select(
                'documents.*',
                'da.association_id',
                'da.notes',
                knex.raw(`
                    COALESCE(dt.type_name, sdt.type_name) as type_name,
                    COALESCE(dt.icon, sdt.icon) as type_icon
                `),
                knex.raw(`
                    CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name
                `)
            )
            .join('documents', function() {
                this.on('documents.document_id', '=', 'da.document_id')
                    .andOn('documents.tenant', '=', 'da.tenant');
            })
            .leftJoin('users', function() {
                this.on('documents.created_by', '=', 'users.user_id')
                    .andOn('users.tenant', '=', 'documents.tenant');
            })
            .leftJoin('document_types as dt', function() {
                this.on('documents.type_id', '=', 'dt.type_id')
                    .andOn('dt.tenant', '=', 'documents.tenant');
            })
            .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
            .where({
                'da.tenant': tenant,
                'da.entity_id': asset_id,
                'da.entity_type': 'asset'
            })
            .orderBy('documents.entered_at', 'desc');
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
