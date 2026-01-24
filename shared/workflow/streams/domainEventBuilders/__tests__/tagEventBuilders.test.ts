import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  tagAppliedEventPayloadSchema,
  tagDefinitionCreatedEventPayloadSchema,
  tagDefinitionUpdatedEventPayloadSchema,
  tagRemovedEventPayloadSchema,
} from '../../../runtime/schemas/crmEventSchemas';
import {
  buildTagAppliedPayload,
  buildTagDefinitionCreatedPayload,
  buildTagDefinitionUpdatedPayload,
  buildTagRemovedPayload,
} from '../tagEventBuilders';

describe('tagEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const occurredAt = '2026-01-23T12:00:00.000Z';
  const tagId = '2f8f7d42-4f9a-4f0c-915f-0e4b174e6e9c';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds TAG_DEFINITION_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildTagDefinitionCreatedPayload({
        tagId,
        tagName: 'VIP',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
      }),
      ctx
    );

    expect(tagDefinitionCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds TAG_DEFINITION_UPDATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildTagDefinitionUpdatedPayload({
        tagId,
        previousName: 'Old Name',
        newName: 'New Name',
        updatedByUserId: actorUserId,
        updatedAt: occurredAt,
      }),
      ctx
    );

    expect(tagDefinitionUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds TAG_APPLIED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildTagAppliedPayload({
        tagId,
        entityType: 'client',
        entityId: 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2',
        appliedByUserId: actorUserId,
        appliedAt: occurredAt,
      }),
      ctx
    );

    expect(tagAppliedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds TAG_REMOVED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildTagRemovedPayload({
        tagId,
        entityType: 'client',
        entityId: 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2',
        removedByUserId: actorUserId,
        removedAt: occurredAt,
      }),
      ctx
    );

    expect(tagRemovedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

