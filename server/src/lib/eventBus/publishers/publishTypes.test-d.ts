/**
 * Compile-time proofs for the server-side publish API (mirror of packages/event-bus) (never executed; included by `tsc --noEmit` via
 * the server tsconfig). Every `@ts-expect-error` below must stay an error: if the narrowing regresses,
 * the directive becomes unused and typecheck fails.
 */
import {
  publishCatalogEventPayload,
  publishEvent,
  publishNonCatalogWorkflowEvent,
  publishWorkflowEvent,
  type WorkflowEventPublishContext,
} from './index';

declare const ctx: WorkflowEventPublishContext;
declare const payload: Record<string, unknown>;

export async function publishTypeProofs(): Promise<void> {
  // --- publishWorkflowEvent only takes catalogued event types ---
  await publishWorkflowEvent({ eventType: 'TICKET_CREATED', payload, ctx });
  // @ts-expect-error USER_CREATED has no workflow catalog entry
  await publishWorkflowEvent({ eventType: 'USER_CREATED', payload, ctx });
  // @ts-expect-error not an event type at all
  await publishWorkflowEvent({ eventType: 'NOT_AN_EVENT', payload, ctx });
  // @ts-expect-error a plain string is not a catalogued event type
  await publishWorkflowEvent({ eventType: 'TICKET_CREATED' as string, payload, ctx });

  // --- publishEvent only takes NON-catalogued event types ---
  await publishEvent({ eventType: 'USER_CREATED', payload });
  // @ts-expect-error TICKET_CREATED is catalogued: build it and use publishWorkflowEvent
  await publishEvent({ eventType: 'TICKET_CREATED', payload });
  // @ts-expect-error not an event type at all
  await publishEvent({ eventType: 'PLACEHOLDER', payload: {} });

  // --- already-built payload path is still catalog-only ---
  await publishCatalogEventPayload({ eventType: 'INVENTORY_COUNT_APPROVED', payload });
  // @ts-expect-error USER_CREATED is not catalogued
  await publishCatalogEventPayload({ eventType: 'USER_CREATED', payload });

  // --- non-catalog workflow publish rejects catalogued types ---
  await publishNonCatalogWorkflowEvent({ eventType: 'USER_CREATED', payload, ctx });
  // @ts-expect-error TICKET_CREATED is catalogued: use publishWorkflowEvent
  await publishNonCatalogWorkflowEvent({ eventType: 'TICKET_CREATED', payload, ctx });
}
