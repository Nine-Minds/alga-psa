/** Explicit document and knowledge-base projections. Storage locations are
 * transport-only and never named here. The global shared_document_types table
 * is not owned (tenantDb refuses global tables); documents.shared_type_id is an
 * external edge. Document render templates and their assignments are billing
 * presentation configuration and are excluded by name. */
export const CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS = {
  documents: ['document_id', 'document_name', 'type_id', 'user_id', 'order_number', 'created_by', 'edited_by', 'entered_at', 'updated_at', 'content', 'file_id', 'mime_type', 'file_size', 'shared_type_id', 'folder_path', 'thumbnail_file_id', 'preview_file_id', 'preview_generated_at', 'is_client_visible', 'source_template_id', 'source_template_version', 'rendered_locale'],
  document_versions: ['version_id', 'document_id', 'version_number', 'is_active', 'created_by', 'created_at'],
  document_content: ['id', 'document_id', 'content', 'created_by_id', 'updated_by_id', 'created_at', 'updated_at'],
  document_block_content: ['content_id', 'document_id', 'block_data', 'created_at', 'updated_at', 'version_id'],
  document_associations: ['association_id', 'document_id', 'entity_id', 'entity_type', 'created_at', 'is_entity_logo', 'entity_logo_variant'],
  document_folders: ['folder_id', 'folder_path', 'folder_name', 'parent_folder_id', 'created_at', 'created_by', 'entity_id', 'entity_type', 'is_client_visible'],
  document_types: ['type_id', 'type_name', 'icon'],
  document_default_folders: ['default_folder_id', 'entity_type', 'folder_path', 'folder_name', 'is_client_visible', 'sort_order', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  kb_articles: ['article_id', 'document_id', 'slug', 'article_type', 'audience', 'status', 'next_review_due', 'review_cycle_days', 'last_reviewed_at', 'last_reviewed_by', 'view_count', 'helpful_count', 'not_helpful_count', 'category_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'published_at', 'published_by'],
  kb_article_relations: ['relation_id', 'source_article_id', 'target_article_id', 'relation_type', 'created_at', 'created_by'],
  kb_article_reviewers: ['reviewer_id', 'article_id', 'user_id', 'review_status', 'review_notes', 'assigned_at', 'reviewed_at', 'assigned_by'],
  kb_article_templates: ['template_id', 'name', 'description', 'article_type', 'content_template', 'is_default', 'created_at', 'updated_at', 'created_by', 'updated_by'],
} as const;
export type CoManagedPortableDocumentTable = keyof typeof CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS;
export type CoManagedPortableDocumentRecords = Record<CoManagedPortableDocumentTable, Record<string, unknown>[]>;

export const CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES = [
  ['documents', 'type_id', 'document_types', 'type_id'],
  ['document_versions', 'document_id', 'documents', 'document_id'],
  ['document_content', 'document_id', 'documents', 'document_id'],
  ['document_block_content', 'document_id', 'documents', 'document_id'],
  ['document_block_content', 'version_id', 'document_versions', 'version_id'],
  ['document_associations', 'document_id', 'documents', 'document_id'],
  ['document_folders', 'parent_folder_id', 'document_folders', 'folder_id'],
  ['kb_articles', 'document_id', 'documents', 'document_id'],
  ['kb_article_relations', 'source_article_id', 'kb_articles', 'article_id'],
  ['kb_article_relations', 'target_article_id', 'kb_articles', 'article_id'],
  ['kb_article_reviewers', 'article_id', 'kb_articles', 'article_id'],
] as const;
