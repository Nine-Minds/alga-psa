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

  const actorFields: Record<string, unknown> = {};
  if (ctx.actor?.actorType === 'USER') {
    actorFields.actorType = 'USER';
    actorFields.actorUserId = ctx.actor.actorUserId;
  } else if (ctx.actor?.actorType === 'CONTACT') {
    actorFields.actorType = 'CONTACT';
    actorFields.actorContactId = ctx.actor.actorContactId;
  } else if (ctx.actor?.actorType === 'SYSTEM') {
    actorFields.actorType = 'SYSTEM';
  }

  return {
    ...payload,
    ...actorFields,
    tenantId: ctx.tenantId,
    occurredAt,
    ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
  };
}

