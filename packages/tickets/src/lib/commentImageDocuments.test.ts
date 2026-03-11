import { describe, expect, it } from 'vitest';

import {
  extractCommentReferencedFileIds,
  resolveCommentReferencedImageDocuments,
} from './commentImageDocuments';

describe('commentImageDocuments', () => {
  it('extracts document view file ids from saved comment note content', () => {
    const note = JSON.stringify([
      {
        type: 'image',
        props: {
          url: '/api/documents/view/file-123?x=1',
        },
      },
      {
        type: 'image',
        props: {
          url: 'https://example.test/api/documents/view/file-456',
        },
      },
    ]);

    expect(extractCommentReferencedFileIds(note)).toEqual(['file-123', 'file-456']);
  });

  it('resolves only image ticket documents referenced by the comment', () => {
    const note = JSON.stringify([
      {
        type: 'image',
        props: {
          url: '/api/documents/view/file-123',
        },
      },
      {
        type: 'file',
        props: {
          url: '/api/documents/view/file-789',
        },
      },
    ]);

    const documents: any[] = [
      {
        document_id: 'doc-1',
        file_id: 'file-123',
        document_name: 'clipboard-image.png',
        mime_type: 'image/png',
      },
      {
        document_id: 'doc-2',
        file_id: 'file-789',
        document_name: 'attachment.pdf',
        mime_type: 'application/pdf',
      },
    ];

    expect(resolveCommentReferencedImageDocuments(note, documents)).toEqual([
      {
        documentId: 'doc-1',
        fileId: 'file-123',
        name: 'clipboard-image.png',
      },
    ]);
  });
});
