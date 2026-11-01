import { tenantDb } from '@alga-psa/db';
import type { CoManagedClosureContext } from './relationshipClosure';
import type { CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { retainCoManagedHistoricalWorkEvidence } from './historicalWorkEvidence';
import { retainCoManagedSharedConversationBeforeReduction } from './conversationParticipationEvidence';

/**
 * Evidence sources that contribute to a closing archive beyond the built-in ticket/task history
 * (time entries, private MSP history, ...). A source runs inside the closure transaction, under
 * the relationship lock, before the manifest is sealed. Each source is responsible for its own
 * eligibility and disclosure; the seal's allowlist is the second, independent gate.
 */
export type CoManagedClosureEvidenceSource = (context: CoManagedClosureContext) => Promise<void>;
const sources = new Map<string, CoManagedClosureEvidenceSource>();
/** Idempotent per name; returns an unregister function. */
export function registerCoManagedClosureEvidenceSource(name: string, source: CoManagedClosureEvidenceSource): () => void {
  sources.set(name, source);
  return () => { if (sources.get(name) === source) sources.delete(name); };
}

/** Production composition for the archive: discover shared work from actual participation, retain
 * its history and run registered sources. Closure seals afterwards and owns the exclusive relationship lock. */
export async function finalizeCoManagedArchive(context: CoManagedClosureContext): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, operationId, cutoffAt } = context;
  if (!trx.isTransaction || sponsorTenant === customerTenant || ![sponsorTenant, customerTenant, relationshipId, operationId].every(isCoManagedUuid) ||
      !(cutoffAt instanceof Date) || !Number.isFinite(cutoffAt.getTime())) throw new CoManagedSharedWorkError();
  const customer = tenantDb(trx, customerTenant), sponsor = tenantDb(trx, sponsorTenant);
  const relationship = await customer.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: sponsorTenant, state: 'active' })
    .whereNull('ended_at').forShare().first('sponsor_client_id');
  if (!relationship) throw new CoManagedSharedWorkError();
  for (const name of [...sources.keys()].sort()) await sources.get(name)!(context);

  // Discover from actual participation, never an oversight list; every customer source still
  // requires its effective grant inside the retainers.
  const candidates = new Map<string, CoManagedSharedResource>();
  const add = (kind: 'ticket' | 'project_task', id: string) => candidates.set(`${kind}:${id}`, { tenant: customerTenant, relationshipId, kind, id });
  for (const row of await sponsor.table('co_managed_participation_evidence').where({ customer_tenant: customerTenant, relationship_id: relationshipId,
    client_id: relationship.sponsor_client_id }).distinct('resource_type', 'resource_id')) add(row.resource_type, row.resource_id);
  for (const kind of ['ticket', 'project_task'] as const) {
    const task = kind === 'project_task', id = task ? 'task_id' : 'ticket_id';
    const commentTable = task ? 'project_task_comments' : 'comments';
    if (!await trx.schema.hasTable(commentTable) || !await trx.schema.hasTable('collaboration_actor_references')) continue;
    // Only `comments` carries actor_reference_id; project task comments have no such column, so they cannot be discovered this way.
    if (!await trx.schema.hasColumn(commentTable, 'actor_reference_id')) continue;
    const comments = customer.table(`${commentTable} as c`);
    customer.tenantJoin(comments, 'collaboration_actor_references as a', 'c.actor_reference_id', 'a.actor_reference_id');
    for (const row of await comments.where('a.actor_tenant', sponsorTenant).distinct(`c.${id}`)) add(kind, row[id]);
  }
  if (await trx.schema.hasTable('co_management_ticket_handoffs')) {
    for (const row of await customer.table('co_management_ticket_handoffs').where({ relationship_id: relationshipId, transition: 'escalated', audience: 'shared_it' })
      .distinct('ticket_id')) add('ticket', row.ticket_id);
  }
  const audits = await customer.table('audit_logs').whereIn('table_name', ['tickets', 'project_tasks'])
    .whereIn('operation', ['co_managed_ticket_assignment', 'co_managed_project_task_update', 'co_managed_project_task_assignment']).select('table_name', 'record_id', 'details');
  for (const audit of audits) {
    const details = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details;
    if (details?.relationship_id === relationshipId && details.actor_tenant === sponsorTenant && isCoManagedUuid(audit.record_id)) {
      add(audit.table_name === 'tickets' ? 'ticket' : 'project_task', audit.record_id);
    }
  }
  const historical = { trx, sponsorTenant, customerTenant, relationshipId, cutoffAt };
  for (const resource of [...candidates.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))) {
    await retainCoManagedHistoricalWorkEvidence(historical, resource);
    await retainCoManagedSharedConversationBeforeReduction(trx, resource, operationId, { cutoffAt });
  }
}
