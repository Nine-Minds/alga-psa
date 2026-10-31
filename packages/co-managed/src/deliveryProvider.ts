import type { Knex } from 'knex';
import { withAdminTransaction, tenantDb } from '@alga-psa/db';
import { claimDelivery, finishDelivery, CO_MANAGED_LEDGER } from '@alga-psa/shared/lib/deliveryLedger';
import { normalizeEmailAddress } from '@alga-psa/shared/lib/email/addressUtils';
import { contactEmailMatch } from '@alga-psa/shared/lib/email/contactEmailMatch';
import { resolveCommentAudience } from '@alga-psa/shared/lib/commentAudience';
import {
  decideReplyToken, parseCm2Metadata,
  type CoManagedDeliveryProvider, type CommentDeliveryPlan, type InboundSender, type RoutingDelivery, type DeliveryRecipient, type InboundAdmission,
} from '@alga-psa/shared/lib/coManagedDelivery';
import { withCoManagedNotificationRecipient } from './sharedWork';
import { projectTaskAudience } from './projectTaskAudience';
import { ROUTING_IN_APP_KIND, ROUTING_EMAIL_KIND, type CoManagedRoutingPayload } from './routingOutbox';
import { isCoManagedSharedWorkError } from './sharedWorkIdentity';

/** A shared ticket: its work row in the customer tenant, the live relationship, and the revoke history. */
async function loadSharedTicket(trx: Knex.Transaction, tenant: string, ticketId: string) {
  const work = await tenantDb(trx, tenant).table('co_management_ticket_work').where({ ticket_id: ticketId }).first('relationship_id', 'work_id', 'grant_revoked_at', 'first_escalated_at');
  if (!work) return null;
  const relationship = await tenantDb(trx, tenant).table('co_management_relationships')
    .where({ relationship_id: work.relationship_id, state: 'active' }).whereNull('ended_at').first('sponsor_tenant', 'sponsor_client_id');
  if (!relationship) return null;
  const revokes = await tenantDb(trx, tenant).table('co_management_ticket_handoffs')
    .where({ relationship_id: work.relationship_id, ticket_id: ticketId, transition: 'access_revoked' }).count<{ count: string }[]>('* as count');
  return { work, relationship, relationshipId: work.relationship_id as string, grantGeneration: Number(revokes?.[0]?.count ?? 0) };
}

async function threadForComment(trx: Knex.Transaction, tenant: string, commentId: string) {
  const comment = await tenantDb(trx, tenant).table('comments').where({ comment_id: commentId }).first('thread_id', 'is_internal');
  if (!comment) return null;
  const thread = comment.thread_id ? await tenantDb(trx, tenant).table('comment_threads').where({ thread_id: comment.thread_id }).first('collaboration_audience', 'is_internal') : null;
  return { threadId: (comment.thread_id as string | null) ?? null, audience: resolveCommentAudience(thread ?? { is_internal: comment.is_internal }) };
}

/** Sponsor-side participants: the MSP user/team assigned on the sponsor's ticket reference. */
export async function sponsorParticipants(trx: Knex.Transaction, tenant: string, ticketId: string, shared: { relationshipId: string; relationship: { sponsor_tenant: string } }) {
  const sponsor = tenantDb(trx, shared.relationship.sponsor_tenant);
  const reference = await sponsor.table('co_managed_ticket_references')
    .where({ relationship_id: shared.relationshipId, ticket_id: ticketId, customer_tenant: tenant }).first('assigned_to', 'assigned_team_id');
  if (!reference) return [] as DeliveryRecipient[];
  const rows: Array<{ user_id: string; email: string; kind: 'msp_user' | 'team' }> = [];
  if (reference.assigned_to) {
    const user = await sponsor.table('users').where({ user_id: reference.assigned_to, user_type: 'internal', is_inactive: false }).first('user_id', 'email');
    if (user?.email) rows.push({ user_id: user.user_id, email: user.email, kind: 'msp_user' });
  }
  if (reference.assigned_team_id) {
    const query = sponsor.table('team_members as tm').where('tm.team_id', reference.assigned_team_id).select('u.user_id', 'u.email');
    sponsor.tenantJoin(query, 'users as u', 'tm.user_id', 'u.user_id');
    for (const member of await query.where({ 'u.user_type': 'internal', 'u.is_inactive': false })) {
      if (member.email) rows.push({ user_id: member.user_id, email: member.email, kind: 'team' });
    }
  }
  return rows.map((row): DeliveryRecipient => ({ kind: row.kind, principalId: row.user_id, email: row.email }));
}

