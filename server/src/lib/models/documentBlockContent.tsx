import logger from '../../utils/logger';
import { 
    IDocumentBlockContent, 
    IDocumentVersion, 
    DocumentBlockContentInput, 
    DocumentVersionInput,
    DocumentWithBlockContent,
    DocumentWithVersions
} from '../../interfaces/documentBlockContent.interface';
import { IDocument } from '../../interfaces';
import { createTenantKnex } from '../db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import Document from './document';

class DocumentBlockContent {
    static async getWithDocument(document_id: string): Promise<DocumentWithBlockContent | undefined> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for getting document block content');
            }
            
            return await withTransaction(db, async (trx: Knex.Transaction) => {
                // Get document
                const document = await Document.get(trx, document_id);
                if (!document) return undefined;

                // Get block content
                const blockContent = await trx<IDocumentBlockContent>('document_block_content')
                    .select('*')
                    .where({
                        document_id,
                        tenant
                    })
                    .first();

                // Create result with explicit non-null document
                const result: DocumentWithBlockContent = {
                    document: document as NonNullable<IDocument>,
                    blockContent: blockContent ?? undefined
                };

                return result;
            });
        } catch (error) {
            logger.error(`Error getting document with block content ${document_id}:`, error);
            throw error;
        }
    }

    static async getWithVersions(document_id: string): Promise<DocumentWithVersions | undefined> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for getting document versions');
            }
            
            // Get document with block content
            const docWithContent = await DocumentBlockContent.getWithDocument(document_id);
            if (!docWithContent) return undefined;

            // Get versions
            const versions = await db<IDocumentVersion>('document_versions')
                .select('*')
                .where({
                    document_id,
                    tenant
                })
                .orderBy('version_number', 'desc');

            const result: DocumentWithVersions = {
                document: docWithContent.document,
                blockContent: docWithContent.blockContent,
                versions
            };

            return result;
        } catch (error) {
            logger.error(`Error getting document with versions ${document_id}:`, error);
            throw error;
        }
    }

    static async getVersionedContent(document_id: string, version_id?: string): Promise<DocumentWithBlockContent | undefined> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for getting versioned content');
            }
            
            return await withTransaction(db, async (trx: Knex.Transaction) => {
                // Get document
                const document = await Document.get(trx, document_id);
                if (!document) return undefined;

                // Build query for block content
                let query = trx<IDocumentBlockContent>('document_block_content')
                    .select('document_block_content.*')
                    .where('document_block_content.document_id', document_id)
                    .andWhere('document_block_content.tenant', tenant);
                
                if (version_id) {
                    // Handle specific version
                    query = query.andWhere('document_block_content.version_id', version_id);
                } else {
                    // If no version specified, get content for active version
                    query = query.leftJoin('document_versions', function() {
                        this.on('document_block_content.version_id', '=', 'document_versions.version_id')
                            .andOn('document_block_content.tenant', '=', 'document_versions.tenant');
                    })
                    .where(function() {
                        this.where('document_versions.is_active', true)
                            .orWhereNull('document_block_content.version_id');
                    });
                }

                const blockContent = await query.first();

                const result: DocumentWithBlockContent = {
                    document: document as NonNullable<IDocument>,
                    blockContent: blockContent ?? undefined
                };

                return result;
            });
        } catch (error) {
            logger.error(`Error getting versioned content for document ${document_id}:`, error);
            throw error;
        }
    }

    static async insert(content: DocumentBlockContentInput): Promise<Pick<IDocumentBlockContent, "content_id">> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for inserting document block content');
            }
            
            // Remove any tenant from input data to prevent conflicts
            const { tenant: _, ...contentData } = content;
            const [content_id] = await db<IDocumentBlockContent>('document_block_content')
                .insert({
                    ...contentData,
                    tenant
                })
                .returning('content_id');
            return content_id;
        } catch (error) {
            logger.error('Error inserting document block content:', error);
            throw error;
        }
    }

    static async update(document_id: string, content: Partial<IDocumentBlockContent>): Promise<void> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for updating document block content');
            }

            // Remove tenant from update data to prevent modification
            const { tenant: _, ...updateData } = content;
            await db<IDocumentBlockContent>('document_block_content')
                .where({
                    document_id,
                    tenant
                })
                .update({
                    ...updateData,
                    updated_at: db.fn.now()
                });
        } catch (error) {
            logger.error(`Error updating block content for document ${document_id}:`, error);
            throw error;
        }
    }

    static async delete(document_id: string): Promise<void> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for deleting document block content');
            }

            await db<IDocumentBlockContent>('document_block_content')
                .where({
                    document_id,
                    tenant
                })
                .del();
        } catch (error) {
            logger.error(`Error deleting block content for document ${document_id}:`, error);
            throw error;
        }
    }

    // Version management
    static async createVersion(version: DocumentVersionInput): Promise<Pick<IDocumentVersion, "version_id">> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for creating document version');
            }

            // Start a transaction
            const version_id = await db.transaction(async trx => {
                // Set all versions to inactive
                await trx('document_versions')
                    .where({
                        document_id: version.document_id,
                        tenant
                    })
                    .update({ is_active: false });

                // Remove any tenant from input data to prevent conflicts
                const { tenant: _, ...versionData } = version;
                
                // Insert new version
                const [newVersion] = await trx<IDocumentVersion>('document_versions')
                    .insert({
                        ...versionData,
                        tenant
                    })
                    .returning('version_id');
                
                return newVersion;
            });

            return version_id;
        } catch (error) {
            logger.error('Error creating document version:', error);
            throw error;
        }
    }

    static async getActiveVersion(document_id: string): Promise<IDocumentVersion | undefined> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for getting active document version');
            }

            const version = await db<IDocumentVersion>('document_versions')
                .select('*')
                .where({
                    document_id,
                    tenant,
                    is_active: true
                })
                .first();
            
            return version ?? undefined;
        } catch (error) {
            logger.error(`Error getting active version for document ${document_id}:`, error);
            throw error;
        }
    }

    static async setActiveVersion(document_id: string, version_id: string): Promise<void> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (!tenant) {
                throw new Error('Tenant context is required for setting active document version');
            }
            
            await db.transaction(async trx => {
                // Set all versions to inactive
                await trx('document_versions')
                    .where({
                        document_id,
                        tenant
                    })
                    .update({ is_active: false });

                // Set specified version to active
                await trx('document_versions')
                    .where({
                        version_id,
                        tenant
                    })
                    .update({ is_active: true });
            });
        } catch (error) {
            logger.error(`Error setting active version for document ${document_id}:`, error);
            throw error;
        }
    }
}

export default DocumentBlockContent;
