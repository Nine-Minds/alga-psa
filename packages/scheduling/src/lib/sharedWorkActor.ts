import type { IUser } from '@alga-psa/types';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildScheduleEntryCreatedPayload,
  buildScheduleEntryDeletedPayload,
  buildScheduleEntryUpdatedPayload,
} from '@alga-psa/workflow-streams';
import type { ScheduleEventPublisher, SharedWorkActor } from './sharedWorkScheduling';

/**
 * Same shape and discriminators as the co-managed package's CoManagedSharedWorkError. Native code
 * never imports that package, so it is matched by `name`/`code` (see isSharedWorkForbidden).
 */
export class SharedWorkForbiddenError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() {
    super('This shared resource is not available for the requested operation.');
    this.name = 'CoManagedSharedWorkError';
  }
}

export function isSharedWorkForbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'CoManagedSharedWorkError' && candidate.code === 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
}

/** The tracked browser session behind a server action; API-key overrides are never a browser actor. */
export async function resolveSharedWorkBrowserActor(user: IUser, tenant: string): Promise<SharedWorkActor> {
  // LEVERAGE: pattern shared-work-browser-actor — scheduling, clients and documents each resolve this same tracked browser identity; the packages cannot import one another.
  const session = await getSession();
  if (getApiKeyUserOverride() || !session?.session_id || session.user?.tenant !== tenant
    || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') throw new SharedWorkForbiddenError();
  return { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id };
}

/**
 * Provider commands hand back plain `{ eventType, payload }` records after commit. They go through
 * the same typed builders the native schedule actions use.
 */
export const publishScheduleEvent: ScheduleEventPublisher = async event => {
  const { tenantId, userId, entryId } = event.payload;
  const ctx = { tenantId, actor: { actorType: 'USER' as const, actorUserId: userId } };
  if (event.eventType === 'SCHEDULE_ENTRY_CREATED') {
    await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_CREATED', payload: buildScheduleEntryCreatedPayload({ userId, entryId }), ctx });
  } else if (event.eventType === 'SCHEDULE_ENTRY_UPDATED') {
    await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: buildScheduleEntryUpdatedPayload({ userId, entryId }), ctx });
  } else {
    await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_DELETED', payload: buildScheduleEntryDeletedPayload({ userId, entryId }), ctx });
  }
};
