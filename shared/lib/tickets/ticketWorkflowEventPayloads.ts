/**
 * Pure payload builders for catalogued ticket workflow events.
 *
 * Each builder returns the event-specific part of the payload. The envelope
 * (`tenantId`, `occurredAt`, `actorType`/`actorUserId`/`actorContactId`,
 * `idempotencyKey`) is added by `publishWorkflowEvent` via `buildWorkflowPayload`,
 * so callers pass those through `ctx`, never in the payload.
 *
 * The emitter contract test (server/src/test/unit/workflow-event-contracts) calls
 * these exact functions and validates the result with the schema the workflow
 * worker uses, so a builder that drifts from its registered schema fails CI.
 *
 * Optional inputs are only emitted when defined, so a builder never writes an
 * explicit `undefined` key that a consumer could mistake for a value.
 */

import type { IEventPublisher } from '@alga-psa/types';

export type TicketNotificationSuppression = {
  suppressContactNotifications?: boolean;
  suppressInternalNotifications?: boolean;
};

/** Mirrors `TicketResponseState` in @alga-psa/types (shared cannot import it without a cycle). */
export type TicketResponseStateValue = 'awaiting_client' | 'awaiting_internal' | null;

export type TicketResponseStateTrigger = 'comment' | 'manual' | 'close';

/** Dot-path -> { previous, new } map, as the ticket workflow schemas expect. */
export type TicketChangeMap = Record<string, { old?: unknown; previous?: unknown; new?: unknown; [key: string]: unknown }>;

function withDefined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(fields) as Array<keyof T>) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

function suppressionFields(input: TicketNotificationSuppression): TicketNotificationSuppression {
  return withDefined({
    suppressContactNotifications: input.suppressContactNotifications,
    suppressInternalNotifications: input.suppressInternalNotifications,
  });
}

// ---------------------------------------------------------------------------
// TICKET_RESPONSE_STATE_CHANGED
// ---------------------------------------------------------------------------

/**
 * `previousResponseState` / `newResponseState` are the canonical fields the
 * schema defines. `previousState` / `newState` are kept as legacy aliases for
 * existing consumers. The schema marks the canonical fields optional, so the
 * contract test pins them with `expectFields` (alga0002101 renamed them once and
 * nothing failed).
 */
export function buildTicketResponseStateChangedPayload(input: {
  ticketId: string;
  userId: string | null;
  previousState: TicketResponseStateValue;
  newState: TicketResponseStateValue;
  trigger: TicketResponseStateTrigger;
}) {
  return {
    ticketId: input.ticketId,
    userId: input.userId,
    previousResponseState: input.previousState,
    newResponseState: input.newState,
    previousState: input.previousState,
    newState: input.newState,
    trigger: input.trigger,
  };
}

// ---------------------------------------------------------------------------
// TICKET_CREATED
// ---------------------------------------------------------------------------

export type TicketCreatedExternalLink = {
  link_id?: string;
  entity_type: string;
  entity_id: string;
  system: string;
  external_id: string;
  external_parent_id?: string | null;
  realm?: string | null;
  url?: string | null;
  relationship: string;
};

/** REST API creation (TicketService.create / createFromAsset). */
export function buildApiTicketCreatedPayload(input: {
  ticketId: string;
  userId?: string;
  createdAt: string;
  boardId: string;
  priorityId?: string | null;
  clientId?: string | null;
  externalLinks?: readonly TicketCreatedExternalLink[];
}) {
  return {
    ticketId: input.ticketId,
    userId: input.userId,
    createdByUserId: input.userId,
    createdAt: input.createdAt,
    source: 'api',
    board_id: input.boardId,
    priority_id: input.priorityId,
    client_id: input.clientId,
    ...(input.externalLinks && input.externalLinks.length > 0
      ? {
          externalLinks: input.externalLinks.map((link) => ({
            linkId: link.link_id,
            entityType: link.entity_type,
            entityId: link.entity_id,
            system: link.system,
            externalId: link.external_id,
            externalParentId: link.external_parent_id ?? null,
            realm: link.realm ?? null,
            url: link.url ?? null,
            relationship: link.relationship,
          })),
        }
      : {}),
  };
}

