import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ actionError: message }),
  permissionError: (message: string) => ({ permissionError: message }),
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
    });

    expect(documentActionErrorFrom(new Error('File not found in storage'))).toEqual({
      actionError: 'The document file is no longer available. Please refresh and try again.',
    });
  });

  it('maps expected folder validation failures to actionable messages', () => {
    expect(documentActionErrorFrom(new Error('Folder not found'))).toEqual({
      actionError: 'Folder not found. It may have been deleted. Please refresh and try again.',
    });

    expect(documentActionErrorFrom(new Error('Cannot delete folder: contains documents'))).toEqual({
      actionError: 'Move or delete the documents in this folder before deleting it.',
    });

    expect(documentActionErrorFrom(new Error('Folder path must start with /'))).toEqual({
      actionError: 'Folder path must start with /',
    });
  });

  it('maps database constraint failures without handling unexpected errors', () => {
    expect(documentActionErrorFrom({ code: '23503' })).toEqual({
      actionError: 'The selected document, folder, or related record no longer exists. Please refresh and try again.',
    });

    expect(documentActionErrorFrom({
      code: '23505',
      constraint: 'document_associations_document_id_entity_id_entity_type_unique',
    })).toEqual({
      actionError: 'This document is already associated with that record.',
    });

    expect(documentActionErrorFrom(new Error('database connection lost'))).toBeNull();
  });

  it('extracts messages from mapped action results', () => {
    const error = documentActionErrorFrom(new Error('No file provided'));
    expect(error).toEqual({ actionError: 'Choose a file before uploading.' });
    expect(error ? documentActionErrorMessage(error) : null).toBe('Choose a file before uploading.');
  });
});