export function createCoManagedDeliveryProvider(): CoManagedDeliveryProvider {
  return {
    async pendingRouting(tenant, opts = {}) {
      return withAdminTransaction(async (trx) => {
        const query = tenantDb(trx, tenant).table('co_management_deliveries')
          .whereIn('delivery_kind', [ROUTING_IN_APP_KIND, ROUTING_EMAIL_KIND]).whereIn('state', ['pending', 'failed'])
          .orderBy('created_at').limit(opts.limit ?? 100);
        if (opts.sourceId) query.where('source_id', opts.sourceId);
        const out: RoutingDelivery[] = [];
        const tickets = new Map<string, { ticket_number: string; title: string } | undefined>();
        for (const row of await query) {
          const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as (CoManagedRoutingPayload & { principalId: string }) | null;
          if (!payload) continue;
          if (!tickets.has(payload.ticketId)) {
            tickets.set(payload.ticketId, await tenantDb(trx, tenant).table('tickets').where({ ticket_id: payload.ticketId }).first('ticket_number', 'title'));
          }
          const ticket = tickets.get(payload.ticketId);
          const sponsorSide = row.recipient_kind === 'msp_user' || row.recipient_kind === 'team';
          let allowed = !!ticket;
          if (allowed && sponsorSide) {
            try {
              await withCoManagedNotificationRecipient(trx as unknown as Knex, { kind: 'notification_recipient', tenant: payload.sponsorTenant, userId: payload.principalId },
                { tenant, relationshipId: payload.relationshipId, kind: 'ticket', id: payload.ticketId }, async () => undefined);
            } catch (error) {
              if (!isCoManagedSharedWorkError(error)) throw error;
              allowed = false;
            }
          }
          out.push({ tenant, deliveryKind: row.delivery_kind, sourceId: row.source_id, event: payload.event,
            recipient: { kind: row.recipient_kind, principalId: payload.principalId, email: row.delivery_kind === ROUTING_EMAIL_KIND ? row.recipient : undefined },
            recipientTenant: sponsorSide ? payload.sponsorTenant : tenant, ticketId: payload.ticketId,
            ticketNumber: ticket?.ticket_number ?? '', ticketTitle: ticket?.title ?? '', actorName: payload.actorName, actorOrganization: payload.actorOrganization, allowed });
        }
        return out;
      });
    },

    async flagStaleRoutingSending(tenant, olderThanMs) {
      // write-admission: exempt — delivery-ledger reconciliation flag on a stale claim, not a co-managed work write
      return withAdminTransaction(async (trx) => tenantDb(trx, tenant).table('co_management_deliveries')
        .whereIn('delivery_kind', [ROUTING_IN_APP_KIND, ROUTING_EMAIL_KIND]).where({ state: 'sending', requires_reconciliation: false })
        .where('updated_at', '<', new Date(Date.now() - olderThanMs))
        .update({ requires_reconciliation: true, error_code: 'unknown_outcome', last_error: 'Delivery was claimed but never finished; reconcile before resending.', updated_at: new Date() }));
    },

    async planTicketComment(tenant, ticketId, commentId): Promise<CommentDeliveryPlan | null> {
      return withAdminTransaction(async (trx) => {
        const shared = await loadSharedTicket(trx, tenant, ticketId);
        // Not shared, or the grant was revoked: the ticket is the customer's alone again.
        if (!shared || shared.work.grant_revoked_at || !shared.work.first_escalated_at) return null;
        const thread = await threadForComment(trx, tenant, commentId);
        if (!thread) return null;
        let sponsorRecipients: DeliveryRecipient[] = [];
        if (thread.audience !== 'organization_private') {
          const resource = { tenant, relationshipId: shared.relationshipId, kind: 'ticket' as const, id: ticketId };
          for (const candidate of await sponsorParticipants(trx, tenant, ticketId, shared)) {
            try {
              // Each recipient is re-checked against its OWN current policy; a denied one is simply skipped.
              await withCoManagedNotificationRecipient(trx as unknown as Knex,
                { kind: 'notification_recipient', tenant: shared.relationship.sponsor_tenant, userId: candidate.principalId }, resource, async () => undefined);
              sponsorRecipients.push(candidate);
            } catch (error) {
              if (!isCoManagedSharedWorkError(error)) throw error;
            }
          }
        }
        return {
          audience: thread.audience, threadId: thread.threadId, relationshipId: shared.relationshipId, sponsorTenant: shared.relationship.sponsor_tenant as string, sponsorRecipients,
          replyTokenMetadata: { namespace: 'cm', version: 2, relationshipId: shared.relationshipId, grantGeneration: shared.grantGeneration, threadId: thread.threadId },
        };
      });
    },

    async planTaskComment(tenant, taskCommentId) {
      return withAdminTransaction(async (trx) => {
        const comment = await tenantDb(trx, tenant).table('project_task_comments').where({ task_comment_id: taskCommentId }).first('thread_id');
        const thread = comment?.thread_id
          ? await tenantDb(trx, tenant).table('comment_threads').where({ thread_id: comment.thread_id }).first('collaboration_audience', 'is_internal')
          : null;
        return { audience: projectTaskAudience(thread ?? {}) };
      });
    },

    async claim(tenant, kind, sourceId, recipient) {
      return withAdminTransaction((trx) => claimDelivery(trx, CO_MANAGED_LEDGER, tenant,
        { delivery_kind: kind, source_id: sourceId, recipient: recipient.email ?? recipient.principalId }, { recipient_kind: recipient.kind }));
    },

    async finish(tenant, kind, sourceId, recipient, state, outcome) {
      await withAdminTransaction((trx) => finishDelivery(trx, CO_MANAGED_LEDGER, tenant,
        { delivery_kind: kind, source_id: sourceId, recipient: recipient.email ?? recipient.principalId }, state, { error: outcome?.error, errorCode: outcome?.code }));
    },

    async admitReplyToken(tenant, token, metadata, inboundSender: InboundSender): Promise<InboundAdmission> {
      const parsed = parseCm2Metadata(metadata);
      if (!parsed) {
        // cm1 (or an unparseable cm2) never reaches a comment write.
        return decideReplyToken(token, metadata, null).action === 'fall_through'
          ? { admitted: false, reason: 'not_served', acknowledge: false }
          : { admitted: false, reason: 'legacy_token', acknowledge: true };
      }
      return withAdminTransaction(async (trx): Promise<InboundAdmission> => {
        const record = await tenantDb(trx, tenant).table('email_reply_tokens').where({ token }).first('ticket_id', 'comment_id');
        const ticketId = record?.ticket_id as string | undefined;
        const shared = ticketId ? await loadSharedTicket(trx, tenant, ticketId) : null;
        if (!ticketId || !shared || shared.relationshipId !== parsed.relationshipId) return { admitted: false, reason: 'stale_generation', acknowledge: true };
        const decision = decideReplyToken(token, metadata, shared.grantGeneration);
        if (decision.action === 'refuse') return { admitted: false, reason: decision.reason, acknowledge: true };
        if (shared.work.grant_revoked_at) return { admitted: false, reason: 'grant_revoked', acknowledge: true };
        const thread = parsed.threadId
          ? await tenantDb(trx, tenant).table('comment_threads').where({ thread_id: parsed.threadId }).first('collaboration_audience', 'is_internal')
          : null;
        const audience = resolveCommentAudience(thread ?? { is_internal: false });
        const base = { admitted: true as const, audience, relationshipId: parsed.relationshipId, threadId: parsed.threadId, ticketId, parentCommentId: (record?.comment_id as string | null) ?? null };
        const sender = normalizeEmailAddress(inboundSender.email) ?? '';
        if (audience === 'requester') {
          // Requester threads keep the native writer (its contact-auth rules still apply), but only an active
          // contact of the ticket's own client, in this tenant, is admitted to it.
          if (!sender) return { admitted: false, reason: 'not_participant', acknowledge: true };
          const ticket = await tenantDb(trx, tenant).table('tickets').where({ ticket_id: ticketId }).first('client_id');
          const contact = ticket?.client_id
            ? await tenantDb(trx, tenant).table('contacts').where({ 'contacts.client_id': ticket.client_id, 'contacts.is_inactive': false })
              .andWhere(contactEmailMatch(tenantDb(trx, tenant), trx, sender)).first('contacts.contact_name_id')
            : null;
          return contact ? base : { admitted: false, reason: 'not_participant', acknowledge: true };
        }
        // shared_it / organization_private resolve the sender to an internal user. An unauthenticated From is
        // only a claim: refuse BEFORE any user lookup, and never mail the unverified address.
        if (!inboundSender.internalAttributionTrusted) return { admitted: false, reason: 'sender_unauthenticated', acknowledge: false };
        if (!sender) return { admitted: false, reason: 'not_participant', acknowledge: true };
        // Resolve the sender to an internal user of either organisation. The writer then re-authorizes them.
        for (const candidateTenant of [tenant, shared.relationship.sponsor_tenant as string]) {
          const user = await tenantDb(trx, candidateTenant).table('users')
            .whereRaw('lower(email) = ?', [sender]).where({ user_type: 'internal', is_inactive: false }).first('user_id');
          if (!user) continue;
          if (audience === 'organization_private' && candidateTenant !== tenant) return { admitted: false, reason: 'audience_forbidden', acknowledge: true };
          return { ...base, actor: { tenant: candidateTenant, userId: user.user_id } };
        }
        return { admitted: false, reason: 'not_participant', acknowledge: true };
      });
    },
  };
}
