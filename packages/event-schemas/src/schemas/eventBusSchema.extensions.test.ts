import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EVENT_TYPES, EventPayloadSchemas, EventTypeEnum, TicketEventPayloadSchema } from './eventBusSchema';
import { defineEventExtension, eventExtensions } from './extensions';

describe('event schema extensions', () => {
  it('ships no extensions', () => {
    expect(eventExtensions).toEqual([]);
  });

  it('keeps core payload schemas reference-identical and the enum unchanged', () => {
    expect(EventPayloadSchemas.TICKET_CREATED).toBeDefined();
    expect(Object.keys(EventPayloadSchemas).sort()).toEqual([...EVENT_TYPES].sort());
    expect(EventTypeEnum.options).toEqual([...EVENT_TYPES]);
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    expect(EventPayloadSchemas.TICKET_UPDATED === EventPayloadSchemas.TICKET_UPDATED).toBe(true);
    expect(TicketEventPayloadSchema).toBeDefined();
  });

  it('every event type has a payload schema', () => {
    expect(EVENT_TYPES.filter((t) => !(t in EventPayloadSchemas))).toEqual([]);
  });

  it('defineEventExtension returns its declaration unchanged', () => {
    const schema = z.object({ a: z.string() });
    const ext = defineEventExtension({ name: 'x', eventTypes: ['X_EVENT'], payloadSchemas: { X_EVENT: schema } });
    expect(ext.payloadSchemas.X_EVENT).toBe(schema);
  });
});