/** RMM alert ticket creation (shared/rmm/alerts/ticketCreatedEvent.ts). */
export function buildRmmTicketCreatedPayload(input: { ticketId: string; source: string }) {
  return { ticketId: input.ticketId, source: input.source };
}

// ---------------------------------------------------------------------------
// TICKET_UPDATED
// ---------------------------------------------------------------------------

export function buildTicketUpdatedPayload(
  input: TicketNotificationSuppression & {
    ticketId: string;
    userId?: string;
    updatedByUserId?: string;
    changes: TicketChangeMap;
  }
) {
  return {
    ticketId: input.ticketId,
    ...withDefined({ userId: input.userId, updatedByUserId: input.updatedByUserId }),
    changes: input.changes,
    ...suppressionFields(input),
  };
}

// ---------------------------------------------------------------------------
// TICKET_CLOSED
// ---------------------------------------------------------------------------

export function buildTicketClosedPayload(
  input: TicketNotificationSuppression & {
    ticketId: string;
    /** Legacy field read by notification subscribers; absent for system closes. */
    userId?: string;
    closedByUserId?: string;
    closedAt: string;
    changes?: TicketChangeMap;
  }
) {
  return {
    ticketId: input.ticketId,
    ...withDefined({ userId: input.userId, closedByUserId: input.closedByUserId }),
    closedAt: input.closedAt,
    ...withDefined({ changes: input.changes }),
    ...suppressionFields(input),
  };
}

// ---------------------------------------------------------------------------
// TICKET_ASSIGNED
// ---------------------------------------------------------------------------

export function buildTicketAssignedPayload(
  input: TicketNotificationSuppression & {
    ticketId: string;
    /** Legacy field: the user being assigned (the notification recipient). */
    userId?: string;
    assignedByUserId?: string;
    previousAssigneeId?: string | null;
    previousAssigneeType?: 'user' | 'team';
    newAssigneeId?: string;
    newAssigneeType?: 'user' | 'team';
    assignedAt?: string;
    changes?: Record<string, unknown>;
    assignedTeamId?: string;
  }
) {
  return {
    ticketId: input.ticketId,
    ...withDefined({
      userId: input.userId,
      assignedTeamId: input.assignedTeamId,
      assignedByUserId: input.assignedByUserId,
      previousAssigneeId: input.previousAssigneeId ?? undefined,
      previousAssigneeType: input.previousAssigneeType,
      newAssigneeId: input.newAssigneeId,
      newAssigneeType: input.newAssigneeType,
      assignedAt: input.assignedAt,
      changes: input.changes,
    }),
    ...suppressionFields(input),
  };
}

/**
 * Team assignment: the ticket keeps `userId` = resolved assignee and records the team in
 * `changes.assigned_team_id` as a `{ old, previous, new }` entry (the v2 schema requires every
 * `changes` value to be an object; it used to be the bare team id, which the worker rejected) and
 * as top-level `assignedTeamId`. Read it back with `readAssignedTeamId`.
 */
export function buildTicketTeamAssignedPayload(
  input: TicketNotificationSuppression & {
    ticketId: string;
    assignedToUserId?: string;
    assignedByUserId: string;
    teamId: string;
  }
) {
  return buildTicketAssignedPayload({
    ticketId: input.ticketId,
    userId: input.assignedToUserId,
    assignedByUserId: input.assignedByUserId,
    changes: { assigned_team_id: { old: null, previous: null, new: input.teamId } },
    assignedTeamId: input.teamId,
    suppressContactNotifications: input.suppressContactNotifications,
    suppressInternalNotifications: input.suppressInternalNotifications,
  });
}

// ---------------------------------------------------------------------------
// TICKET_REOPENED
// ---------------------------------------------------------------------------

/**
 * Client-portal reopen. The v2 schema requires `previousStatusId` and
 * `newStatusId`; the legacy `reopenedByUserId`, `userId` and `changes` fields
 * stay for existing consumers.
 */
