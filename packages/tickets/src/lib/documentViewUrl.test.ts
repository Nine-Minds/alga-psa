import { describe, it, expect } from 'vitest';
import { documentViewUrl, resolveDocumentViewUrl } from './documentViewUrl';

describe('resolveDocumentViewUrl', () => {
  it('views a previewable file-backed document by its file id', () => {
    expect(resolveDocumentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/png' })).toBe(
      '/api/documents/view/file-1',
    );
    expect(resolveDocumentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'application/pdf' })).toBe(
      '/api/documents/view/file-1',
    );
    expect(resolveDocumentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'video/mp4' })).toBe(
      '/api/documents/view/file-1',
    );
  });

  it('downloads a file-backed document the view route would refuse (voicemail audio, unknown type)', () => {
    for (const mime_type of ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'application/zip', 'text/plain', undefined, null]) {
      expect(resolveDocumentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type })).toBe(
        '/api/documents/download/file-1',
      );
    }
  });

  it('never requests file content for a document with no associated file', () => {
    const url = resolveDocumentViewUrl({ document_id: 'doc-2', file_id: null });
    expect(url).not.toContain('/api/documents/download/');
    expect(url).not.toContain('/api/documents/view/');
    expect(url).toBe('/msp/documents?doc=doc-2');
  });
});

describe('documentViewUrl', () => {
  it('serves previewable file-backed documents from the view route by file id', () => {
    expect(documentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/jpeg' })).toBe(
      '/api/documents/view/file-1',
    );
  });

  it('serves non-previewable file-backed documents from the download route', () => {
    expect(documentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'audio/wav' })).toBe(
      '/api/documents/download/file-1',
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

  it('prefers a host resolver for file-backed documents and hands it the mime type', () => {
    const resolve = (document: { document_id?: string; file_id?: string; mime_type?: string }) =>
      `/custom/${document.mime_type === 'audio/wav' ? 'download' : 'view'}/${document.file_id}`;
    expect(documentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/png' }, resolve)).toBe(
      '/custom/view/file-1',
    );
    expect(documentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'audio/wav' }, resolve)).toBe(
      '/custom/download/file-1',
    );
  });
});
