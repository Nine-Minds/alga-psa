import type { z } from 'zod';

/** Extension declaration helpers. Split from `index.ts` so extension modules can import them without a cycle. */
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
