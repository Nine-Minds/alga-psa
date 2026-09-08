import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle';
import { getClientContactVisibilityContext } from '@alga-psa/shared/lib/tickets/clientPortalVisibility.server';
import { VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR } from '@alga-psa/shared/lib/tickets/clientPortalVisibility';
import type { WorkflowTicketMutationInput, WorkflowTicketCloseEmailInput } from '../../../shared/workflow/runtime/registries/workflowTicketMutationRegistry';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { retainCoManagedWorkflowTicketAuthority } from './workflowTicketAuthority';
import { coManagedCommentEmailSettings } from './commentEmailRecipient';
import type { CoManagedEmailDeliveryResult } from './commentEmailDeliveries';

const TABLE = 'co_management_workflow_ticket_emails';
export interface CoManagedWorkflowTicketEmail {
  tenant: string; email: string; contactId: string; subtypeId?: number; messageId: string;
  subject: string; html: string; text: string;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const sameInstant = (a: any, b: any) => a && b && new Date(a).getTime() === new Date(b).getTime();

/** Only the admitted action calls this, inside its source transaction. No
 * address or message is sent until the closure and final admission commit. */
export async function enqueueCoManagedWorkflowTicketEmail(trx: Knex.Transaction, source: WorkflowTicketMutationInput, input: WorkflowTicketCloseEmailInput): Promise<void> {
  if (!trx.isTransaction || !input.operationKey) throw new Error('Workflow closure email requires a durable operation identity');
  const owner = tenantDb(trx, source.tenant);
  const ticket = await owner.table('tickets').where('ticket_id', source.ticketId).first();
  const run = await owner.table('workflow_runs').where('run_id', source.workflowRunId).first();
  if (!ticket?.closed_at || !ticket.client_id || !ticket.contact_name_id || !run) throw new Error('Closed ticket has no requester contact to notify');
  const contact = await owner.table('contacts').where({ contact_name_id: ticket.contact_name_id, client_id: ticket.client_id }).forShare().first('email', 'is_inactive');
  if (!contact || contact.is_inactive || !contact.email) throw new Error('Requester contact has no email address');
  const deliveryKey = createHash('sha256').update(JSON.stringify([source.tenant, source.workflowRunId, input.operationKey, 'tickets.close'])).digest('hex');
  const row = { tenant: source.tenant, delivery_key: deliveryKey, workflow_run_id: run.run_id, workflow_id: run.workflow_id,
    workflow_version: run.workflow_version, actor_user_id: source.actorUserId, ticket_id: ticket.ticket_id, client_id: ticket.client_id,
    contact_id: ticket.contact_name_id, closed_at: ticket.closed_at, email: input.email ?? {} };
  await owner.table(TABLE).insert(row).onConflict(['tenant', 'delivery_key']).ignore();
  const existing = await owner.table(TABLE).where('delivery_key', deliveryKey).forShare().first();
  if (!existing || ['workflow_run_id', 'workflow_id', 'workflow_version', 'actor_user_id', 'ticket_id', 'client_id', 'contact_id'].some(key => existing[key] !== row[key as keyof typeof row]) ||
      !sameInstant(existing.closed_at, row.closed_at) || ['subject', 'html', 'text'].some(key => existing.email[key] !== row.email[key as keyof typeof row.email])) {
    throw new Error('Workflow closure email operation identity conflict');
  }
}

// LEVERAGE: pattern comment-email-completion — closure commands share bounded retry semantics, but retain a committed workflow version instead of a comment event.
async function finish(trx: Knex.Transaction, row: any, result: CoManagedEmailDeliveryResult) {
  const attempts = row.attempt_count + 1, retry = result.status === 'failed' && result.retryable && attempts < 10;
  const delay = Math.min(3600000, Math.max(60000 * 2 ** Math.min(attempts - 1, 6),
    result.status === 'failed' && Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 0));
  await tenantDb(trx, row.tenant).table(TABLE).where('delivery_key', row.delivery_key).update({ status: retry ? 'pending' : result.status,
    attempt_count: attempts, next_attempt_at: retry ? trx.raw("clock_timestamp() + ? * interval '1 millisecond'", [delay]) : null,
    completed_at: retry ? null : trx.raw('clock_timestamp()'), error_code: result.status === 'failed' ? result.errorCode.slice(0, 100) : null });
}

/** A completed action is durable authority to attempt delivery, not authority
 * to disclose a ticket after its author/requester loses access. Retain current
 * source/identity locks through transport; stable Message-ID supports retries
 * but cannot promise exactly-once SMTP after a lost acknowledgement. */
export async function processCoManagedWorkflowTicketEmails(db: Knex, tenant: string,
  send: (delivery: CoManagedWorkflowTicketEmail) => Promise<CoManagedEmailDeliveryResult>, limit = 30) {
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isSafeInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid workflow closure email batch');
  const due = (conn: Knex) => tenantDb(conn, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', conn.raw('clock_timestamp()'));
  const candidates = await due(db).orderBy('next_attempt_at').orderBy('delivery_key').limit(limit);
  let processed = 0;
  for (const candidate of candidates) {
    const claim = (trx: Knex.Transaction) => due(trx).where('delivery_key', candidate.delivery_key).forUpdate().skipLocked().first();
    try {
      const done = await withTransaction(db, async trx => {
        const { owner, before: ticket, run } = await retainCoManagedWorkflowTicketAuthority(trx, {
          tenant, ticketId: candidate.ticket_id, workflowRunId: candidate.workflow_run_id, actorUserId: candidate.actor_user_id,
          fields: ['status_id', 'resolution_code', 'resolution_text'],
          readFields: ['ticket_id', 'client_id', 'contact_name_id', 'title', 'ticket_number'],
        }, false);
        const status = await owner.table('statuses').where('status_id', ticket.status_id).forShare().first('is_closed');
        const client = await owner.table('clients').where('client_id', candidate.client_id).forShare().first('is_inactive');
        const contact = await owner.table('contacts').where({ contact_name_id: candidate.contact_id, client_id: candidate.client_id }).forShare().first('email', 'is_inactive');
        const valid = run.workflow_id === candidate.workflow_id && run.workflow_version === candidate.workflow_version &&
          status?.is_closed && sameInstant(ticket.closed_at, candidate.closed_at) && ticket.client_id === candidate.client_id &&
          ticket.contact_name_id === candidate.contact_id && client && !client.is_inactive && contact && !contact.is_inactive &&
          typeof contact.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim());
        let visible = false;
        if (valid) {
          try {
            const visibility = await getClientContactVisibilityContext(trx, tenant, candidate.contact_id, { lock: true });
            visible = visibility.clientId === ticket.client_id && (visibility.visibleBoardIds === null || visibility.visibleBoardIds.includes(ticket.board_id));
          } catch (error) {
            if (!(error instanceof Error) || ![VISIBILITY_GROUP_MISSING_ERROR, VISIBILITY_GROUP_MISMATCH_ERROR].includes(error.message)) throw error;
          }
        }
        const settings = visible ? await coManagedCommentEmailSettings(trx, tenant, 'Ticket Closed') : null;
        const row = await claim(trx);
        if (!row) return false;
        if (!valid || !visible || !settings) { await finish(trx, row, { status: 'skipped' }); return true; }
        const attributes = typeof ticket.attributes === 'string' ? JSON.parse(ticket.attributes) : ticket.attributes;
        const code = String(attributes?.resolution_code ?? '');
        const data: Record<string, unknown> = { ticketNumber: ticket.ticket_number, title: ticket.title,
          resolutionCode: code, resolutionText: attributes?.resolution_text };
        // LEVERAGE: friction email-template-context-escaping — workflow overrides also require context-aware substitution of admitted canonical data.
        const render = (template: string, html = false) => template.replace(/{{\s*ticket\.([A-Za-z0-9_]+)\s*}}/g, (_match, key: string) => {
          const value = String(data[key] ?? ''); return html ? escapeHtml(value) : value;
        });
        const delivery: CoManagedWorkflowTicketEmail = { tenant, email: contact.email.trim(), contactId: candidate.contact_id,
          ...settings, messageId: `<co-managed-workflow-${row.delivery_key}@notifications.alga.invalid>`,
          subject: render(row.email.subject ?? 'Ticket {{ticket.ticketNumber}} closed').replace(/[\r\n]+/g, ' '),
          html: render(row.email.html ?? '<p>Your ticket has been closed.</p><p>Resolution: {{ticket.resolutionCode}}</p>', true),
          text: render(row.email.text ?? 'Your ticket has been closed.\nResolution: {{ticket.resolutionCode}}') };
        let outcome: CoManagedEmailDeliveryResult;
        try { outcome = await send(delivery); }
        catch { outcome = { status: 'failed', retryable: true, errorCode: 'email_transport_failed' }; }
        if (!outcome || !['delivered', 'skipped', 'failed'].includes(outcome.status)) outcome = { status: 'failed', retryable: true, errorCode: 'invalid_email_transport_result' };
        await finish(trx, row, outcome); return true;
      });
      if (done) processed++;
    } catch (error) {
      const done = await withTransaction(db, async trx => {
        const row = await claim(trx); if (!row) return false;
        await finish(trx, row, error instanceof CoManagedSharedWorkError || isCoManagedLifecycleError(error) ? { status: 'skipped' }
          : { status: 'failed', retryable: true, errorCode: 'email_processing_failed' }); return true;
      });
      if (done) processed++;
    }
  }
  return { examined: candidates.length, processed };
}
