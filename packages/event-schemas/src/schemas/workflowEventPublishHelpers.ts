import { collaborationActorPayloadIssue, type CollaborationActorReference } from './collaborationActorSchemas';

export type WorkflowActor =
  | { actorType: 'USER'; actorUserId: string }
  | { actorType: 'CONTACT'; actorContactId: string }
  | { actorType: 'SYSTEM' }
  | { actorType: 'COLLABORATOR'; actorReference: CollaborationActorReference };

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
  actorType?: 'USER' | 'CONTACT' | 'SYSTEM' | 'COLLABORATOR';
  actorReference?: CollaborationActorReference;
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
  } else if (ctx.actor?.actorType === 'COLLABORATOR') {
    actorFields.actorType = 'COLLABORATOR';
    actorFields.actorReference = { ...ctx.actor.actorReference };
  } else if (ctx.actor?.actorType === 'SYSTEM') {
    actorFields.actorType = 'SYSTEM';
  }

  const result = {
    ...payload,
    ...actorFields,
    tenantId: ctx.tenantId,
    occurredAt,
    ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
  };
  const issue = collaborationActorPayloadIssue(result);
  if (issue) throw new Error(issue);
  return result;
}