export function buildPortalTicketReopenedPayload(input: {
  ticketId: string;
  userId: string;
  previousStatusId: string;
  newStatusId: string;
  reopenedAt: string;
  changes: TicketChangeMap;
}) {
  return {
    ticketId: input.ticketId,
    userId: input.userId,
    reopenedByUserId: input.userId,
    previousStatusId: input.previousStatusId,
    newStatusId: input.newStatusId,
    reopenedAt: input.reopenedAt,
    changes: input.changes,
  };
}

// ---------------------------------------------------------------------------
// TICKET_MERGED / TICKET_SPLIT (bundles)
// ---------------------------------------------------------------------------

export function buildTicketMergedPayload(input: {
  sourceTicketId: string;
  targetTicketId: string;
  mergedAt: string;
  reason: string;
}) {
  return {
    sourceTicketId: input.sourceTicketId,
    targetTicketId: input.targetTicketId,
    mergedAt: input.mergedAt,
    reason: input.reason,
  };
}

export function buildTicketSplitPayload(input: {
  originalTicketId: string;
  newTicketIds: readonly string[];
  splitAt: string;
  reason: string;
}) {
  return {
    originalTicketId: input.originalTicketId,
    newTicketIds: [...input.newTicketIds],
    splitAt: input.splitAt,
    reason: input.reason,
  };
}

// ---------------------------------------------------------------------------
// IEventPublisher adapters (TicketModel -> publisher)
//
// TicketModel hands each adapter a small structured input; each adapter used to
// shape the payload inline. These pure builders are what the adapters publish,
// so the contract test covers them.
// ---------------------------------------------------------------------------

type PublishTicketCreatedInput = Parameters<IEventPublisher['publishTicketCreated']>[0];
type PublishTicketUpdatedInput = Parameters<IEventPublisher['publishTicketUpdated']>[0];
type PublishTicketClosedInput = Parameters<IEventPublisher['publishTicketClosed']>[0];
type PublishTicketAssignedInput = Parameters<IEventPublisher['publishTicketAssigned']>[0];

/**
 * TicketModel.updateTicket knows the row before the update, so it can say what
 * changed. Subscribers (email, internal notification) and the workflow schema
 * read each entry as `{ old, new }` / `{ previous, new }`; TicketModel used to
 * pass the raw update values (`{ title: 'x' }`), which fails `changesSchema`.
 */
export function buildTicketModelChanges(
  before: Record<string, unknown>,
  updateData: Record<string, unknown>
): TicketChangeMap {
  const changes: TicketChangeMap = {};
  for (const [field, value] of Object.entries(updateData)) {
    changes[field] = { old: before[field] ?? null, new: value ?? null };
  }
  return changes;
}

/** TicketModelEventPublisher (envelope supplies tenantId). */
export function buildModelPublisherTicketCreatedPayload(
  data: PublishTicketCreatedInput,
  extras?: Record<string, unknown>
) {
  return withDefined({ ticketId: data.ticketId, userId: data.userId, ...data.metadata, ...extras });
}

export function buildModelPublisherTicketUpdatedPayload(data: PublishTicketUpdatedInput) {
  return withDefined({ ticketId: data.ticketId, userId: data.userId, changes: data.changes, ...data.metadata });
}

export function buildModelPublisherTicketClosedPayload(data: PublishTicketClosedInput) {
  return withDefined({ ticketId: data.ticketId, userId: data.userId, ...data.metadata });
}

export function buildModelPublisherTicketAssignedPayload(data: PublishTicketAssignedInput) {
  return withDefined({ ticketId: data.ticketId, userId: data.userId, assignedByUserId: data.assignedByUserId });
}

/**
 * WorkflowEventPublisher and InboundEmailOutboxEventPublisher publish the same
 * shapes. Both carry `tenantId` in the payload because they publish through the
 * raw event bus (no envelope builder). `userId` falls back to the ticket id when
 * there is no actor, a sentinel older subscribers rely on.
 */
export function buildInboundPublisherTicketCreatedPayload(data: PublishTicketCreatedInput) {
  return {
    tenantId: data.tenantId,
    ticketId: data.ticketId,
    userId: data.userId || data.ticketId,
    ...data.metadata,
  };
}

