import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  fileUploadedEventPayloadSchema,
  mediaProcessingFailedEventPayloadSchema,
  mediaProcessingSucceededEventPayloadSchema,
} from '../../../runtime/schemas/assetMediaEventSchemas';
import {
  buildFileUploadedPayload,
  buildMediaProcessingFailedPayload,
  buildMediaProcessingSucceededPayload,
} from '../mediaEventBuilders';

describe('mediaEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const fileId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const occurredAt = '2026-01-24T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds FILE_UPLOADED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildFileUploadedPayload({
        fileId,
        uploadedByUserId: actorUserId,
        uploadedAt: occurredAt,
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1234,
        storageKey: 'tenant/files/invoice.pdf',
      }),
      ctx
    );

    expect(fileUploadedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds MEDIA_PROCESSING_SUCCEEDED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildMediaProcessingSucceededPayload({
        fileId,
        processedAt: occurredAt,
        outputs: [{ type: 'thumbnail', fileId: 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2' }],
        durationMs: 42,
      }),
      ctx
    );

    expect(mediaProcessingSucceededEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds MEDIA_PROCESSING_FAILED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildMediaProcessingFailedPayload({
        fileId,
        failedAt: occurredAt,
        errorCode: 'PREVIEW_GENERATION_FAILED',
        errorMessage: 'sharp not installed',
        retryable: true,
      }),
      ctx
    );

    expect(mediaProcessingFailedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

