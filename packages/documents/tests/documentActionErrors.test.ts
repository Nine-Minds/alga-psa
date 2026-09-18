import { describe, expect, it, vi } from 'vitest';

// Partial: the module under test also calls isAuthorizationThrow, and a mock that
// replaced the whole module made every case throw instead of assert.
vi.mock('@alga-psa/ui/lib/errorHandling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/lib/errorHandling')>()),
  actionError: (message: string, messageKey?: string) => ({
    actionError: message,
    ...(messageKey ? { messageKey } : {}),
  }),
  permissionError: (message: string, messageKey?: string) => ({
    permissionError: message,
    ...(messageKey ? { messageKey } : {}),
  }),
}));

import {
  documentActionErrorFrom,
  documentActionErrorMessage,
} from '../src/actions/documentActionErrors';

describe('documentActionErrorFrom', () => {
  it('maps expected permission and stale document failures to action results', () => {
    expect(documentActionErrorFrom(new Error('Permission denied: Cannot update documents'))).toEqual({
      permissionError: 'Permission denied: Cannot update documents',
    });

    expect(documentActionErrorFrom(new Error('Document not found'))).toEqual({
      actionError: 'Document not found. It may have been deleted or moved. Please refresh and try again.',
      messageKey: 'documents:errors.document.notFound',
    });

    expect(documentActionErrorFrom(new Error('File not found in storage'))).toEqual({
      actionError: 'The document file is no longer available. Please refresh and try again.',
      messageKey: 'documents:errors.document.fileUnavailable',
    });
  });

  it('maps expected folder validation failures to actionable messages', () => {
    expect(documentActionErrorFrom(new Error('Folder not found'))).toEqual({
      actionError: 'Folder not found. It may have been deleted. Please refresh and try again.',
      messageKey: 'documents:errors.folder.notFound',
    });

    expect(documentActionErrorFrom(new Error('Cannot delete folder: contains documents'))).toEqual({
      actionError: 'Move or delete the documents in this folder before deleting it.',
      messageKey: 'documents:errors.folder.emptyDocumentsFirst',
    });

    expect(documentActionErrorFrom(new Error('Folder path must start with /'))).toEqual({
      actionError: 'Folder path must start with /',
    });
  });

  it('maps database constraint failures without handling unexpected errors', () => {
    expect(documentActionErrorFrom({ code: '23503' })).toEqual({
      actionError: 'The selected document, folder, or related record no longer exists. Please refresh and try again.',
      messageKey: 'documents:errors.document.referenceMissing',
    });

    expect(documentActionErrorFrom({
      code: '23505',
      constraint: 'document_associations_document_id_entity_id_entity_type_unique',
    })).toEqual({
      actionError: 'This document is already associated with that record.',
      messageKey: 'documents:errors.document.duplicateAssociation',
    });

    expect(documentActionErrorFrom(new Error('database connection lost'))).toBeNull();
  });

  it('extracts messages from mapped action results', async () => {
    const error = documentActionErrorFrom(new Error('No file provided'));
    expect(error).toEqual({
      actionError: 'Choose a file before uploading.',
      messageKey: 'documents:errors.upload.fileRequired',
    });
    expect(error ? await documentActionErrorMessage(error) : null).toBe('Choose a file before uploading.');
  });
});
