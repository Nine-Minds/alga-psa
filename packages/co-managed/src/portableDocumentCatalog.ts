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

/** Association entity types whose documents are customer operational content. This is an
 * allowlist: a document attached to anything else (invoice, quote, contract, sales order,
 * opportunity, payment or any type not named here) is commercial or unclassified and is
 * left out with its versions, content, associations, KB rows and file bytes. A document
 * rendered from a billing template (source_template_id) is likewise commercial. */
export const CO_MANAGED_PORTABLE_DOCUMENT_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'user', 'ticket', 'client', 'contact', 'asset', 'project', 'project_task', 'tenant', 'document', 'interaction', 'schedule_entry', 'kb_article',
]);

type Row = Record<string, unknown>;
/** Ids of documents that must not enter the package. */
export function commercialPortableDocumentIds(documents: readonly Row[], associations: readonly Row[]): Set<string> {
  const excluded = new Set<string>();
  for (const row of documents) if (row.source_template_id !== null && row.source_template_id !== undefined) excluded.add(String(row.document_id));
  for (const row of associations) if (!CO_MANAGED_PORTABLE_DOCUMENT_ENTITY_TYPES.has(String(row.entity_type))) excluded.add(String(row.document_id));
  return excluded;
}

/** Ids of documents that back only unsent or removed conversation content: at least one draft/removed
 * `ticket_comment_attachments` row points at them and nothing else does (no association, KB article, meeting
 * artifact or live attachment). A document with zero references of any kind (the tenant document library) is NOT
 * in this set and is exported. The conversations contributor already drops draft rows, so this keeps the two
 * sections consistent. */
export function draftAttachmentPortableDocumentIds(documents: readonly Row[], associations: readonly Row[], kbArticles: readonly Row[],
  attachments: readonly Row[], artifactDocumentIds: readonly unknown[]): Set<string> {
  const referenced = new Set<string>([...associations.map(row => row.document_id), ...kbArticles.map(row => row.document_id), ...artifactDocumentIds]
    .filter((id): id is string => typeof id === 'string'));
  const live = new Set(attachments.filter(row => row.state !== 'draft' && row.state !== 'removed').map(row => String(row.document_id)));
  const unsent = new Set(attachments.filter(row => row.state === 'draft' || row.state === 'removed').map(row => String(row.document_id)));
  return new Set(documents.map(row => String(row.document_id)).filter(id => unsent.has(id) && !live.has(id) && !referenced.has(id)));
}

/** Drops commercial documents (and, via `alsoExclude`, draft-attachment documents) and everything that hangs off them. Pure and deterministic. */
export function filterCommercialPortableDocuments(records: CoManagedPortableDocumentRecords, alsoExclude: ReadonlySet<string> = new Set()) {
  const commercial = commercialPortableDocumentIds(records.documents, records.document_associations);
  const excluded = new Set([...commercial, ...alsoExclude]);
  const keep = (rows: readonly Row[], key: string) => rows.filter(row => !excluded.has(String(row[key])));
  const documents = keep(records.documents, 'document_id');
  const articles = keep(records.kb_articles, 'document_id');
  const articleIds = new Set(articles.map(row => String(row.article_id)));
  let folders = records.document_folders.filter(row => row.entity_type === null || row.entity_type === undefined || CO_MANAGED_PORTABLE_DOCUMENT_ENTITY_TYPES.has(String(row.entity_type)));
  for (;;) { // a folder cannot outlive its parent
    const ids = new Set(folders.map(row => String(row.folder_id)));
    const next = folders.filter(row => !row.parent_folder_id || ids.has(String(row.parent_folder_id)));
    if (next.length === folders.length) break;
    folders = next;
  }
  const filtered: CoManagedPortableDocumentRecords = { ...records, documents, kb_articles: articles, document_folders: folders,
    document_versions: keep(records.document_versions, 'document_id'), document_content: keep(records.document_content, 'document_id'),
    document_block_content: keep(records.document_block_content, 'document_id'), document_associations: keep(records.document_associations, 'document_id'),
    document_default_folders: records.document_default_folders.filter(row => CO_MANAGED_PORTABLE_DOCUMENT_ENTITY_TYPES.has(String(row.entity_type))),
    kb_article_relations: records.kb_article_relations.filter(row => articleIds.has(String(row.source_article_id)) && articleIds.has(String(row.target_article_id))),
    kb_article_reviewers: records.kb_article_reviewers.filter(row => articleIds.has(String(row.article_id))) };
  return { records: filtered, excludedDocuments: commercial.size, draftAttachmentDocuments: excluded.size - commercial.size };
}
