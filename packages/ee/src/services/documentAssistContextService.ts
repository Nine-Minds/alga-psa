import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

const MAX_ENTITY_CONTEXT_CHARS = 12000;
const MAX_COMMENTS = 20;
const MAX_COMMENT_CHARS = 500;

interface EntitySummary {
  entityType: string;
  content: string;
}

function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

async function resolveTicket(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const ticketQuery = db.table('tickets as t')
    .select(
      {
        ticket_number: 't.ticket_number',
        title: 't.title',
        url: 't.url',
        status_name: 's.name',
        priority_name: 'p.priority_name',
        client_name: 'cl.client_name',
      },
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name"),
    )
    .where('t.ticket_id', entityId);
  db.tenantJoin(ticketQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
  db.tenantJoin(ticketQuery, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
  db.tenantJoin(ticketQuery, 'clients as cl', 't.client_id', 'cl.client_id', { type: 'left' });
  db.tenantJoin(ticketQuery, 'users as u', 't.assigned_to', 'u.user_id', { type: 'left' });
  const ticket = await ticketQuery.first<any>();

  if (!ticket) return null;

  const lines: string[] = [];
  lines.push(`## Ticket #${ticket.ticket_number} - ${ticket.title}`);
  const meta: string[] = [];
  if (ticket.status_name) meta.push(`Status: ${ticket.status_name}`);
  if (ticket.priority_name) meta.push(`Priority: ${ticket.priority_name}`);
  if (ticket.assigned_to_name?.trim()) meta.push(`Assigned to: ${ticket.assigned_to_name}`);
  if (meta.length > 0) lines.push(`- ${meta.join(' | ')}`);
  if (ticket.client_name) lines.push(`- Client: ${ticket.client_name}`);
  if (ticket.url) lines.push(`- URL: ${ticket.url}`);

  // Fetch comments
  const commentsQuery = db.table('comments as c')
    .select(
      {
        note: 'c.note',
        is_resolution: 'c.is_resolution',
        is_internal: 'c.is_internal',
        author_type: 'c.author_type',
        created_at: 'c.created_at',
      },
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as author_name"),
    )
    .where('c.ticket_id', entityId)
    .whereNot('c.is_system_generated', true)
    .orderBy('c.created_at', 'desc')
    .limit(MAX_COMMENTS);
  db.tenantJoin(commentsQuery, 'users as u', 'c.user_id', 'u.user_id', { type: 'left' });
  const comments: any[] = await commentsQuery;

  if (comments.length > 0) {
    // Reverse to show chronological order (we fetched desc to get the most recent)
    comments.reverse();
    lines.push('');
    lines.push('### Comments:');
    for (const c of comments) {
      const author = c.author_name?.trim() || c.author_type || 'Unknown';
      const date = c.created_at ? new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' ') : '';
      const resTag = c.is_resolution ? ' [RESOLUTION]' : '';
      const noteText = truncate(c.note || '', MAX_COMMENT_CHARS);
      lines.push(`- **${author}** (${date})${resTag}: ${noteText}`);
    }
  }

  return lines.join('\n');
}

async function resolveClient(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const client = await tenantDb(knex, tenant).table('clients')
    .select('client_name', 'phone_no', 'email', 'address', 'url', 'client_type')
    .where({ client_id: entityId })
    .first();

  if (!client) return null;

  const lines: string[] = [];
  lines.push(`## Client: ${client.client_name}`);
  const details: string[] = [];
  if (client.email) details.push(`Email: ${client.email}`);
  if (client.phone_no) details.push(`Phone: ${client.phone_no}`);
  if (details.length > 0) lines.push(`- ${details.join(' | ')}`);
  if (client.address) lines.push(`- Address: ${client.address}`);
  if (client.url) lines.push(`- Website: ${client.url}`);
  if (client.client_type) lines.push(`- Type: ${client.client_type}`);

  return lines.join('\n');
}

async function resolveContact(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const contactQuery = db.table('contacts as ct')
    .select({ full_name: 'ct.full_name', email: 'ct.email', role: 'ct.role', client_name: 'cl.client_name' })
    .where('ct.contact_name_id', entityId);
  db.tenantJoin(contactQuery, 'clients as cl', 'ct.client_id', 'cl.client_id', { type: 'left' });
  const contact = await contactQuery.first<any>();

  if (!contact) return null;

  const lines: string[] = [];
  lines.push(`## Contact: ${contact.full_name}`);
  const details: string[] = [];
  if (contact.email) details.push(`Email: ${contact.email}`);
  if (contact.role) details.push(`Role: ${contact.role}`);
  if (details.length > 0) lines.push(`- ${details.join(' | ')}`);
  if (contact.client_name) lines.push(`- Company: ${contact.client_name}`);

  return lines.join('\n');
}

async function resolveAsset(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const assetQuery = db.table('assets as a')
    .select({ name: 'a.name', asset_tag: 'a.asset_tag', serial_number: 'a.serial_number', status: 'a.status', location: 'a.location', type_name: 'at.type_name', client_name: 'cl.client_name' })
    .where('a.asset_id', entityId);
  db.tenantJoin(assetQuery, 'asset_types as at', 'a.type_id', 'at.type_id', { type: 'left' });
  db.tenantJoin(assetQuery, 'clients as cl', 'a.client_id', 'cl.client_id', { type: 'left' });
  const asset = await assetQuery.first<any>();

  if (!asset) return null;

  const lines: string[] = [];
  lines.push(`## Asset: ${asset.name}`);
  const details: string[] = [];
  if (asset.type_name) details.push(`Type: ${asset.type_name}`);
  if (asset.status) details.push(`Status: ${asset.status}`);
  if (asset.serial_number) details.push(`S/N: ${asset.serial_number}`);
  if (details.length > 0) lines.push(`- ${details.join(' | ')}`);
  if (asset.asset_tag) lines.push(`- Asset Tag: ${asset.asset_tag}`);
  if (asset.client_name) lines.push(`- Client: ${asset.client_name}`);
  if (asset.location) lines.push(`- Location: ${asset.location}`);

  return lines.join('\n');
}

async function resolveProjectTask(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const taskQuery = db.table('project_tasks as pt')
    .select(
      {
        task_name: 'pt.task_name',
        due_date: 'pt.due_date',
        estimated_hours: 'pt.estimated_hours',
        actual_hours: 'pt.actual_hours',
        phase_name: 'pp.phase_name',
        project_name: 'p.project_name',
        standard_status_id: 'psm.standard_status_id',
      },
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name"),
    )
    .where('pt.task_id', entityId);
  db.tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id', { type: 'left' });
  db.tenantJoin(taskQuery, 'projects as p', 'pp.project_id', 'p.project_id', { type: 'left' });
  db.tenantJoin(taskQuery, 'users as u', 'pt.assigned_to', 'u.user_id', { type: 'left' });
  db.tenantJoin(taskQuery, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
  const task = await taskQuery.first<any>();

  if (!task) return null;

  // Resolve status name if we have a mapping
  let statusName: string | null = null;
  if (task.standard_status_id) {
    const status = await db.table('statuses')
      .select('name')
      .where({ status_id: task.standard_status_id })
      .first<any>();
    statusName = status?.name || null;
  }

  const lines: string[] = [];
  lines.push(`## Task: ${task.task_name}`);
  const meta: string[] = [];
  if (task.project_name) meta.push(`Project: ${task.project_name}`);
  if (statusName) meta.push(`Status: ${statusName}`);
  if (task.assigned_to_name?.trim()) meta.push(`Assigned to: ${task.assigned_to_name}`);
  if (meta.length > 0) lines.push(`- ${meta.join(' | ')}`);
  if (task.phase_name) lines.push(`- Phase: ${task.phase_name}`);
  if (task.due_date) lines.push(`- Due: ${new Date(task.due_date).toISOString().slice(0, 10)}`);

  return lines.join('\n');
}

async function resolveContract(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const contract = await db.table('contracts as c')
    .select({ contract_name: 'c.contract_name', contract_description: 'c.contract_description', status: 'c.status', billing_frequency: 'c.billing_frequency' })
    .where('c.contract_id', entityId)
    .first<any>();

  if (!contract) return null;

  // Get associated client via client_contracts
  const clientContractQuery = db.table('client_contracts as cc')
    .select({ client_name: 'cl.client_name', start_date: 'cc.start_date', end_date: 'cc.end_date' })
    .where('cc.contract_id', entityId);
  db.tenantJoin(clientContractQuery, 'clients as cl', 'cc.client_id', 'cl.client_id', { type: 'left' });
  const clientContract = await clientContractQuery.first<any>();

  const lines: string[] = [];
  lines.push(`## Contract: ${contract.contract_name}`);
  const meta: string[] = [];
  if (contract.status) meta.push(`Status: ${contract.status}`);
  if (contract.billing_frequency) meta.push(`Billing: ${contract.billing_frequency}`);
  if (meta.length > 0) lines.push(`- ${meta.join(' | ')}`);
  if (clientContract?.client_name) lines.push(`- Client: ${clientContract.client_name}`);
  if (clientContract?.start_date) lines.push(`- Start: ${new Date(clientContract.start_date).toISOString().slice(0, 10)}`);
  if (clientContract?.end_date) lines.push(`- End: ${new Date(clientContract.end_date).toISOString().slice(0, 10)}`);
  if (contract.contract_description) lines.push(`- Description: ${truncate(contract.contract_description, 300)}`);

  return lines.join('\n');
}

async function resolveQuote(knex: Knex, entityId: string, tenant: string): Promise<string | null> {
  const db = tenantDb(knex, tenant);
  const quoteQuery = db.table('quotes as q')
    .select({ quote_number: 'q.quote_number', title: 'q.title', status: 'q.status', total_amount: 'q.total_amount', currency_code: 'q.currency_code', valid_until: 'q.valid_until', quote_date: 'q.quote_date', client_name: 'cl.client_name' })
    .where('q.quote_id', entityId);
  db.tenantJoin(quoteQuery, 'clients as cl', 'q.client_id', 'cl.client_id', { type: 'left' });
  const quote = await quoteQuery.first<any>();

  if (!quote) return null;

  const lines: string[] = [];
  lines.push(`## Quote #${quote.quote_number}${quote.title ? ` - ${quote.title}` : ''}`);
  const meta: string[] = [];
  if (quote.status) meta.push(`Status: ${quote.status}`);
  if (quote.total_amount != null) {
    const amount = (Number(quote.total_amount) / 100).toFixed(2);
    meta.push(`Total: ${quote.currency_code || ''} ${amount}`);
  }
  if (meta.length > 0) lines.push(`- ${meta.join(' | ')}`);
  if (quote.client_name) lines.push(`- Client: ${quote.client_name}`);
  if (quote.quote_date) lines.push(`- Date: ${new Date(quote.quote_date).toISOString().slice(0, 10)}`);
  if (quote.valid_until) lines.push(`- Valid until: ${new Date(quote.valid_until).toISOString().slice(0, 10)}`);

  return lines.join('\n');
}

const ENTITY_RESOLVERS: Record<string, (knex: Knex, entityId: string, tenant: string) => Promise<string | null>> = {
  ticket: resolveTicket,
  client: resolveClient,
  contact: resolveContact,
  asset: resolveAsset,
  project_task: resolveProjectTask,
  contract: resolveContract,
  quote: resolveQuote,
};

/**
 * Resolve entity context for a document's associated entities.
 * Returns a formatted markdown string with entity summaries (including ticket comments),
 * or an empty string if no associations or all fetches fail.
 */
export async function resolveDocumentEntityContext(
  knex: Knex,
  documentId: string,
  tenant: string,
): Promise<string> {
  // Fetch document associations
  const associations = await tenantDb(knex, tenant).table('document_associations')
    .where({ document_id: documentId })
    .orderBy('created_at', 'desc');

  if (!associations || associations.length === 0) {
    return '';
  }

  // Resolve all entities in parallel, isolating per-entity failures
  const summaryPromises: Promise<EntitySummary | null>[] = associations.map(async (assoc) => {
    const resolver = ENTITY_RESOLVERS[assoc.entity_type];
    if (!resolver) {
      // user, tenant, or unknown types — skip silently
      return null;
    }

    try {
      const content = await resolver(knex, assoc.entity_id, tenant);
      if (!content) return null;
      return { entityType: assoc.entity_type, content };
    } catch (error) {
      console.error(`[documentAssistContext] Failed to resolve ${assoc.entity_type} ${assoc.entity_id}:`, error);
      return null;
    }
  });

  const summaries = (await Promise.all(summaryPromises)).filter((s): s is EntitySummary => s !== null);

  if (summaries.length === 0) {
    return '';
  }

  // Join and enforce size cap
  let result = summaries.map((s) => s.content).join('\n\n');

  if (result.length > MAX_ENTITY_CONTEXT_CHARS) {
    result = result.slice(0, MAX_ENTITY_CONTEXT_CHARS) + '\n\n[... entity context truncated ...]';
  }

  return result;
}
