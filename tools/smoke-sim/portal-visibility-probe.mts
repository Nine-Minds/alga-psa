// Smoke probe: asserts the real client-portal conversation reader exposes ONLY
// requester-audience conversations for TIC1000 (vendor/internal must be hidden).
import knexFactory from 'knex';
const db = knexFactory({ client: 'pg', connection: {
  host: 'localhost', port: 5472, user: 'postgres',
  password: process.env.PGPASSWORD!, database: process.env.SMOKE_DB!,
}, pool: { min: 0, max: 5 } });

const TENANT = process.env.SMOKE_TENANT!;
const TICKET = process.env.SMOKE_TICKET!;

const { readPortalTicketConversations } = await import(
  '../../packages/tickets/src/lib/portalTicketConversations');

const all = await db('ticket_conversations').where({ tenant: TENANT, ticket_id: TICKET })
  .select('name', 'audience');
console.log('ALL conversations on ticket:');
for (const c of all) console.log(`   - ${c.name}  [${c.audience}]`);

const res = await db.transaction(trx => readPortalTicketConversations(trx as any, TENANT, TICKET));
console.log('\nPORTAL READER RETURNS:');
console.log(JSON.stringify(res, null, 2));

const names = (res as any).requesterConversations.map((c: any) => c.name);
const leaked = names.filter((n: string) => /vendor|internal|globex|acme|triage/i.test(n));
console.log('\nLEAKED non-requester conversations to portal:', leaked.length ? leaked : 'NONE');
await db.destroy();
