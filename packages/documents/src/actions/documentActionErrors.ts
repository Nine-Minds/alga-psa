import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type DocumentActionError = ActionMessageError | ActionPermissionError;

export function documentActionErrorMessage(error: unknown): string {
  const candidate = error as { permissionError?: unknown; actionError?: unknown };
  return typeof candidate.permissionError === 'string' ? candidate.permissionError : String(candidate.actionError ?? 'Action failed');
}

export function documentActionErrorFrom(error: unknown): DocumentActionError | null {
  if (error && typeof error === 'object') {
    const candidate = error as { permissionError?: unknown; actionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return permissionError(candidate.permissionError);
    }
    if (typeof candidate.actionError === 'string') {
      return actionError(candidate.actionError);
    }
  }

  if (error instanceof Error) {
    const message = error.message;

    if (message.includes('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }

    if (message.startsWith('Document not found')) {
      return actionError('Document not found. It may have been deleted or moved. Please refresh and try again.');
    }
    if (message.startsWith('File not found')) {
      return actionError('The document file is no longer available. Please refresh and try again.');
    }
    if (message.startsWith('Folder not found')) {
      return actionError('Folder not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'No file provided') {
      return actionError('Choose a file before uploading.');
    }
    if (message === 'File type not allowed') {
      return actionError('This file type is not allowed.');
    }
    if (message.startsWith('File size exceeds limit of ')) {
      return actionError(message);
    }
    if (message === 'User session is required to upload documents') {
      return permissionError('Your session is required to upload documents. Please sign in again.');
    }
    if (
      message === 'Folder path must start with /' ||
      message === 'Both entityId and entityType are required' ||
      message === 'Both entityId and entityType are required when scoping a folder to an entity' ||
      message === 'Invalid folder path'
    ) {
      return actionError(message);
    }
    if (message === 'Cannot delete folder: contains documents') {
      return actionError('Move or delete the documents in this folder before deleting it.');
    }
    if (message === 'Cannot delete folder: contains subfolders') {
      return actionError('Delete the subfolders in this folder before deleting it.');
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string; table?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected document values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '22007' || dbError?.code === '22008') {
    return actionError('One of the selected document dates is invalid. Please review the form and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required document field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected document, folder, or related record no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    if (dbError.constraint?.includes('document_associations')) {
      return actionError('This document is already associated with that record.');
    }
    if (dbError.table === 'document_folders' || dbError.constraint?.includes('document_folders')) {
      return actionError('A folder with that path already exists.');
    }
    return actionError('This document change conflicts with an existing record. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the document values is not allowed. Please review the form and try again.');
  }

  return null;
}
