import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime';
import { workflowEventPayloadSchemas } from '@shared/workflow/runtime/schemas/workflowEventPayloadSchemas';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';

describe('workflow event simulator schemas', () => {
  it('exports JSON schema for every registered workflow event payload schema', () => {
    initializeWorkflowRuntimeV2();
    const registry = getSchemaRegistry();

    const refs = Object.keys(workflowEventPayloadSchemas);
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      expect(ref.startsWith('payload.')).toBe(true);
      expect(ref.endsWith('.v1')).toBe(true);
      expect(registry.has(ref)).toBe(true);

      const jsonSchema = registry.toJsonSchema(ref) as any;
      expect(jsonSchema).toBeTruthy();
      expect(typeof jsonSchema).toBe('object');
      expect(
        Boolean(
          jsonSchema.type ||
          jsonSchema.$ref ||
          jsonSchema.properties ||
          jsonSchema.anyOf ||
          jsonSchema.oneOf ||
          jsonSchema.allOf
        )
      ).toBe(true);
    }
  });

  it('schema validation fails for invalid event payloads and succeeds for valid ones', () => {
    initializeWorkflowRuntimeV2();
    const registry = getSchemaRegistry();
    const ref = 'payload.TicketCreated.v1';

    expect(registry.has(ref)).toBe(true);
    const schema = registry.get(ref);

    const tenantId = uuidv4();
    const actorUserId = uuidv4();
    const now = new Date().toISOString();

    const invalid = buildWorkflowPayload({}, { tenantId, occurredAt: now, actor: { actorType: 'USER', actorUserId } });
    expect(schema.safeParse(invalid).success).toBe(false);

    const valid = buildWorkflowPayload(
      { ticketId: uuidv4() },
      { tenantId, occurredAt: now, actor: { actorType: 'USER', actorUserId } }
    );
    expect(schema.safeParse(valid).success).toBe(true);
  });
});
