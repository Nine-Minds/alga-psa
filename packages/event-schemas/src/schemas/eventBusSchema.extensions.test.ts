import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  CorePayloadSchemas,
  EVENT_TYPES,
  EventPayloadSchemas,
  EventTypeEnum,
  TicketEventPayloadSchema,
  type EventType,
} from './eventBusSchema';
import {
  EXTENSION_EVENT_TYPES,
  EXTENSION_PAYLOAD_SCHEMAS,
  assertEventExtensionsCompose,
  defineEventExtension,
  eventExtensions,
  type ExtensionEventType,
  type ExtensionEventTypeOf,
  type ExtensionPayloadSchemasOf,
} from './extensions';

describe('event schema extensions', () => {
  it('ships no extensions', () => {
    expect(eventExtensions).toEqual([]);
    expect(EXTENSION_EVENT_TYPES).toEqual([]);
    expect(Object.keys(EXTENSION_PAYLOAD_SCHEMAS)).toEqual([]);
    expectTypeOf<ExtensionEventType>().toBeNever();
  });

  it('keeps core payload schemas reference-identical and the enum unchanged', () => {
    // The composed map hands out the same schema objects the core declares.
    expect(EventPayloadSchemas).not.toBe(CorePayloadSchemas);
    for (const [eventType, schema] of Object.entries(CorePayloadSchemas)) {
      expect(EventPayloadSchemas[eventType as keyof typeof EventPayloadSchemas], eventType).toBe(schema);
    }
    expect(EventPayloadSchemas.TICKET_COMMENT_ADDED).toBe(TicketEventPayloadSchema);
    expect(Object.keys(EventPayloadSchemas).sort()).toEqual([...EVENT_TYPES].sort());
    expect(EventTypeEnum.options).toEqual([...EVENT_TYPES]);
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it('every event type has a payload schema', () => {
    expect(EVENT_TYPES.filter((t: string) => !(t in EventPayloadSchemas))).toEqual([]);
  });

  it('defineEventExtension returns its declaration unchanged', () => {
    const schema = z.object({ a: z.string() });
    const ext = defineEventExtension({ name: 'x', eventTypes: ['X_EVENT'], payloadSchemas: { X_EVENT: schema } });
    expect(ext.payloadSchemas.X_EVENT).toBe(schema);
  });

  it('defineEventExtension rejects payload keys that do not match the event types', () => {
    const schema = z.object({});
    expect(() =>
      // @ts-expect-error X_TWO has no payload schema
      defineEventExtension({ name: 'x', eventTypes: ['X_ONE', 'X_TWO'], payloadSchemas: { X_ONE: schema } }),
    ).toThrow('missing X_TWO');
    expect(() =>
      // @ts-expect-error X_STRAY is not a declared event type
      defineEventExtension({ name: 'x', eventTypes: ['X_ONE'], payloadSchemas: { X_ONE: schema, X_STRAY: schema } }),
    ).toThrow('undeclared X_STRAY');
  });

  it('an extension cannot redeclare a core event type or another extension', () => {
    const schema = z.object({});
    const core = defineEventExtension({ name: 'shadow', eventTypes: ['TICKET_CREATED'], payloadSchemas: { TICKET_CREATED: schema } });
    expect(() => assertEventExtensionsCompose(EVENT_TYPES, [core])).toThrow('shadow redeclares TICKET_CREATED, already owned by core');
    const a = defineEventExtension({ name: 'a', eventTypes: ['X_SHARED'], payloadSchemas: { X_SHARED: schema } });
    const b = defineEventExtension({ name: 'b', eventTypes: ['X_SHARED'], payloadSchemas: { X_SHARED: schema } });
    expect(() => assertEventExtensionsCompose(EVENT_TYPES, [a, b])).toThrow('b redeclares X_SHARED, already owned by a');
    expect(() => assertEventExtensionsCompose(EVENT_TYPES, [a])).not.toThrow();
  });

  it('types: a registered tuple widens the event type union and the payload map', () => {
    const one = z.object({ one: z.string() });
    const two = z.object({ two: z.number() });
    const exts = [
      defineEventExtension({ name: 'p', eventTypes: ['P_ONE'], payloadSchemas: { P_ONE: one } }),
      defineEventExtension({ name: 'q', eventTypes: ['Q_TWO'], payloadSchemas: { Q_TWO: two } }),
    ] as const;
    expectTypeOf<ExtensionEventTypeOf<typeof exts>>().toEqualTypeOf<'P_ONE' | 'Q_TWO'>();
    expectTypeOf<ExtensionPayloadSchemasOf<typeof exts>>().toMatchTypeOf<{ P_ONE: typeof one; Q_TWO: typeof two }>();
    expectTypeOf<ExtensionEventTypeOf<readonly []>>().toBeNever();
    expectTypeOf<'TICKET_CREATED'>().toMatchTypeOf<EventType>();
  });
});
