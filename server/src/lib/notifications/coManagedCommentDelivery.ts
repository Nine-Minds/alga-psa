import { randomUUID } from 'node:crypto';
import {
  coManagedDeliverySeam, mintCm2Token, recipientsForAudience,
  type CommentDeliveryPlan, type CoManagedDeliveryProvider, type DeliveryRecipient, type ThreadParticipants,
} from '@shared/lib/coManagedDelivery';
import { CO_MANAGED_LEDGER } from '@shared/lib/deliveryLedger';

/**
 * The co-managed step of a comment notification (CM L5 plan step 4).
 *
 *   resolve (once per event) -> planTicketComment -> audience-aware recipients -> ledger claim/finish
 *
 * `resolveCoManagedCommentStep` is the only call a native subscriber makes for a tenant the gate does
 * not serve: `coManagedDeliverySeam.resolve` answers null with zero SQL, so a psa tenant keeps its
 * exact native recipient step. For a shared ticket the plan is non-null and this step REPLACES the
 * native recipient step, so each recipient gets exactly one send.
 */
export interface CoManagedCommentStep {
  provider: CoManagedDeliveryProvider;
  plan: CommentDeliveryPlan;
}

export async function resolveCoManagedCommentStep(tenant: string, ticketId: string, commentId: string | undefined): Promise<CoManagedCommentStep | null> {
  if (!commentId) return null;
  const provider = await coManagedDeliverySeam.resolve(tenant);
  if (!provider) return null;
  const plan = await provider.planTicketComment(tenant, ticketId, commentId);
  return plan ? { provider, plan } : null;
}

/** Splits the plan's sponsor recipients into the slots `recipientsForAudience` expects, then applies the audience rule. */
export function audienceRecipients(step: CoManagedCommentStep, local: Omit<ThreadParticipants, 'sponsorUsers' | 'sponsorTeams'>): DeliveryRecipient[] {
  const sponsor = step.plan.sponsorRecipients;
  return recipientsForAudience(step.plan.audience, {
    ...local,
    sponsorUsers: sponsor.filter((r) => r.kind !== 'team'),
    sponsorTeams: sponsor.filter((r) => r.kind === 'team'),
  });
}

/**
 * Fields a `sendEventEmail` call needs so this one send is claimed in `co_management_deliveries`
 * and carries its own `cm2:` reply token (metadata names the relationship, grant generation, thread).
 */
export function coManagedSendFields(step: CoManagedCommentStep, kind: string, sourceId: string, recipient: DeliveryRecipient) {
  return {
    delivery: {
      ledger: CO_MANAGED_LEDGER,
      key: { delivery_kind: kind, source_id: sourceId, recipient: recipient.email ?? recipient.principalId },
      extra: { recipient_kind: recipient.kind },
    },
    conversationToken: mintCm2Token(randomUUID()),
    tokenMetadata: { ...step.plan.replyTokenMetadata } as Record<string, unknown>,
  };
}

/**
 * Task-comment variant: the audience comes from the task comment's thread; tasks have no sponsor, so the
 * served step only adds the audience rule and the delivery claim (exactly-once per recipient).
 */
export async function resolveCoManagedTaskCommentStep(tenant: string, taskCommentId: string | undefined) {
  if (!taskCommentId) return null;
  const provider = await coManagedDeliverySeam.resolve(tenant);
  if (!provider) return null;
  const plan = await provider.planTaskComment(tenant, taskCommentId);
  return plan ? { provider, audience: plan.audience } : null;
}

export function taskCommentDelivery(taskCommentId: string, recipient: DeliveryRecipient) {
  return {
    ledger: CO_MANAGED_LEDGER,
    key: { delivery_kind: 'task_comment_email', source_id: taskCommentId, recipient: recipient.email ?? recipient.principalId },
    extra: { recipient_kind: recipient.kind },
  };
}
