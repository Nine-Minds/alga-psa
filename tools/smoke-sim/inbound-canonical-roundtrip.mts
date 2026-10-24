// Durable-path smoke driver: feeds a REAL GreenMail SMTP->IMAP reply through
// the real MIME parser (parseStagedMimeIntoEmailDetails, the V2/durable
// stager) AND the real canonical inbound engine (processInboundEmailInApp)
// with the real named-conversation admission wired in -- the same
// composition the durable email-service consumer uses end to end. Sender
// authentication is derived entirely from the parsed MIME's headers (via
// processInboundEmailInApp's own verifySenderAuthentication call), not
// injected here, so this harness fails honestly if header propagation
// regresses.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import knexFactory from 'knex';

const TENANT = process.env.SMOKE_TENANT!;
const MAILBOX = process.env.SMOKE_MAILBOX!;
const db = knexFactory({ client: 'pg', connection: {
  host: 'localhost', port: 5472, user: 'postgres',
  password: process.env.PGPASSWORD!, database: process.env.SMOKE_DB!,
}, pool: { min: 0, max: 5 } });

const rawMime = readFileSync(process.env.SMOKE_EML || '/tmp/vendor-reply.eml');
const stager = await import('../../shared/services/email/inboundEmailSourceStager');
const parsed = await stager.parseStagedMimeIntoEmailDetails({
  tenant: TENANT, providerId: MAILBOX, providerType: 'imap', rawMime,
  fallbackProviderMessageId: `greenmail-${Date.now()}`, mailbox: 'helpdesk@browsertest.test',
  uidValidity: '1', uid: 1,
});
console.log('PARSED from    =', JSON.stringify(parsed.emailData.from));
console.log('PARSED subject =', parsed.emailData.subject);

const inboxId = randomUUID();
const { upsertIngress } = await import('../../shared/services/email/inboundEmailDurableStore');
const ingress = await upsertIngress(db as any, { tenant: TENANT, provider_id: MAILBOX,
  provider_type: 'imap', ingress_key: inboxId, provider_pointer: { messageId: parsed.rfcMessageId } } as any);
await db('inbound_email_inbox').insert({
  tenant: TENANT, inbox_id: inboxId, ingress_id: (ingress as any).ingress_id, provider_id: MAILBOX,
  provider_type: 'imap', provider_message_id: parsed.providerMessageId ?? `greenmail-${Date.now()}`,
  rfc_message_id: parsed.rfcMessageId, normalized_message_id: parsed.normalizedMessageId,
  status: 'processing', source_sha256: parsed.emailData.sourceSha256 ?? 'c'.repeat(64),
  source_object_key: `smoke/canonical/${inboxId}`, source_size_bytes: rawMime.length,
  source_staged_at: new Date(), lease_token: randomUUID(), lease_version: 1,
  lease_owner: 'smoke-driver', lease_expires_at: new Date(Date.now() + 60000),
  attempt_count: 1, envelope: '{}',
});

const { admitNamedConversationEmailReply } = await import('../../packages/co-managed/src/inboundNamedConversationEmail');
const { processInboundEmailInApp } = await import('../../shared/services/email/processInboundEmailInApp');

const result = await db.transaction(async trx => processInboundEmailInApp(
  { tenantId: TENANT, providerId: MAILBOX,
    emailData: { ...parsed.emailData, providerId: MAILBOX, tenant: TENANT, provider: 'imap' } as any } as any,
  { durableExecution: { mode: 'enforce', trx, inboxId,
      namedConversationReplyAdmission: admitNamedConversationEmailReply as any } }));

console.log('CANONICAL RESULT =', JSON.stringify(result));
await db.destroy();
