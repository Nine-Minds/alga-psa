import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import type { BundleAfterCommitPublication } from '../actions/ticketBundleUtils';

/** Publishes one catalogued event whose payload came from a registered builder. */
export type BundleEventPublisher = <T extends WorkflowCatalogEventType>(event: {
  eventType: T;
  payload: BuiltWorkflowPayload<T>;
  eventName?: string;
  fromState?: string;
  toState?: string;
  idempotencyKey?: string;
}) => Promise<void>;

/**
 * Hands a bundle publication to `publish`. A switch (one case per event type) because a union of
 * branded payloads cannot be passed through one generic call without losing the brand. Shared by
 * the server actions and the REST service so the two paths publish the same events.
 */
export function publishBundleAfterCommitPublication(
  publication: BundleAfterCommitPublication,
  publish: BundleEventPublisher
): Promise<void> {
  // LEVERAGE: friction brand-union-dispatch — publishing a union of branded events needs a per-member switch.
  switch (publication.eventType) {
    case 'TICKET_MERGED':
      return publish(publication);
    case 'TICKET_CLOSED':
      return publish(publication);
    case 'TICKET_STATUS_CHANGED':
      return publish(publication);
    case 'TICKET_UPDATED':
      return publish(publication);
    case 'TICKET_REOPENED':
      return publish(publication);
    case 'TICKET_SLA_STAGE_ENTERED':
      return publish(publication);
    case 'TICKET_SLA_STAGE_MET':
      return publish(publication);
    case 'TICKET_SLA_STAGE_BREACHED':
      return publish(publication);
  }
}
