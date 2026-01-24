import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import { documentGeneratedEventPayloadSchema } from '../../../runtime/schemas/documentEventSchemas';
import { buildDocumentGeneratedPayload } from '../documentGeneratedEventBuilders';

describe('documentGeneratedEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const documentId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const sourceId = 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2';
  const occurredAt = '2026-01-24T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds DOCUMENT_GENERATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildDocumentGeneratedPayload({
        documentId,
        sourceType: 'invoice',
        sourceId,
        fileName: 'invoice_123.pdf',
        generatedByUserId: actorUserId,
        generatedAt: occurredAt,
      }),
      ctx
    );

    expect(documentGeneratedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

