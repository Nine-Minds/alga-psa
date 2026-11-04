/**
 * Compile-time proofs for the publish API (never executed; included by `tsc --noEmit` via
 * tsconfig `src/**`). Every `@ts-expect-error` below must stay an error: if the narrowing regresses,
 * the directive becomes unused and typecheck fails.
 */
import { builtWorkflowPayload } from '@alga-psa/event-schemas';
import {
  publishBuiltWorkflowPayload,
  publishNonCatalogEventByName,
  publishEvent,
  publishNonCatalogWorkflowEvent,
  publishWorkflowEvent,
  type WorkflowEventPublishContext,
} from './index';

declare const ctx: WorkflowEventPublishContext;
declare const payload: Record<string, unknown>;
const built = builtWorkflowPayload('TICKET_CREATED', {});

export async function publishTypeProofs(): Promise<void> {
  // --- publishWorkflowEvent only takes catalogued event types ---
  await publishWorkflowEvent({ eventType: 'TICKET_CREATED', payload: built, ctx });
  // @ts-expect-error an inline / unbuilt payload is rejected
  await publishWorkflowEvent({ eventType: 'TICKET_CREATED', payload, ctx });
  // @ts-expect-error a payload built for another event type is rejected
  await publishWorkflowEvent({ eventType: 'TICKET_UPDATED', payload: built, ctx });
  // @ts-expect-error USER_CREATED has no workflow catalog entry
  await publishWorkflowEvent({ eventType: 'USER_CREATED', payload: built, ctx });
  // @ts-expect-error not an event type at all
  await publishWorkflowEvent({ eventType: 'NOT_AN_EVENT', payload: built, ctx });
  // @ts-expect-error a plain string is not a catalogued event type
  await publishWorkflowEvent({ eventType: 'TICKET_CREATED' as string, payload: built, ctx });

  // --- publishEvent only takes NON-catalogued event types ---
  await publishEvent({ eventType: 'USER_CREATED', payload });
  // @ts-expect-error TICKET_CREATED is catalogued: build it and use publishWorkflowEvent
  await publishEvent({ eventType: 'TICKET_CREATED', payload });
  // @ts-expect-error not an event type at all
  await publishEvent({ eventType: 'PLACEHOLDER', payload: {} });

  // --- already-built payload path is still catalog-only ---
  await publishBuiltWorkflowPayload({ eventType: 'TICKET_CREATED', payload: built });
  // @ts-expect-error USER_CREATED is not catalogued
  await publishBuiltWorkflowPayload({ eventType: 'USER_CREATED', payload: built });
  // @ts-expect-error a raw payload is not a built payload
  await publishBuiltWorkflowPayload({ eventType: 'TICKET_CREATED', payload });

  // --- by-name publish is for non-catalogued types only (catalogued types are runtime-rejected) ---
  await publishNonCatalogEventByName({ eventType: 'USER_CREATED', payload });

  // --- non-catalog workflow publish rejects catalogued types ---
  await publishNonCatalogWorkflowEvent({ eventType: 'USER_CREATED', payload, ctx });
  // @ts-expect-error TICKET_CREATED is catalogued: use publishWorkflowEvent
  await publishNonCatalogWorkflowEvent({ eventType: 'TICKET_CREATED', payload, ctx });
}
