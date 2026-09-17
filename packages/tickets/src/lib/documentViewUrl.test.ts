import { describe, it, expect } from 'vitest';
import { documentViewUrl, resolveDocumentViewUrl } from './documentViewUrl';

describe('resolveDocumentViewUrl', () => {
  it('views a file-backed document by its file id', () => {
    expect(resolveDocumentViewUrl({ document_id: 'doc-1', file_id: 'file-1' })).toBe(
      '/api/documents/view/file-1',
    );
  });

  it('never requests file content for a document with no associated file', () => {
    const url = resolveDocumentViewUrl({ document_id: 'doc-2', file_id: null });
    expect(url).not.toContain('/api/documents/download/');
    expect(url).not.toContain('/api/documents/view/');
    expect(url).toBe('/msp/documents?doc=doc-2');
  });
});

describe('documentViewUrl', () => {
  it('serves file-backed documents from the view route by file id', () => {
    expect(documentViewUrl({ document_id: 'doc-1', file_id: 'file-1' })).toBe(
      '/api/documents/view/file-1',
    );
  });

  it('never requests file content for a document with no associated file', () => {
    const url = documentViewUrl({ document_id: 'doc-2' });
    expect(url).not.toContain('/api/documents/download/');
    expect(url).not.toContain('/api/documents/view/');
    expect(url).toBe('/msp/documents?doc=doc-2');
  });

  it('does not consult the resolver for file-less documents', () => {
    const resolve = () => '/api/documents/download/doc-2';
    expect(documentViewUrl({ document_id: 'doc-2' }, resolve)).toBe(
      '/msp/documents?doc=doc-2',
    );
  });

  it('prefers a host resolver for file-backed documents', () => {
    const resolve = (document: { document_id?: string; file_id?: string }) =>
      `/custom/view/${document.file_id}`;
    expect(documentViewUrl({ document_id: 'doc-1', file_id: 'file-1' }, resolve)).toBe(
      '/custom/view/file-1',
    );
  });
});
