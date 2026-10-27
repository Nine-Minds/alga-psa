import type { z } from 'zod';

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
 * The list is empty in the native build, so `EVENT_TYPES` and every
 * `EventPayloadSchemas` entry are exactly the core values.
 *
 * This module must not import `eventBusSchema.ts` (that file imports this one).
 */
export interface EventPayloadExtension<
  TEventType extends string = string,
  TPayloads extends { readonly [K in TEventType]: z.ZodTypeAny } = { readonly [K in TEventType]: z.ZodTypeAny },
> {
  readonly name: string;
  readonly eventTypes: readonly [TEventType, ...TEventType[]];
  readonly payloadSchemas: TPayloads;
}

/**
 * Declare an extension. Payload keys must be exactly the declared event types:
 * a missing schema or a stray key is a type error and a runtime error.
 */
export function defineEventExtension<
  const TEventType extends string,
  const TPayloads extends { readonly [K in TEventType]: z.ZodTypeAny },
>(
  extension: EventPayloadExtension<TEventType, TPayloads> & {
    readonly payloadSchemas: TPayloads & { readonly [K in Exclude<keyof TPayloads, TEventType>]: never };
  },
): EventPayloadExtension<TEventType, TPayloads> {
  const declared = new Set<string>(extension.eventTypes);
  if (declared.size !== extension.eventTypes.length) {
    throw new Error(`[eventExtensions] ${extension.name}: duplicate event type in eventTypes`);
  }
  const keys = Object.keys(extension.payloadSchemas);
  const missing = extension.eventTypes.filter((t) => !keys.includes(t));
  const stray = keys.filter((k) => !declared.has(k));
  if (missing.length || stray.length) {
    throw new Error(
      `[eventExtensions] ${extension.name}: payloadSchemas must match eventTypes` +
        (missing.length ? `; missing ${missing.join(', ')}` : '') +
        (stray.length ? `; undeclared ${stray.join(', ')}` : ''),
    );
  }
  return extension;
}

/** The composition point: one entry per extension module. Empty natively. */
export const eventExtensions = [] as const satisfies readonly EventPayloadExtension[];

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

const registered: readonly EventPayloadExtension<ExtensionEventType>[] = eventExtensions;

export const EXTENSION_EVENT_TYPES: readonly ExtensionEventType[] = registered.flatMap((e) => e.eventTypes);

// Object.assign over a runtime list cannot express the intersection; the type is
// derived from the same tuple, and assertEventExtensionsCompose guarantees disjoint keys.
export const EXTENSION_PAYLOAD_SCHEMAS = Object.assign(
  {},
  ...registered.map((e) => e.payloadSchemas),
) as ExtensionPayloadSchemas;

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
