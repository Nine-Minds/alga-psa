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
import Document from './document';

class DocumentBlockContent {
    static async getWithDocument(document_id: string): Promise<DocumentWithBlockContent | undefined> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (tenant == null) {
                throw new Error('No tenant found');
            }
            
            // Get document
            const document = await Document.get(document_id);
            if (!document) return undefined;

            // Get block content
            const blockContent = await db<IDocumentBlockContent>('document_block_content')
                .select('*')
                .whereRaw('document_id = ? AND tenant = ?', [document_id, tenant])
                .first();

            // Create result with explicit non-null document
            const result: DocumentWithBlockContent = {
                document: document as NonNullable<IDocument>,
                blockContent: blockContent ?? undefined
            };

            return result;
        } catch (error) {
            logger.error(`Error getting document with block content ${document_id}:`, error);
            throw error;
        }
    }

    static async getWithVersions(document_id: string): Promise<DocumentWithVersions | undefined> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (tenant == null) {
                throw new Error('No tenant found');
            }
            
            // Get document with block content
            const docWithContent = await DocumentBlockContent.getWithDocument(document_id);
            if (!docWithContent) return undefined;

            // Get versions
            const versions = await db<IDocumentVersion>('document_versions')
                .select('*')
                .whereRaw('document_id = ? AND tenant = ?', [document_id, tenant])
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
            if (tenant == null) {
                throw new Error('No tenant found');
            }
            
            // Get document
            const document = await Document.get(document_id);
            if (!document) return undefined;

            // Build query for block content
            let query = db<IDocumentBlockContent>('document_block_content')
                .select('document_block_content.*')
                .where('document_block_content.document_id', document_id)
                .andWhere('document_block_content.tenant', tenant);
            
            if (version_id) {
                // Handle specific version
                query = query.andWhere('document_block_content.version_id', db.raw('?::uuid', [version_id]));
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
        } catch (error) {
            logger.error(`Error getting versioned content for document ${document_id}:`, error);
            throw error;
        }
    }

    static async insert(content: DocumentBlockContentInput): Promise<Pick<IDocumentBlockContent, "content_id">> {
        try {
            const {knex: db, tenant} = await createTenantKnex();
            if (tenant == null) {
                throw new Error('No tenant found');
            }
                        
            const [content_id] = await db<IDocumentBlockContent>('document_block_content')
                .insert({...content, tenant})
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
            if (tenant == null) {
                throw new Error('No tenant found');
            }

            await db<IDocumentBlockContent>('document_block_content')
                .where('document_id', document_id)
                .andWhere('tenant', tenant)
                .update({
                    ...content,
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
            if (tenant == null) {
                throw new Error('No tenant found');
            }

            await db<IDocumentBlockContent>('document_block_content')
                .where('document_id', document_id)
                .andWhere('tenant', tenant)
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
            if (tenant == null) {
                throw new Error('No tenant found');
            }

            // Start a transaction
            const version_id = await db.transaction(async trx => {
                // Set all versions to inactive
                await trx('document_versions')
                    .where('document_id', version.document_id)
                    .andWhere('tenant', tenant)
                    .update({ is_active: false });

                // Insert new version
                const [newVersion] = await trx<IDocumentVersion>('document_versions')
                    .insert({...version, tenant})
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
            if (tenant == null) {
                throw new Error('No tenant found');
            }

            const version = await db<IDocumentVersion>('document_versions')
                .select('*')
                .where('document_id', document_id)
                .andWhere('tenant', tenant)
                .andWhere('is_active', true)
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
            if (tenant == null) {
                throw new Error('No tenant found');
            }
            
            await db.transaction(async trx => {
                // Set all versions to inactive
                await trx('document_versions')
                    .where('document_id', document_id)
                    .andWhere('tenant', tenant)
                    .update({ is_active: false });

                // Set specified version to active
                await trx('document_versions')
                    .where('version_id', trx.raw('?::uuid', [version_id]))
                    .andWhere('tenant', tenant)
                    .update({ is_active: true });
            });
        } catch (error) {
            logger.error(`Error setting active version for document ${document_id}:`, error);
            throw error;
        }
    }
}

export default DocumentBlockContent;
