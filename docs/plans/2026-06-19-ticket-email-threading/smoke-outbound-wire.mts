/**
 * Wire-level outbound threading smoke test (T001 + F017).
 *
 * Sends 3 ticket emails through a real SMTP provider into GreenMail, reads them
 * back over IMAP, and asserts the on-wire RFC threading headers: distinct
 * Message-IDs that match what we recorded, a single shared root, and an
 * In-Reply-To/References chain (first email -> root, each later -> all prior).
 * This proves nodemailer preserves the Message-ID/In-Reply-To/References we set
 * (the header-passthrough risk) and that every ticket email threads as one.
 *
 * Local rig only. From the worktree:
 *   cd server
 *   ROOT=/home/robert/alga-copies/feature-email-threading
 *   node --require "$ROOT/node_modules/tsx/dist/preflight.cjs" \
 *        --import "file://$ROOT/node_modules/tsx/dist/loader.mjs" \
 *        --env-file /tmp/consumer.env \
 *        ../docs/plans/2026-06-19-ticket-email-threading/smoke-outbound-wire.mts
 *
 * Requires GreenMail (SMTP 3025 / IMAP 3143, imap_user/imap_pass). Creates and
 * deletes its own throwaway ticket + sending logs; safe to re-run.
 */
import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
import { BaseEmailService } from '@alga-psa/email/BaseEmailService';
import { SMTPEmailProvider } from '@alga-psa/email/providers/SMTPEmailProvider';
import { ImapFlow } from 'imapflow';

const TENANT = process.env.TENANT_ID ?? '6d178771-ad9a-4d43-8809-83992745f8f9';
const CLIENT = process.env.CLIENT_ID ?? 'd3f22db2-1d5e-4e98-a4d4-9d37042dca4c';
const RUN = randomUUID().slice(0, 8);
const TO = 'imap_user@localhost';
const FROM = 'support@acme.example';

let failures = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS: ' : '  FAIL: ') + m); if (!c) failures++; };

class SmokeEmailService extends BaseEmailService {
  constructor(private provider: any) { super(); }
  protected async getEmailProvider() { return this.provider; }
  protected getFromAddress() { return { email: FROM, name: 'Acme Support' }; }
  protected getServiceName() { return 'smoke-outbound'; }
}

function hdr(raw: string, name: string): string | null {
  const re = new RegExp(`^${name}:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, 'im');
  const m = raw.match(re);
  return m ? m[1].replace(/\r?\n[ \t]+/g, ' ').trim() : null;
}

async function main() {
  const { knex } = await createTenantKnex(TENANT);
  const ticketId = randomUUID();
  const provider = new SMTPEmailProvider('smoke-greenmail');
  await provider.initialize({ host: 'localhost', port: 3025, secure: false, from: FROM, username: 'imap_user', password: 'imap_pass' });
  const svc = new SmokeEmailService(provider);

  const sentIds: string[] = [];
  try {
    await knex('tickets').insert({ tenant: TENANT, ticket_id: ticketId, ticket_number: 'ZZWIRE-' + ticketId.slice(0, 8), client_id: CLIENT });

    for (const ev of ['created', 'comment', 'closed']) {
      const res = await svc.sendEmail({
        to: TO, tenantId: TENANT,
        subject: `[smoke ${RUN}] Ticket ${ev}`,
        html: `<p>${ev} body ${RUN}</p>`, text: `${ev} body ${RUN}`,
        replyContext: { ticketId }, entityType: 'ticket', entityId: ticketId,
      } as any);
      ok(res.success, `send(${ev}) succeeded`);
      const rfc = res.rfcMessageId ?? res.messageId;
      if (rfc) {
        sentIds.push(rfc);
        // mimic sendEventEmail: append the on-wire id to the ticket's references chain
        await knex('tickets').where({ tenant: TENANT, ticket_id: ticketId }).update({
          email_metadata: knex.raw(`jsonb_set(COALESCE(email_metadata,'{}'::jsonb),'{references}',(COALESCE(email_metadata->'references','[]'::jsonb) || to_jsonb(?::text)))`, [rfc]),
        });
      }
    }

    const client = new ImapFlow({ host: 'localhost', port: 3143, secure: false, auth: { user: 'imap_user', pass: 'imap_pass' }, logger: false });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const mine: { messageId: string | null; inReplyTo: string | null; references: string | null }[] = [];
    try {
      for await (const msg of client.fetch({ all: true }, { source: true })) {
        const raw = msg.source?.toString('utf8') ?? '';
        if (!(hdr(raw, 'Subject') ?? '').includes(`smoke ${RUN}`)) continue;
        mine.push({ messageId: hdr(raw, 'Message-ID'), inReplyTo: hdr(raw, 'In-Reply-To'), references: hdr(raw, 'References') });
      }
    } finally { lock.release(); await client.logout(); }

    ok(mine.length === 3, 'all 3 emails delivered to GreenMail');
    const msgIds = mine.map(m => m.messageId);
    ok(msgIds.every(Boolean), 'every message has a Message-ID on the wire');
    ok(new Set(msgIds).size === msgIds.length, 'all Message-IDs are distinct');
    ok(msgIds.every(id => sentIds.includes(id!)), 'wire Message-IDs match recorded rfc ids (nodemailer preserved ours)');

    const root = mine.map(m => (m.references ?? '').split(/\s+/).filter(Boolean)[0]).find(Boolean) ?? '';
    ok(root.startsWith('<ticket-'), `root anchor is the synthetic ticket id (${root})`);
    ok(new Set(mine.map(m => (m.references ?? '').split(/\s+/).filter(Boolean)[0])).size === 1, 'all References share one root');
    let chainOk = true;
    for (const m of mine) {
      const idx = sentIds.indexOf(m.messageId!);
      const expIRT = idx === 0 ? root : sentIds[idx - 1];
      const expRefs = [root, ...sentIds.slice(0, idx)].join(' ');
      if ((m.inReplyTo ?? '') !== expIRT || (m.references ?? '') !== expRefs) {
        chainOk = false;
        console.log(`    [msg#${idx}] In-Reply-To=${m.inReplyTo} (exp ${expIRT}) | References=${m.references} (exp ${expRefs})`);
      }
    }
    ok(chainOk, 'each email: In-Reply-To = prior sent id (root for the first); References = root + all prior');
  } catch (e) {
    console.error('SCRIPT ERROR:', e instanceof Error ? (e.stack ?? e.message) : e);
    failures++;
  } finally {
    await knex('tickets').where({ tenant: TENANT, ticket_id: ticketId }).del().catch(() => {});
    await knex('email_sending_logs').where({ tenant: TENANT, entity_id: ticketId }).del().catch(() => {});
    try { await (knex as any).destroy(); } catch {}
  }
  console.log(failures === 0 ? '\nWIRE SMOKE PASSED' : `\n${failures} WIRE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
