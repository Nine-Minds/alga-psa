import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { acquireOrganizationSlaLock } from './slaLock';
import { startOrganizationSlaClock, observeOrganizationSlaClock, pauseOrganizationSlaClock, resumeOrganizationSlaClock,
  respondToOrganizationSlaClock, resolveOrganizationSlaClock, type OrganizationSlaClock, type OrganizationSlaIdentity } from './organizationSlaClock';

export interface OrganizationSlaStart {
  workId: string;
  generation: number;
  policyId: string;
  priorityId: string;
  schedule: OrganizationSlaClock['schedule'];
  targets: Parameters<typeof startOrganizationSlaClock>[2];
  occurredAt: string;
}
export type OrganizationSlaEvent = { occurredAt: string } & (
  { kind: 'observed' | 'resolved' } |
  { kind: 'paused' | 'resumed'; reason: string } |
  { kind: 'responded'; actorTenant: string; audience: 'requester' | 'shared_it' | 'organization_private' }
);
export interface OrganizationSlaReceipt { obligationId: string; operationId: string; revision: number; event: string; occurredAt: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// JSONB and durable job round-trips may reorder object keys. Ordering is not a
// command change; array order remains significant for the resolved calendar.
const fingerprint = (input: unknown) => createHash('sha256').update(JSON.stringify(input, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
const receipt = (row: any): OrganizationSlaReceipt => ({ obligationId: row.obligation_id, operationId: row.operation_id,
  revision: row.revision, event: row.event_type, occurredAt: new Date(row.occurred_at).toISOString() });

function snapshot(trx: Knex.Transaction, identity: OrganizationSlaIdentity, operationId: string) {
  if (!trx.isTransaction || !identity || ![identity.tenant, identity.obligationId, identity.sourceTenant, identity.ticketId, operationId]
    .every(value => typeof value === 'string' && uuid.test(value))) throw new Error('A retained transaction and qualified SLA identity are required');
  return { tenant: identity.tenant, obligationId: identity.obligationId, sourceTenant: identity.sourceTenant, ticketId: identity.ticketId };
}

async function retained(trx: Knex.Transaction, identity: OrganizationSlaIdentity, operationId: string, hash: string) {
  await acquireOrganizationSlaLock(trx, identity);
  const owner = tenantDb(trx, identity.tenant);
  const obligation = await owner.table('sla_organization_obligations').where('obligation_id', identity.obligationId).forUpdate().first();
  if (obligation && (obligation.source_tenant !== identity.sourceTenant || obligation.ticket_id !== identity.ticketId)) {
    throw new Error('Organization SLA source does not match');
  }
  const prior = await owner.table('sla_organization_events').where({ obligation_id: identity.obligationId, operation_id: operationId }).first();
  if (prior && prior.request_fingerprint !== hash) throw new Error('Organization SLA operation changed');
  return { owner, obligation, prior };
}

/** Internal persistence engine, not an authorization adapter. Callers retain the
 * actual source work, lifecycle, and credential, resolve the policy in its owning
 * tenant, and apply actual domain events in causal order in that transaction. */
export async function startOrganizationSlaObligation(trx: Knex.Transaction, inputIdentity: OrganizationSlaIdentity,
  operationId: string, input: OrganizationSlaStart): Promise<OrganizationSlaReceipt> {
  const identity = snapshot(trx, inputIdentity, operationId), request = structuredClone(input);
  if (!request || ![request.workId, request.policyId, request.priorityId].every(value => typeof value === 'string' && uuid.test(value)) ||
      !Number.isSafeInteger(request.generation) || request.generation < 1) throw new Error('Invalid organization SLA setup');
  const hash = fingerprint({ identity, kind: 'started', request });
  const { owner, obligation, prior } = await retained(trx, identity, operationId, hash);
  if (prior) return receipt(prior);
  if (obligation) throw new Error('Organization SLA obligation already exists');
  const clock = startOrganizationSlaClock(identity, request.schedule, request.targets, request.occurredAt);
  await owner.table('sla_organization_obligations').insert({ tenant: identity.tenant, obligation_id: identity.obligationId,
    source_tenant: identity.sourceTenant, ticket_id: identity.ticketId, work_id: request.workId, generation: request.generation,
    sla_policy_id: request.policyId, priority_id: request.priorityId, revision: 1, clock: JSON.stringify(clock),
    created_at: clock.startedAt, updated_at: clock.observedAt });
  const event = { tenant: identity.tenant, obligation_id: identity.obligationId, operation_id: operationId, revision: 1,
    event_type: 'started', request_fingerprint: hash, event: JSON.stringify(request), occurred_at: clock.startedAt };
  await owner.table('sla_organization_events').insert(event);
  return receipt(event);
}

export async function applyOrganizationSlaEvent(trx: Knex.Transaction, inputIdentity: OrganizationSlaIdentity,
  operationId: string, input: OrganizationSlaEvent): Promise<OrganizationSlaReceipt> {
  const identity = snapshot(trx, inputIdentity, operationId), event = structuredClone(input);
  const hash = fingerprint({ identity, event });
  const { owner, obligation, prior } = await retained(trx, identity, operationId, hash);
  if (prior) return receipt(prior);
  if (!obligation) throw new Error('Organization SLA obligation does not exist');
  let clock: OrganizationSlaClock;
  switch (event.kind) {
    case 'observed': clock = observeOrganizationSlaClock(obligation.clock, event.occurredAt); break;
    case 'paused': clock = pauseOrganizationSlaClock(obligation.clock, event.reason, event.occurredAt); break;
    case 'resumed': clock = resumeOrganizationSlaClock(obligation.clock, event.reason, event.occurredAt); break;
    case 'responded': clock = respondToOrganizationSlaClock(obligation.clock, event, event.occurredAt); break;
    case 'resolved': clock = resolveOrganizationSlaClock(obligation.clock, event.occurredAt); break;
    default: throw new Error('Invalid organization SLA event');
  }
  const revision = obligation.revision + 1;
  await owner.table('sla_organization_obligations').where('obligation_id', identity.obligationId)
    .update({ revision, clock: JSON.stringify(clock), updated_at: clock.observedAt });
  const stored = { tenant: identity.tenant, obligation_id: identity.obligationId, operation_id: operationId, revision,
    event_type: event.kind, request_fingerprint: hash, event: JSON.stringify(event), occurred_at: clock.observedAt };
  await owner.table('sla_organization_events').insert(stored);
  return receipt(stored);
}
