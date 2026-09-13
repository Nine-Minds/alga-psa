// Probe: does the named-conversation destination check admit the REQUESTER
// route the product itself just wrote when it sent the customer email?
import knexFactory from 'knex';
const db = knexFactory({ client: 'pg', connection: { host:'localhost', port:5472, user:'postgres',
  password: process.env.PGPASSWORD!, database: process.env.SMOKE_DB! }, pool:{min:0,max:5} });
const { readNamedConversationEmailDestination } = await import('../../packages/co-managed/src/inboundNamedConversationEmail');
const routes = await db('ticket_conversation_email_routes').select('*').orderBy('created_at');
for (const route of routes) {
  const conv = await db('ticket_conversations').where({ conversation_id: route.conversation_id }).first();
  try {
    const r = await db.transaction(trx => readNamedConversationEmailDestination(trx as any, route));
    console.log(`OK      ${conv?.name} [${conv?.audience}] -> admitted, ancestors=${r.ancestors.length}`);
  } catch (e: any) {
    console.log(`REJECT  ${conv?.name} [${conv?.audience}] -> ${e?.constructor?.name}: ${e?.code ?? e?.message}`);
  }
}
await db.destroy();
