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
  const ticket = await knex('tickets as t')
    .select(
      't.ticket_number',
      't.title',
      't.url',
      's.name as status_name',
      'p.priority_name',
      'cl.client_name',
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name"),
    )
    .leftJoin('statuses as s', function () {
      this.on('t.status_id', 's.status_id').andOn('t.tenant', 's.tenant');
    })
    .leftJoin('priorities as p', function () {
      this.on('t.priority_id', 'p.priority_id').andOn('t.tenant', 'p.tenant');
    })
    .leftJoin('clients as cl', function () {
      this.on('t.client_id', 'cl.client_id').andOn('t.tenant', 'cl.tenant');
    })
    .leftJoin('users as u', function () {
      this.on('t.assigned_to', 'u.user_id').andOn('t.tenant', 'u.tenant');
    })
    .where({ 't.ticket_id': entityId, 't.tenant': tenant })
    .first();

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
  const comments = await knex('comments as c')
    .select(
      'c.note',
      'c.is_resolution',
      'c.is_internal',
      'c.author_type',
      'c.created_at',
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as author_name"),
    )
    .leftJoin('users as u', function () {
      this.on('c.user_id', 'u.user_id').andOn('c.tenant', 'u.tenant');
    })
    .where({ 'c.ticket_id': entityId, 'c.tenant': tenant })
    .whereNot('c.is_system_generated', true)
    .orderBy('c.created_at', 'desc')
    .limit(MAX_COMMENTS);

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
  const client = await knex('clients')
    .select('client_name', 'phone_no', 'email', 'address', 'url', 'client_type')
    .where({ client_id: entityId, tenant })
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
  const contact = await knex('contacts as ct')
    .select('ct.full_name', 'ct.email', 'ct.role', 'cl.client_name')
    .leftJoin('clients as cl', function () {
      this.on('ct.client_id', 'cl.client_id').andOn('ct.tenant', 'cl.tenant');
    })
    .where({ 'ct.contact_name_id': entityId, 'ct.tenant': tenant })
    .first();

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
  const asset = await knex('assets as a')
    .select('a.name', 'a.asset_tag', 'a.serial_number', 'a.status', 'a.location', 'at.type_name', 'cl.client_name')
    .leftJoin('asset_types as at', function () {
      this.on('a.type_id', 'at.type_id').andOn('a.tenant', 'at.tenant');
    })
    .leftJoin('clients as cl', function () {
      this.on('a.client_id', 'cl.client_id').andOn('a.tenant', 'cl.tenant');
    })
    .where({ 'a.asset_id': entityId, 'a.tenant': tenant })
    .first();

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
  const task = await knex('project_tasks as pt')
    .select(
      'pt.task_name',
      'pt.due_date',
      'pt.estimated_hours',
      'pt.actual_hours',
      'pp.phase_name',
      'p.project_name',
      'psm.standard_status_id',
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name"),
    )
    .leftJoin('project_phases as pp', function () {
      this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
    })
    .leftJoin('projects as p', function () {
      this.on('pp.project_id', 'p.project_id').andOn('pp.tenant', 'p.tenant');
    })
    .leftJoin('users as u', function () {
      this.on('pt.assigned_to', 'u.user_id').andOn('pt.tenant', 'u.tenant');
    })
    .leftJoin('project_status_mappings as psm', function () {
      this.on('pt.project_status_mapping_id', 'psm.project_status_mapping_id').andOn('pt.tenant', 'psm.tenant');
    })
    .where({ 'pt.task_id': entityId, 'pt.tenant': tenant })
    .first();

  if (!task) return null;

  // Resolve status name if we have a mapping
  let statusName: string | null = null;
  if (task.standard_status_id) {
    const status = await knex('statuses')
      .select('name')
      .where({ status_id: task.standard_status_id, tenant })
      .first();
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
  const contract = await knex('contracts as c')
    .select('c.contract_name', 'c.contract_description', 'c.status', 'c.billing_frequency')
    .where({ 'c.contract_id': entityId, 'c.tenant': tenant })
    .first();

  if (!contract) return null;

  // Get associated client via client_contracts
  const clientContract = await knex('client_contracts as cc')
    .select('cl.client_name', 'cc.start_date', 'cc.end_date')
    .leftJoin('clients as cl', function () {
      this.on('cc.client_id', 'cl.client_id').andOn('cc.tenant', 'cl.tenant');
    })
    .where({ 'cc.contract_id': entityId, 'cc.tenant': tenant })
    .first();

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
  const quote = await knex('quotes as q')
    .select('q.quote_number', 'q.title', 'q.status', 'q.total_amount', 'q.currency_code', 'q.valid_until', 'q.quote_date', 'cl.client_name')
    .leftJoin('clients as cl', function () {
      this.on('q.client_id', 'cl.client_id').andOn('q.tenant', 'cl.tenant');
    })
    .where({ 'q.quote_id': entityId, 'q.tenant': tenant })
    .first();

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
  const associations = await knex('document_associations')
    .where({ document_id: documentId, tenant })
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
