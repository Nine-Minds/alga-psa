import type {
  FileUploadedEventPayload,
  MediaProcessingFailedEventPayload,
  MediaProcessingSucceededEventPayload,
} from '../../runtime/schemas/assetMediaEventSchemas';

export function buildFileUploadedPayload(params: {
  fileId: string;
  uploadedByUserId?: string;
  uploadedAt?: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
}): Omit<FileUploadedEventPayload, 'tenantId' | 'occurredAt' | 'actorUserId' | 'actorContactId' | 'actorType'> {
  return {
    fileId: params.fileId,
    uploadedByUserId: params.uploadedByUserId,
    uploadedAt: params.uploadedAt,
    fileName: params.fileName,
    contentType: params.contentType,
    sizeBytes: params.sizeBytes,
    storageKey: params.storageKey,
  };
}

export function buildMediaProcessingSucceededPayload(params: {
  fileId: string;
  processedAt?: string;
  outputs?: unknown[];
  durationMs?: number;
}): Omit<
  MediaProcessingSucceededEventPayload,
  'tenantId' | 'occurredAt' | 'actorUserId' | 'actorContactId' | 'actorType'
> {
  return {
    fileId: params.fileId,
    processedAt: params.processedAt,
    outputs: params.outputs,
    durationMs: params.durationMs,
  };
}

export function buildMediaProcessingFailedPayload(params: {
  fileId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
}): Omit<MediaProcessingFailedEventPayload, 'tenantId' | 'occurredAt' | 'actorUserId' | 'actorContactId' | 'actorType'> {
  return {
    fileId: params.fileId,
    failedAt: params.failedAt,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    retryable: params.retryable,
  };
}

