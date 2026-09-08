/** Explicit document/KB projections. Storage locations are transport-only. */
export const CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS = {
  documents: ['document_id', 'document_name', 'type_id', 'user_id', 'order_number', 'created_by', 'edited_by', 'entered_at', 'updated_at', 'content', 'file_id', 'mime_type', 'file_size', 'shared_type_id', 'folder_path', 'thumbnail_file_id', 'preview_file_id', 'preview_generated_at', 'is_client_visible', 'source_template_id', 'source_template_version', 'rendered_locale'],
  document_versions: ['version_id', 'document_id', 'version_number', 'is_active', 'created_by', 'created_at'],
  document_content: ['id', 'document_id', 'content', 'created_by_id', 'updated_by_id', 'created_at', 'updated_at'],
  document_block_content: ['content_id', 'document_id', 'block_data', 'created_at', 'updated_at', 'version_id'],
  document_associations: ['association_id', 'document_id', 'entity_id', 'entity_type', 'created_at', 'is_entity_logo', 'entity_logo_variant'],
  document_folders: ['folder_id', 'folder_path', 'folder_name', 'parent_folder_id', 'created_at', 'created_by', 'entity_id', 'entity_type', 'is_client_visible'],
  document_types: ['type_id', 'type_name', 'icon'],
  shared_document_types: ['type_id', 'type_name', 'icon', 'description', 'created_at', 'updated_at'],
  document_default_folders: ['default_folder_id', 'entity_type', 'folder_path', 'folder_name', 'is_client_visible', 'sort_order', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  document_templates: ['template_id', 'document_type', 'name', 'version', 'templateAst', 'is_default', 'created_at', 'updated_at'],
  document_template_assignments: ['assignment_id', 'document_type', 'scope_type', 'scope_id', 'template_source', 'standard_template_code', 'template_id', 'created_by', 'created_at', 'updated_at'],
  kb_articles: ['article_id', 'document_id', 'slug', 'article_type', 'audience', 'status', 'next_review_due', 'review_cycle_days', 'last_reviewed_at', 'last_reviewed_by', 'view_count', 'helpful_count', 'not_helpful_count', 'category_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'published_at', 'published_by'],
  kb_article_relations: ['relation_id', 'source_article_id', 'target_article_id', 'relation_type', 'created_at', 'created_by'],
  kb_article_reviewers: ['reviewer_id', 'article_id', 'user_id', 'review_status', 'review_notes', 'assigned_at', 'reviewed_at', 'assigned_by'],
  kb_article_templates: ['template_id', 'name', 'description', 'article_type', 'content_template', 'is_default', 'created_at', 'updated_at', 'created_by', 'updated_by'],
} as const;
export type CoManagedPortableDocumentTable = keyof typeof CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS;
export type CoManagedPortableDocumentRecords = Record<CoManagedPortableDocumentTable, Record<string, unknown>[]>;
