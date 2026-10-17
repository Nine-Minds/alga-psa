import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Receiving-mailbox index only: correspondence reserves ambiguous mail for
 * review, but never grants application access or admits a reply by address. */
export async function rememberNamedConversationCorrespondents(trx: Knex.Transaction, route: {
  tenant: string; mailbox_id: string; token_hash: string; conversation_store_tenant: string; conversation_id: string;
}, addresses: Array<{ email: string }>) {
  const home = tenantDb(trx, route.tenant);
  const own = new Set((await home.table('email_providers').select('mailbox')).map(row => String(row.mailbox).trim().toLowerCase()));
  const emails = [...new Set(addresses.map(value => value.email.trim().toLowerCase()))].filter(value => !own.has(value));
  for (const email of emails) await home.table('ticket_conversation_email_correspondents').insert({ tenant: route.tenant,
    mailbox_id: route.mailbox_id, email, conversation_store_tenant: route.conversation_store_tenant,
    conversation_id: route.conversation_id, route_token_hash: route.token_hash }).onConflict().ignore();
}

export async function isNamedConversationCorrespondent(trx: Knex.Transaction, tenant: string, mailboxId: string, email: string) {
  return Boolean(await tenantDb(trx, tenant).table('ticket_conversation_email_correspondents')
    .where({ mailbox_id: mailboxId, email: email.trim().toLowerCase() }).first('email'));
}

/** Protect retained vendor references even in a composition without the
 * destination writer. The caller may quarantine, never fall back to Requester. */
export async function hasAcceptedNamedConversationReference(trx: Knex.Transaction, tenant: string, mailboxId: string,
  email: { inReplyTo?: string; references?: string[] }) {
  const ids = [...new Set([email.inReplyTo, ...(email.references ?? [])].filter((value): value is string => Boolean(value))
    .map(value => `<${value.trim().replace(/^<|>$/g, '')}>`))];
  if (!ids.length) return false;
  return Boolean(await tenantDb(trx, tenant).table('ticket_conversation_inbound_receipts').where({ provider_id: mailboxId })
    .whereRaw("envelope->>'messageId' = ANY(?::text[])", [ids]).first('inbox_id'));
}
