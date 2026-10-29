import type { Knex } from 'knex';
import type { IUser, IOnlineMeetingView } from '@alga-psa/types';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

/** Authenticated home identity; structurally identical to the scheduling seam's actor. */
export type InteractionActor =
  | { kind: 'session'; tenant: string; userId: string; sessionId: string }
  | { kind: 'api_key'; tenant: string; userId: string; apiKeyId: string };
export type InteractionIdentify = () => Promise<InteractionActor>;

type Hit<T> = { handled: false } | ({ handled: true } & T);

export type InteractionEventPublisher = (event: {
  eventType: 'INTERACTION_CREATED' | 'INTERACTION_UPDATED' | 'INTERACTION_DELETED';
  payload: Record<string, unknown> & { tenantId: string; interactionId: string };
}) => Promise<unknown>;

export interface SharedWorkInteractionProvider {
  readInteractions(db: Knex, tenant: string, identify: InteractionIdentify, options: {
    id?: string; filters?: Record<string, any>;
    entity?: { id: string; type: 'client' | 'contact' | 'ticket' }; paginated?: boolean;
  }): Promise<Hit<{ interactions: any[]; total: number; page: number; pageSize: number }>>;
  readInteractionMeeting(db: Knex, tenant: string, interactionId: string, identify: InteractionIdentify
  ): Promise<Hit<{ meeting: IOnlineMeetingView | null }>>;
  createInteraction(db: Knex, tenant: string, data: Record<string, any>, identify: InteractionIdentify,
    publish: InteractionEventPublisher): Promise<Hit<{ interaction: any }>>;
  updateInteraction(db: Knex, tenant: string, id: string, data: Record<string, any>, identify: InteractionIdentify,
    publish: InteractionEventPublisher): Promise<Hit<{ interaction: any }>>;
  deleteInteraction(db: Knex, tenant: string, id: string, identify: InteractionIdentify,
    publish: InteractionEventPublisher): Promise<Hit<{}>>;
}

// LEVERAGE: pattern shared-work-seam — scheduling, clients and documents each declare one seam over the same generic registry.
export const interactionSeam = sharedWorkSeam<SharedWorkInteractionProvider>('interaction');

class InteractionForbiddenError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() { super('This shared resource is not available for the requested operation.'); this.name = 'CoManagedSharedWorkError'; }
}

/** Matches the provider's error by discriminator; native code never imports @alga-psa/co-managed. */
export function isInteractionForbidden(error: unknown): boolean {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  return !!candidate && typeof candidate === 'object' && candidate.name === 'CoManagedSharedWorkError' && candidate.code === 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
}

export function isInteractionCommandError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'NativeInteractionCommandError';
}

export async function resolveInteractionBrowserActor(user: IUser, tenant: string): Promise<InteractionActor> {
  // LEVERAGE: pattern shared-work-browser-actor — scheduling, clients and documents each resolve this same tracked browser identity; the packages cannot import one another.
  const session = await getSession();
  if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new InteractionForbiddenError();
  return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
}

/** After-commit event publication for provider commands; a failed search event never fails the write. */
export const publishInteractionEvent: InteractionEventPublisher = async event => {
  try {
    await publishEvent({ eventType: event.eventType, payload: { ...event.payload, timestamp: new Date().toISOString() } });
  } catch (eventError) {
    console.error(`[coManagedInteractionReader] Failed to publish ${event.eventType} event:`, eventError);
  }
};
