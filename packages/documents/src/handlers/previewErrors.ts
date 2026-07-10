export function documentPreviewErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message === 'File not found' || message.startsWith('File not found in storage')) {
    return 'The document file could not be found in storage.';
  }

  if (message.startsWith('No handler found for document')) {
    return 'This document type cannot be previewed.';
  }

  return fallback;
}
