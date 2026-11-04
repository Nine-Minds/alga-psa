import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_EVENT_CATALOG,
  getWorkflowEventSchemaRef,
  isWorkflowCatalogEventType,
  type WorkflowCatalogEventType,
} from './workflowEventCatalog';
import { EVENT_TYPES } from './schemas/eventBusSchema';
import { workflowEventPayloadSchemas } from './schemas/domain/workflowEventPayloadSchemas';

const entries = Object.entries(WORKFLOW_EVENT_CATALOG) as Array<
  [WorkflowCatalogEventType, { schemaRef: string }]
>;

describe('WORKFLOW_EVENT_CATALOG', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s: ref %o resolves in the canonical workflow payload schema map', (eventType, { schemaRef }) => {
    expect(
      Object.prototype.hasOwnProperty.call(workflowEventPayloadSchemas, schemaRef),
      `${eventType} -> ${schemaRef} is not a key of workflowEventPayloadSchemas`
    ).toBe(true);
  });

  it('only contains types that are in EVENT_TYPES', () => {
    const known = new Set<string>(EVENT_TYPES);
    const unknown = entries.map(([eventType]) => eventType).filter((eventType) => !known.has(eventType));
    expect(unknown).toEqual([]);
  });

  it('uses the payload.<Name>.v1 ref shape and never shares a ref between two event types', () => {
    const refs = entries.map(([, { schemaRef }]) => schemaRef);
    for (const ref of refs) expect(ref).toMatch(/^payload\.[A-Za-z0-9]+\.v1$/);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('exposes lookups by event type', () => {
    expect(getWorkflowEventSchemaRef('TICKET_RESPONSE_STATE_CHANGED')).toBe('payload.TicketResponseStateChanged.v1');
    expect(isWorkflowCatalogEventType('TICKET_CREATED')).toBe(true);
    expect(isWorkflowCatalogEventType('NOT_A_REAL_EVENT')).toBe(false);
  });
});
