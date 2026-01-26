function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function buildDocumentUploadedPayload(params: {
  documentId: string;
  uploadedByUserId?: string;
  uploadedAt?: string | Date;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
}): Record<string, unknown> {
  const uploadedAt = toIsoString(params.uploadedAt);

  return {
    documentId: params.documentId,
    ...(params.uploadedByUserId ? { uploadedByUserId: params.uploadedByUserId } : {}),
    ...(uploadedAt ? { uploadedAt } : {}),
    fileName: params.fileName,
    contentType: params.contentType,
    sizeBytes: params.sizeBytes,
    storageKey: params.storageKey,
  };
}

export function buildDocumentDeletedPayload(params: {
  documentId: string;
  deletedByUserId?: string;
  deletedAt?: string | Date;
  reason?: string;
}): Record<string, unknown> {
  const deletedAt = toIsoString(params.deletedAt);

  return {
    documentId: params.documentId,
    ...(params.deletedByUserId ? { deletedByUserId: params.deletedByUserId } : {}),
    ...(deletedAt ? { deletedAt } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}

