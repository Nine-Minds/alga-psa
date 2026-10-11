export type WorkflowActor =
  | { actorType: 'USER'; actorUserId: string }
  | { actorType: 'CONTACT'; actorContactId: string }
  | { actorType: 'SYSTEM' };

export type WorkflowEventPublishContext = {
  tenantId: string;
  occurredAt?: string | Date;
  actor?: WorkflowActor;
  correlationId?: string;
  idempotencyKey?: string;
};

function toIsoString(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  return value.toISOString();
}

/** actorType/actorUserId/actorContactId for a WorkflowActor. The one actor-to-payload mapping. */
function workflowActorFields(actor: WorkflowActor | undefined): {
  actorType?: 'USER' | 'CONTACT' | 'SYSTEM';
  actorUserId?: string;
  actorContactId?: string;
} {
  if (actor?.actorType === 'USER') return { actorType: 'USER', actorUserId: actor.actorUserId };
  if (actor?.actorType === 'CONTACT') return { actorType: 'CONTACT', actorContactId: actor.actorContactId };
  if (actor?.actorType === 'SYSTEM') return { actorType: 'SYSTEM' };
  return {};
}

/**
 * The workflow actor for a ticket/comment event. Never invents a user: a real user id
 * wins, then a contact id, otherwise SYSTEM.
 */
export function resolveTicketEventActor(input: {
  userId?: string | null;
  contactId?: string | null;
}): WorkflowActor {
  if (input.userId) return { actorType: 'USER', actorUserId: input.userId };
  if (input.contactId) return { actorType: 'CONTACT', actorContactId: input.contactId };
  return { actorType: 'SYSTEM' };
}

/**
 * actorType/actorUserId/actorContactId plus the legacy `userId` alias. `userId` is set
 * for USER actors only and is omitted (never null, never a substitute id) otherwise.
 */
export function ticketEventActorFields(actor: WorkflowActor): {
  actorType: 'USER' | 'CONTACT' | 'SYSTEM';
  actorUserId?: string;
  actorContactId?: string;
  userId?: string;
} {
  const fields = workflowActorFields(actor) as {
    actorType: 'USER' | 'CONTACT' | 'SYSTEM';
    actorUserId?: string;
    actorContactId?: string;
  };
  return actor.actorType === 'USER' ? { ...fields, userId: actor.actorUserId } : fields;
}

/**
 * Heal a payload persisted before ticket events stopped using the ticket id as the
 * actor: when `userId === ticketId`, drop `userId` (and `actorUserId` under the same
 * condition, downgrading a USER actorType to SYSTEM). Call only at replay points; this is a data heal, not a schema rule.
 * Returns the same object when nothing needs scrubbing, otherwise a shallow copy.
 */
export function scrubLegacyTicketIdActor<T extends Record<string, any>>(payload: T): T {
  const ticketId = payload?.ticketId;
  if (!ticketId) return payload;
  const copy: Record<string, any> = { ...payload };
  let changed = false;
  if (copy.userId === ticketId) {
    delete copy.userId;
    changed = true;
  }
  if (copy.actorUserId === ticketId) {
    delete copy.actorUserId;
    // A USER actor with no user id is not a valid actor; the ticket id was never a user.
    if (copy.actorType === 'USER') copy.actorType = 'SYSTEM';
    changed = true;
  }
  return changed ? (copy as T) : payload;
}

export function buildWorkflowPayload<TPayload extends Record<string, unknown>>(
  payload: TPayload,
  ctx: WorkflowEventPublishContext
): TPayload & {
  tenantId: string;
  occurredAt: string;
  actorType?: 'USER' | 'CONTACT' | 'SYSTEM';
  actorUserId?: string;
  actorContactId?: string;
  idempotencyKey?: string;
} {
  const occurredAt = toIsoString(ctx.occurredAt);

  return {
    ...payload,
    ...workflowActorFields(ctx.actor),
    tenantId: ctx.tenantId,
    occurredAt,
    ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
  };
}
