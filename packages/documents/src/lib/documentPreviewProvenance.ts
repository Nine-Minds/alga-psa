import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface DocumentPreviewReferences {
  thumbnail_file_id?: string | null;
  preview_file_id?: string | null;
}

export function withoutClientThumbnailReference<T extends { thumbnail_file_id?: unknown }>(data: T): Omit<T, 'thumbnail_file_id'> {
  const editableFields = { ...data };
  delete editableFields.thumbnail_file_id;
  return editableFields;
}

/**
 * Confirm each server-generated reference belongs to this tenant and document.
 * The documents table intentionally has no FK for derivative IDs; external_files
 * metadata is the persisted provenance written by the preview generator.
 */
export async function validateDocumentPreviewProvenance(
  knex: Knex,
  tenant: string,
  documentId: string,
  references: DocumentPreviewReferences,
): Promise<void> {
  const expected = [
    { fileId: references.thumbnail_file_id, context: 'document_thumbnail' },
    { fileId: references.preview_file_id, context: 'document_preview' },
  ].filter((entry): entry is { fileId: string; context: string } => Boolean(entry.fileId));

  if (expected.length === 0) return;

  const rows = await tenantDb(knex, tenant)
    .table('external_files')
    .where({ is_deleted: false })
    .whereIn('file_id', expected.map(({ fileId }) => fileId))
    .select('file_id', 'metadata');
  const byId = new Map(rows.map((row: { file_id: string; metadata?: unknown }) => [row.file_id, row.metadata]));

  for (const { fileId, context } of expected) {
    const metadata = byId.get(fileId) as { context?: unknown; source_document_id?: unknown } | undefined;
    if (metadata?.context !== context || metadata.source_document_id !== documentId) {
      throw new Error(`Document ${context} ${fileId} is not a derivative of document ${documentId} in tenant ${tenant}`);
    }
  }
}
