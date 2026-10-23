import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

import type {
  FileUploadedEventPayload,
  MediaProcessingFailedEventPayload,
  MediaProcessingSucceededEventPayload,
} from '@alga-psa/event-schemas';

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

export function buildFileUploadedPayload(params: {
  fileId: string;
  uploadedByUserId?: string;
  uploadedAt?: string | Date;
  fileName: string;
  contentType: string;
  sizeBytes: number | string;
  storageKey: string;
}): Omit<FileUploadedEventPayload, 'tenantId' | 'occurredAt' | 'actorUserId' | 'actorContactId' | 'actorType'> &
  BuiltWorkflowPayload<'FILE_UPLOADED'> {
  const uploadedAt = toIsoString(params.uploadedAt);

  return builtWorkflowPayload('FILE_UPLOADED', {
    fileId: params.fileId,
    uploadedByUserId: params.uploadedByUserId,
    uploadedAt,
    fileName: params.fileName,
    contentType: params.contentType,
    sizeBytes: toNonNegativeInt(params.sizeBytes),
    storageKey: params.storageKey,
  });
}

export function buildMediaProcessingSucceededPayload(params: {
  fileId: string;
  processedAt?: string;
  outputs?: unknown[];
  durationMs?: number;
}): Omit<
  MediaProcessingSucceededEventPayload,
  'tenantId' | 'occurredAt' | 'actorUserId' | 'actorContactId' | 'actorType'
> &
  BuiltWorkflowPayload<'MEDIA_PROCESSING_SUCCEEDED'> {
  return builtWorkflowPayload('MEDIA_PROCESSING_SUCCEEDED', {
    fileId: params.fileId,
    processedAt: params.processedAt,
    outputs: params.outputs,
    durationMs: params.durationMs,
  });
}

export function buildMediaProcessingFailedPayload(params: {
  fileId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
}): Omit<MediaProcessingFailedEventPayload, 'tenantId' | 'occurredAt' | 'actorUserId' | 'actorContactId' | 'actorType'> &
  BuiltWorkflowPayload<'MEDIA_PROCESSING_FAILED'> {
  return builtWorkflowPayload('MEDIA_PROCESSING_FAILED', {
    fileId: params.fileId,
    failedAt: params.failedAt,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    retryable: params.retryable,
  });
}
