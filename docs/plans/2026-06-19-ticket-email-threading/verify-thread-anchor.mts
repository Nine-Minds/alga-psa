/**
 * DB-backed verification of ticket-scoped email threading (anchor + chain).
 *
 * Runs against the local dev DB using the same runtime as the inbound consumer.
 * From the worktree:
 *
 *   cd server
 *   ROOT=/home/robert/alga-copies/feature-email-threading
 *   node --require "$ROOT/node_modules/tsx/dist/preflight.cjs" \
 *        --import "file://$ROOT/node_modules/tsx/dist/loader.mjs" \
 *        --env-file /tmp/consumer.env \
 *        ../docs/plans/2026-06-19-ticket-email-threading/verify-thread-anchor.mts
 *
 * Override TENANT_ID / CLIENT_ID env vars for a different local dataset.
 * Creates and deletes its own throwaway tickets; safe to re-run.
 */
import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
import { applyTicketThreadHeaders } from '@alga-psa/email';

const TENANT = process.env.TENANT_ID ?? '6d178771-ad9a-4d43-8809-83992745f8f9';
const CLIENT = process.env.CLIENT_ID ?? 'd3f22db2-1d5e-4e98-a4d4-9d37042dca4c';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  PASS:', msg); } else { console.error('  FAIL:', msg); failures++; }
}

async function main() {
  const { knex } = await createTenantKnex(TENANT);
  const idA = randomUUID();
  const idB = randomUUID();
  try {
    console.log('[A] UI-origin ticket (no email_metadata) — synthetic anchor');
    await knex('tickets').insert({ tenant: TENANT, ticket_id: idA, ticket_number: 'ZZTHRA-' + idA.slice(0, 8), client_id: CLIENT });
    const rootA = `<ticket-${idA}@acme.example>`;

    const hA1: Record<string, string> = {};
    await applyTicketThreadHeaders({ tenantId: TENANT, ticketId: idA, fromDomain: 'acme.example', headers: hA1, serviceName: 'thread-check' });
    assert(hA1['In-Reply-To'] === rootA, 'first email In-Reply-To = root');
    assert(hA1['References'] === rootA, 'first email References = root');
    const tA = await knex('tickets').select('email_metadata').where({ tenant: TENANT, ticket_id: idA }).first();
    assert(tA?.email_metadata?.threadRoot === rootA, 'threadRoot persisted to ticket');

    const evt1 = `<evt-${randomUUID()}@acme.example>`;
    await knex('tickets').where({ tenant: TENANT, ticket_id: idA }).update({
      email_metadata: knex.raw(`jsonb_set(COALESCE(email_metadata,'{}'::jsonb),'{references}',(COALESCE(email_metadata->'references','[]'::jsonb) || to_jsonb(?::text)))`, [evt1]),
    });
    const hA2: Record<string, string> = {};
    await applyTicketThreadHeaders({ tenantId: TENANT, ticketId: idA, fromDomain: 'acme.example', headers: hA2, serviceName: 'thread-check' });
    assert(hA2['In-Reply-To'] === evt1, '2nd email In-Reply-To advances to last prior id');
    assert(hA2['References'] === `${rootA} ${evt1}`, '2nd email References = root + prior (shared root)');
    const tA2 = await knex('tickets').select('email_metadata').where({ tenant: TENANT, ticket_id: idA }).first();
    assert(tA2?.email_metadata?.threadRoot === rootA, 'anchor stable across repeated calls (no re-mint)');

    console.log('[B] Email-origin ticket — anchor = inbound Message-ID');
    await knex('tickets').insert({ tenant: TENANT, ticket_id: idB, ticket_number: 'ZZTHRB-' + idB.slice(0, 8), client_id: CLIENT, email_metadata: JSON.stringify({ messageId: '<orig-cust-123@gmail.com>' }) });
    const hB: Record<string, string> = {};
    await applyTicketThreadHeaders({ tenantId: TENANT, ticketId: idB, fromDomain: 'acme.example', headers: hB, serviceName: 'thread-check' });
    assert(hB['In-Reply-To'] === '<orig-cust-123@gmail.com>', 'anchor = inbound Message-ID');
    assert(hB['References'] === '<orig-cust-123@gmail.com>', 'References = inbound id');
    const tB = await knex('tickets').select('email_metadata').where({ tenant: TENANT, ticket_id: idB }).first();
    assert(!tB?.email_metadata?.threadRoot, 'email-origin did NOT mint a synthetic threadRoot');
  } catch (e) {
    console.error('SCRIPT ERROR:', e instanceof Error ? e.message : e);
    failures++;
  } finally {
    await knex('tickets').where({ tenant: TENANT, ticket_id: idA }).del().catch(() => {});
    await knex('tickets').where({ tenant: TENANT, ticket_id: idB }).del().catch(() => {});
    try { await (knex as any).destroy(); } catch {}
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
