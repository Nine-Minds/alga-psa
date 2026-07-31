/**
 * DB-backed verification of inbound header-based reply matching (slice 5 / T003 logic).
 *
 * Proves resolveReplyTargetFromOutboundMessageId() resolves a reply to a NON-comment
 * ticket notification back to its ticket via the email_sending_logs ticket-entity row
 * (the path that lets replies to created/updated/closed/assigned emails thread back).
 *
 * Sends one outbound notification to a NON-polled address (so it is logged but does not
 * itself become an inbound ticket), then resolves its rfc id. Creates/deletes its own
 * ticket by exact id; safe to re-run. Run like verify-thread-anchor.mts.
 */
import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
import { BaseEmailService } from '@alga-psa/email/BaseEmailService';
import { SMTPEmailProvider } from '@alga-psa/email/providers/SMTPEmailProvider';
import { resolveReplyTargetFromOutboundMessageId } from '@shared/services/email/processInboundEmailInApp';

const TENANT = process.env.TENANT_ID ?? '6d178771-ad9a-4d43-8809-83992745f8f9';
const CLIENT = process.env.CLIENT_ID ?? 'd3f22db2-1d5e-4e98-a4d4-9d37042dca4c';
const RUN = randomUUID().slice(0, 8);

let failures = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS: ' : '  FAIL: ') + m); if (!c) failures++; };

class SetupEmailService extends BaseEmailService {
  constructor(private provider: any) { super(); }
  protected async getEmailProvider() { return this.provider; }
  protected getFromAddress() { return { email: 'support@acme.example', name: 'Acme Support' }; }
  protected getServiceName() { return 'verify-inbound-setup'; }
}

async function main() {
  const { knex } = await createTenantKnex(TENANT);
  const ticketId = randomUUID();
  try {
    await knex('tickets').insert({ tenant: TENANT, ticket_id: ticketId, ticket_number: 'ZZIMATCH-' + ticketId.slice(0, 8), client_id: CLIENT });

    const provider = new SMTPEmailProvider('verify-inbound');
    await provider.initialize({ host: 'localhost', port: 3025, secure: false, from: 'support@acme.example', username: 'imap_user', password: 'imap_pass' });
    const svc = new SetupEmailService(provider);

    // A non-comment ticket notification, delivered to a NON-polled address.
    const res = await svc.sendEmail({
      to: 'contact@external.test', tenantId: TENANT,
      subject: `[imatch ${RUN}] Ticket update`, html: `<p>update ${RUN}</p>`, text: `update ${RUN}`,
      replyContext: { ticketId }, entityType: 'ticket', entityId: ticketId,
    } as any);
    const rfc = (res.rfcMessageId ?? res.messageId)!;
    ok(res.success && !!rfc, `outbound notification logged with rfc id (${rfc})`);

    // The reply's In-Reply-To = that rfc id must resolve back to THIS ticket.
    const target = await resolveReplyTargetFromOutboundMessageId({ tenantId: TENANT, rfcMessageId: rfc });
    ok(target?.ticketId === ticketId, `In-Reply-To resolves to the same ticket (got ${target?.ticketId ?? 'null'})`);
    ok(target?.parentCommentId == null, 'ticket-level match has no parent comment (appends at ticket level)');

    // A bogus id must not resolve.
    const miss = await resolveReplyTargetFromOutboundMessageId({ tenantId: TENANT, rfcMessageId: `<nope-${RUN}@x>` });
    ok(miss === null, 'unknown Message-ID resolves to null (would become a new ticket)');
  } catch (e) {
    console.error('SCRIPT ERROR:', e instanceof Error ? (e.stack ?? e.message) : e);
    failures++;
  } finally {
    await knex('email_sending_logs').where({ tenant: TENANT, entity_id: ticketId }).del().catch(() => {});
    await knex('tickets').where({ tenant: TENANT, ticket_id: ticketId }).del().catch(() => {});
    try { await (knex as any).destroy(); } catch {}
  }
  console.log(failures === 0 ? '\nINBOUND MATCH VERIFIED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