export function buildInboundPublisherTicketUpdatedPayload(data: PublishTicketUpdatedInput) {
  return {
    tenantId: data.tenantId,
    ticketId: data.ticketId,
    userId: data.userId || data.ticketId,
    changes: data.changes,
    ...data.metadata,
  };
}

export function buildInboundPublisherTicketClosedPayload(data: PublishTicketClosedInput) {
  return {
    tenantId: data.tenantId,
    ticketId: data.ticketId,
    userId: data.userId || data.ticketId,
    ...data.metadata,
  };
}

export function buildInboundPublisherTicketAssignedPayload(data: PublishTicketAssignedInput) {
  return {
    tenantId: data.tenantId,
    ticketId: data.ticketId,
    userId: data.userId,
    assignedByUserId: data.assignedByUserId,
  };
}

/**
 * TICKET_STATUS_CHANGED as recorded by the inbound-email outbox. `occurredAt`
 * is required by the domain schema subscribers validate against. The actor
 * fields only ride along when there is a user.
 */
export function buildTicketStatusChangedOutboxPayload(data: {
  tenantId: string;
  ticketId: string;
  userId?: string;
  previousStatusId: string;
  newStatusId: string;
  changedAt: string;
}) {
  return {
    tenantId: data.tenantId,
    ticketId: data.ticketId,
    occurredAt: data.changedAt,
    ...(data.userId ? { userId: data.userId, actorUserId: data.userId, actorType: 'USER' as const } : {}),
    previousStatusId: data.previousStatusId,
    newStatusId: data.newStatusId,
    changedAt: data.changedAt,
  };
}

/**
 * The inbound-email outbox stamps `occurredAt` when the event is recorded (not
 * when the dispatcher publishes), because workflow triggers validate payloads
 * against schemas that require it and a retried publish must keep its time.
 * A payload that already carries `occurredAt` keeps it.
 */
export function withOutboxOccurredAt<T extends Record<string, unknown>>(payload: T, occurredAt: string) {
  return { occurredAt, ...payload };
}

/**
 * The team a TICKET_ASSIGNED event assigns, from either payload shape: the current
 * `changes.assigned_team_id = { new }` / top-level `assignedTeamId`, or the legacy bare string on
 * events already sitting in a stream when the shape changed.
 */
export function readAssignedTeamId(payload: unknown): string | undefined {
  const p = (payload ?? {}) as { assignedTeamId?: unknown; changes?: { assigned_team_id?: unknown } };
  if (typeof p.assignedTeamId === 'string' && p.assignedTeamId) return p.assignedTeamId;
  const entry = p.changes?.assigned_team_id;
  if (typeof entry === 'string' && entry) return entry;
  if (entry && typeof entry === 'object') {
    const next = (entry as { new?: unknown }).new;
    if (typeof next === 'string' && next) return next;
  }
  return undefined;
}

export type TicketCommentAddedInput = {
  tenantId: string;
  occurredAt: string;
  ticketId: string;
  commentId: string;
  userId: string;
  comment: {
    content: string;
    author: string;
    isInternal: boolean;
    authorType?: string;
    thread_id?: string | null;
    parent_comment_id?: string | null;
    is_reply?: boolean;
  };
  thread_id?: string | null;
  parent_comment_id?: string | null;
  is_reply?: boolean;
  suppressContactNotifications?: boolean;
  suppressInternalNotifications?: boolean;
};

/**
 * TICKET_COMMENT_ADDED (legacy bus event; not in the workflow catalog, validated against
 * payload.TicketCommentAdded.v1). Carries `commentId` at the top level, which workflows correlate on.
 */
export function buildTicketCommentAddedPayload(input: TicketCommentAddedInput) {
  return {
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    ticketId: input.ticketId,
    commentId: input.commentId,
    userId: input.userId,
    ...withDefined({
      thread_id: input.thread_id,
      parent_comment_id: input.parent_comment_id,
      is_reply: input.is_reply,
    }),
    comment: { id: input.commentId, ...withDefined(input.comment) },
    ...withDefined({
      suppressContactNotifications: input.suppressContactNotifications,
      suppressInternalNotifications: input.suppressInternalNotifications,
    }),
  };
}
