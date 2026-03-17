function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

function toNonNegativeInt(value: number | string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

export function buildDocumentUploadedPayload(params: {
  documentId: string;
  uploadedByUserId?: string;
  uploadedAt?: string | Date;
  fileName: string;
  contentType: string;
  sizeBytes: number | string;
  storageKey: string;
}): Record<string, unknown> {
  const uploadedAt = toIsoString(params.uploadedAt);

  return {
    documentId: params.documentId,
    ...(params.uploadedByUserId ? { uploadedByUserId: params.uploadedByUserId } : {}),
    ...(uploadedAt ? { uploadedAt } : {}),
    fileName: params.fileName,
    contentType: params.contentType,
    sizeBytes: toNonNegativeInt(params.sizeBytes),
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

export function buildFileUploadedPayload(params: {
  fileId: string;
  uploadedByUserId?: string;
  uploadedAt?: string | Date;
  fileName: string;
  contentType: string;
  sizeBytes: number | string;
  storageKey: string;
}): Record<string, unknown> {
  const uploadedAt = toIsoString(params.uploadedAt);

  return {
    fileId: params.fileId,
    uploadedByUserId: params.uploadedByUserId,
    uploadedAt,
    fileName: params.fileName,
    contentType: params.contentType,
    sizeBytes: toNonNegativeInt(params.sizeBytes),
    storageKey: params.storageKey,
  };
}

export function buildMediaProcessingSucceededPayload(params: {
  fileId: string;
  processedAt?: string;
  outputs?: unknown[];
  durationMs?: number;
}): Record<string, unknown> {
  return {
    fileId: params.fileId,
    processedAt: params.processedAt,
    outputs: params.outputs,
    durationMs: params.durationMs,
  };
}
