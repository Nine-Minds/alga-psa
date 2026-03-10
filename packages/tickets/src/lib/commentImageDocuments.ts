import type { IDocument } from '@alga-psa/types';

const DOCUMENT_VIEW_FILE_ID_REGEX = /\/api\/documents\/view\/([^"'?\s#]+)/g;

export interface CommentImageDocumentReference {
  documentId: string;
  fileId: string;
  name: string;
}

export function extractCommentReferencedFileIds(note: string | null | undefined): string[] {
  if (!note || typeof note !== 'string') {
    return [];
  }

  const fileIds = new Set<string>();
  let match: RegExpExecArray | null;
  DOCUMENT_VIEW_FILE_ID_REGEX.lastIndex = 0;

  while ((match = DOCUMENT_VIEW_FILE_ID_REGEX.exec(note)) !== null) {
    const rawFileId = match[1]?.trim();
    if (!rawFileId) continue;
    fileIds.add(decodeURIComponent(rawFileId));
  }

  return Array.from(fileIds);
}

export function resolveCommentReferencedImageDocuments(
  note: string | null | undefined,
  documents: IDocument[]
): CommentImageDocumentReference[] {
  const referencedFileIds = new Set(extractCommentReferencedFileIds(note));

  if (referencedFileIds.size === 0) {
    return [];
  }

  const imageDocuments: CommentImageDocumentReference[] = [];
  const seenDocumentIds = new Set<string>();

  for (const document of documents) {
    if (!document.document_id || !document.file_id) continue;
    if (seenDocumentIds.has(document.document_id)) continue;
    if (!referencedFileIds.has(document.file_id)) continue;
    if (!document.mime_type?.toLowerCase().startsWith('image/')) continue;

    seenDocumentIds.add(document.document_id);
    imageDocuments.push({
      documentId: document.document_id,
      fileId: document.file_id,
      name: document.document_name || 'clipboard-image',
    });
  }

  return imageDocuments;
}
