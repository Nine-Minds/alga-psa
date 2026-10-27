import type { z } from 'zod';

/**
 * Event-type extension point. An extension contributes event type names and
 * their payload schemas; `eventBusSchema.ts` composes them after the core set.
 * The list is empty in the native build, so `EVENT_TYPES` and
 * `EventPayloadSchemas` are exactly the core values.
 *
 * This module must not import `eventBusSchema.ts` (that file imports this one).
 */
export interface EventPayloadExtension<
  TPayloads extends Readonly<Record<string, z.ZodTypeAny>> = Readonly<Record<string, z.ZodTypeAny>>,
> {
  readonly name: string;
  readonly eventTypes: readonly string[];
  readonly payloadSchemas: TPayloads;
}

export function defineEventExtension<const TPayloads extends Readonly<Record<string, z.ZodTypeAny>>>(
  extension: EventPayloadExtension<TPayloads>,
): EventPayloadExtension<TPayloads> {
  return extension;
}

export const eventExtensions: readonly EventPayloadExtension[] = [];

// Derived from `eventExtensions`. Typed as empty so the composed `EventType` stays
// the core union; a build that registers extensions widens these two types.
export const EXTENSION_EVENT_TYPES = eventExtensions.flatMap((e) => e.eventTypes) as unknown as readonly [];

export const EXTENSION_PAYLOAD_SCHEMAS = Object.assign({}, ...eventExtensions.map((e) => e.payloadSchemas)) as Record<never, never>;
