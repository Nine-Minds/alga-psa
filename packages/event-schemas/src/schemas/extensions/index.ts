import type { EventPayloadExtension } from './define';
import { coManagedRoutingExtension } from './coManagedRouting';

/**
 * Event-type extension point. An extension declares its event type names and one
 * payload schema per name with `defineEventExtension`, in its own module; adding
 * it is one entry in `eventExtensions` below. `eventBusSchema.ts` composes the
 * extensions after the core set, and both the `EventType` union and the
 * `EventPayloadSchemas` type widen from that entry alone.
 *
 * Extensions add events; they never replace one. A name that collides with a core
 * event type, or with another extension, fails `tsc` (see `eventBusSchema.ts`)
 * and throws at module load (`assertEventExtensionsCompose`).
 *
 * The core values are never changed: `EVENT_TYPES` is the core list followed by the extension events
 * (co-managed routing, CM L5), and every core `EventPayloadSchemas` entry is reference-identical.
 *
 * This module must not import `eventBusSchema.ts` (that file imports this one).
 */
export { defineEventExtension, type EventPayloadExtension } from './define';

/** The composition point: one entry per extension module. */
export const eventExtensions = [coManagedRoutingExtension] as const satisfies readonly EventPayloadExtension[];

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void
  ? I
  : never;

/** Event type names declared by a tuple of extensions. */
export type ExtensionEventTypeOf<TExtensions extends readonly EventPayloadExtension[]> = EventTypesOf<
  TExtensions[number]
>;

// Distributes over the union of extensions; `never` (no extensions) stays `never`.
type EventTypesOf<E> = E extends { readonly eventTypes: readonly (infer T)[] } ? T : never;

/** Payload schemas keyed by event type for a tuple of extensions. */
export type ExtensionPayloadSchemasOf<TExtensions extends readonly EventPayloadExtension[]> = [
  TExtensions[number],
] extends [never]
  ? Record<never, never>
  : UnionToIntersection<TExtensions[number]['payloadSchemas']>;

/** Every registered extension event type name (never natively). */
export type ExtensionEventType = ExtensionEventTypeOf<typeof eventExtensions>;

/** Registered extension payload schemas (empty natively). */
export type ExtensionPayloadSchemas = ExtensionPayloadSchemasOf<typeof eventExtensions>;

/** The composed result of a tuple of extensions, typed from that tuple. */
export interface ComposedEventExtensions<TExtensions extends readonly EventPayloadExtension[]> {
  readonly eventTypes: readonly ExtensionEventTypeOf<TExtensions>[];
  readonly payloadSchemas: ExtensionPayloadSchemasOf<TExtensions>;
}

/**
 * Compose extensions into one event-type list and one payload map. This is what
 * builds EXTENSION_EVENT_TYPES and EXTENSION_PAYLOAD_SCHEMAS below. Each extension
 * only carries its own payload schemas, so the list is held as
 * `EventPayloadExtension<string>[]`; the result types come from the tuple itself.
 */
export function composeEventExtensions<const TExtensions extends readonly EventPayloadExtension[]>(
  extensions: TExtensions,
): ComposedEventExtensions<TExtensions> {
  const list: readonly EventPayloadExtension<string>[] = extensions;
  // TS cannot relate a runtime flatMap/Object.assign to the conditional types over a
  // generic tuple; both result types are derived from that same tuple, and
  // assertEventExtensionsCompose guarantees the payload keys are disjoint.
  return {
    eventTypes: list.flatMap((e) => e.eventTypes) as readonly string[] as unknown as readonly ExtensionEventTypeOf<TExtensions>[],
    payloadSchemas: Object.assign({}, ...list.map((e) => e.payloadSchemas)) as ExtensionPayloadSchemasOf<TExtensions>,
  };
}

const registered: readonly EventPayloadExtension<string>[] = eventExtensions;
const composed = composeEventExtensions(eventExtensions);

export const EXTENSION_EVENT_TYPES: readonly ExtensionEventType[] = composed.eventTypes;

export const EXTENSION_PAYLOAD_SCHEMAS: ExtensionPayloadSchemas = composed.payloadSchemas;

/**
 * Throws when an extension event type collides with a core event type or with
 * another extension. Called by `eventBusSchema.ts` before it composes, so an
 * extension can never silently replace a core payload schema.
 */
export function assertEventExtensionsCompose(
  coreEventTypes: readonly string[],
  extensions: readonly EventPayloadExtension[] = registered,
): void {
  const owner = new Map<string, string>(coreEventTypes.map((t) => [t, 'core']));
  for (const extension of extensions) {
    for (const eventType of extension.eventTypes) {
      const existing = owner.get(eventType);
      if (existing) {
        throw new Error(
          `[eventExtensions] ${extension.name} redeclares ${eventType}, already owned by ${existing}`,
        );
      }
      owner.set(eventType, extension.name);
    }
  }
}

