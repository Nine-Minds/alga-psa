'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type { IDocumentContent, UpdateDocumentContentInput } from '@alga-psa/types';
import { addDocument, getAuthorizedDocumentById } from './documentActions';
import { isActionPermissionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

// Create a new content document
export const createContentDocument = withAuth(async (
    _user,
    { tenant },
    name: string,
    userId: string,
    initialContent: string = '',
    entityId?: string,
    entityType?: 'ticket' | 'client' | 'contact' | 'asset'
): Promise<{ document_id: string }> => {
    try {
        const { knex } = await createTenantKnex();

        // Create the document first
        const documentResult = await addDocument({
            document_name: name,
            user_id: userId,
            created_by: userId,
            tenant,
            type_id: null, // Content documents don't need a specific type
            order_number: 0,
            // No file_id since this is a content document
        });

        if (isActionPermissionError(documentResult)) {
            throw new Error(documentResult.permissionError);
        }

        // Create the document content
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('document_content').insert({
                id: uuidv4(),
                document_id: documentResult._id,
                content: initialContent,
                tenant,
                created_by_id: userId,
                updated_by_id: userId,
                created_at: trx.fn.now(),
                updated_at: trx.fn.now()
            });
        });

        return { document_id: documentResult._id };
    } catch (error) {
        console.error('Error creating content document:', error);
        throw new Error('Failed to create content document');
    }
});

// Get document content
export const getDocumentContent = withAuth(async (
    user,
    { tenant },
    documentId: string
): Promise<IDocumentContent | null | ActionPermissionError> => {
    try {
        if (!await hasPermission(user, 'document', 'read')) {
            return permissionError('Permission denied: Cannot read documents');
        }

        const { knex } = await createTenantKnex();

        const content = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const authorizedDocument = await getAuthorizedDocumentById(trx, tenant, user, documentId);
            if (!authorizedDocument) {
                return permissionError('Permission denied: Cannot read documents');
            }

            return trx('document_content')
                .where({ document_id: documentId, tenant })
                .first();
        });

        if (isActionPermissionError(content)) {
            return content;
        }

        return content || null;
    } catch (error) {
        console.error('Error getting document content:', error);
        throw new Error('Failed to get document content');
    }
});

// Update document content
export const updateDocumentContent = withAuth(async (
    user,
    { tenant },
    documentId: string,
    data: UpdateDocumentContentInput
): Promise<void | ActionPermissionError> => {
    try {
        if (!await hasPermission(user, 'document', 'update')) {
            return permissionError('Permission denied: Cannot update documents');
        }

        const { knex } = await createTenantKnex();

        const updateResult = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const authorizedDocument = await getAuthorizedDocumentById(trx, tenant, user, documentId);
            if (!authorizedDocument) {
                return permissionError('Permission denied: Cannot update documents');
            }

            const existingContent = await trx('document_content')
                .where({ document_id: documentId, tenant })
                .first();

            if (existingContent) {
                return await trx('document_content')
                    .where({ document_id: documentId, tenant })
                    .update({
                        content: data.content,
                        updated_at: trx.fn.now(),
                        updated_by_id: data.updated_by_id
                    });
            } else {
                return await trx('document_content').insert({
                    id: uuidv4(),
                    document_id: documentId,
                    content: data.content,
                    tenant,
                    created_by_id: data.updated_by_id,
                    updated_by_id: data.updated_by_id,
                    created_at: trx.fn.now(),
                    updated_at: trx.fn.now()
                });
            }
        });

        if (isActionPermissionError(updateResult)) {
            return updateResult;
        }
    } catch (error) {
        console.error('Error updating document content:', error);
        throw new Error('Failed to update document content');
    }
});

// Delete document content
export const deleteDocumentContent = withAuth(async (
    user,
    { tenant },
    documentId: string
): Promise<void | ActionPermissionError> => {
    try {
        if (!await hasPermission(user, 'document', 'delete')) {
            return permissionError('Permission denied: Cannot delete documents');
        }

        const { knex } = await createTenantKnex();

        const deletionResult = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const authorizedDocument = await getAuthorizedDocumentById(trx, tenant, user, documentId);
            if (!authorizedDocument) {
                return permissionError('Permission denied: Cannot delete documents');
            }

            return trx('document_content')
                .where({ document_id: documentId, tenant })
                .delete();
        });

        if (isActionPermissionError(deletionResult)) {
            return deletionResult;
        }
    } catch (error) {
        console.error('Error deleting document content:', error);
        throw new Error('Failed to delete document content');
    }
});
