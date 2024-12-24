'use server';

import { createTenantKnex } from '../../db';
import { v4 as uuidv4 } from 'uuid';
import { IDocumentContent, UpdateDocumentContentInput } from '../../../interfaces/document.interface';
import { addDocument } from './documentActions';

// Create a new content document
export async function createContentDocument(
    name: string,
    userId: string,
    initialContent: string = '',
    entityId?: string,
    entityType?: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset'
): Promise<{ document_id: string }> {
    try {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

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

        // Create the document content
        await knex('document_content').insert({
            id: uuidv4(),
            document_id: documentResult._id,
            content: initialContent,
            tenant,
            created_by_id: userId,
            updated_by_id: userId,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        });

        return { document_id: documentResult._id };
    } catch (error) {
        console.error('Error creating content document:', error);
        throw new Error('Failed to create content document');
    }
}

// Get document content
export async function getDocumentContent(documentId: string): Promise<IDocumentContent | null> {
    try {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const content = await knex('document_content')
            .where({ document_id: documentId, tenant })
            .first();

        return content || null;
    } catch (error) {
        console.error('Error getting document content:', error);
        throw new Error('Failed to get document content');
    }
}

// Update document content
export async function updateDocumentContent(documentId: string, data: UpdateDocumentContentInput): Promise<void> {
    try {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const existingContent = await knex('document_content')
            .where({ document_id: documentId, tenant })
            .first();

        if (existingContent) {
            await knex('document_content')
                .where({ document_id: documentId, tenant })
                .update({
                    content: data.content,
                    updated_at: knex.fn.now(),
                    updated_by_id: data.updated_by_id
                });
        } else {
            await knex('document_content').insert({
                id: uuidv4(),
                document_id: documentId,
                content: data.content,
                tenant,
                created_by_id: data.updated_by_id,
                updated_by_id: data.updated_by_id,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
        }
    } catch (error) {
        console.error('Error updating document content:', error);
        throw new Error('Failed to update document content');
    }
}

// Delete document content
export async function deleteDocumentContent(documentId: string): Promise<void> {
    try {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        await knex('document_content')
            .where({ document_id: documentId, tenant })
            .delete();
    } catch (error) {
        console.error('Error deleting document content:', error);
        throw new Error('Failed to delete document content');
    }
}
