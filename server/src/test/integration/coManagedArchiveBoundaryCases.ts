/**
 * Shared fixture and boundary cases for L7a (closure + archive), run against real Postgres by
 * coManagedDepartureArchive.db.test.ts. Kept as a module so later cards (restore/upgrade) can reuse
 * the same fixture and the same per-class "retained present / private absent" assertions.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import type { CoManagedSessionActor } from '@alga-psa/co-managed';

export const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface BoundaryFixture {
  msp: string; customer: string; relationshipId: string; sponsorClient: string; seats: number;
  mspAdmin: CoManagedSessionActor; customerAdmin: CoManagedSessionActor; stranger: CoManagedSessionActor;
  evidence: Record<'sharedMessage' | 'requesterMessage' | 'privateMessage' | 'customerPrivate' | 'afterCutoff' | 'audit' | 'unknownClass', string>;
}

async function actorFor(db: Knex, tenant: string, permissions: Array<[string, string]>): Promise<CoManagedSessionActor> {
  const userId = await createUser(db, tenant, { user_type: 'internal' });
  const roleId = randomUUID();
  await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
  for (const [resource, action] of permissions) {
    const permissionId = randomUUID();
    await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
    await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
  }
  await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  const sessionId = randomUUID();
  await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600_000), created_at: new Date() });
  return { kind: 'session', tenant, userId, sessionId };
}

/** One active sponsor/customer relationship with a 3-seat allocation and one evidence row per class/audience. */
export async function seedBoundaryFixture(db: Knex): Promise<BoundaryFixture> {
  const msp = await createTenant(db, 'Boundary MSP', { productCode: 'psa' });
  const customer = await createTenant(db, 'Boundary Customer', { productCode: 'co_managed' });
  const sponsorClient = await createClient(db, msp, 'Boundary customer (MSP side)');
  const mspAdmin = await actorFor(db, msp, [['co_management', 'manage'], ['co_management', 'read']]);
  const customerAdmin = await actorFor(db, customer, [['co_management', 'manage'], ['co_management', 'read']]);
  const stranger = await actorFor(db, msp, [['ticket', 'read']]);
  const relationshipId = randomUUID(), seats = 3;
  await db('co_management_relationships').insert({ tenant: customer, relationship_id: relationshipId, sponsor_tenant: msp,
    sponsor_client_id: sponsorClient, state: 'active', visibility_mode: 'board_scope', accepted_by: customerAdmin.userId, accepted_at: new Date() });
  await db('co_managed_entitlements').insert({ tenant: msp, source: 'admin_grant', source_reference: 'l7a-test', capacity: 10,
    verified_at: new Date(), valid_until: new Date(Date.now() + 365 * 86_400_000) });
  await db('co_managed_allocations').insert({ tenant: msp, allocation_id: randomUUID(), operation_id: randomUUID(), request_fingerprint: sha('alloc'),
    customer_tenant: customer, relationship_id: relationshipId, seats, state: 'active' });

  const resourceId = randomUUID();
  const row = (name: string, sourceType: string, payload: Record<string, unknown>, occurredAt: Date) => {
    const evidenceId = randomUUID();
    return { name, evidenceId, record: { tenant: msp, evidence_id: evidenceId, customer_tenant: customer, relationship_id: relationshipId,
      resource_id: resourceId, resource_type: 'ticket', client_id: sponsorClient, source_type: sourceType, source_id: randomUUID(),
      operation_id: randomUUID(), event_type: 'recorded', actor_tenant: msp, actor_user_id: mspAdmin.userId, actor_kind: 'user',
      actor_name: 'Tech', actor_organization: 'Boundary MSP', payload: JSON.stringify(payload), payload_hash: sha(payload), occurred_at: occurredAt } };
  };
  const past = new Date(Date.now() - 3600_000), future = new Date(Date.now() + 86_400_000);
  const rows = [
    row('sharedMessage', 'conversation', { audience: 'shared_it', markdown: 'shared with IT' }, past),
    row('requesterMessage', 'conversation', { audience: 'requester', markdown: 'told the requester' }, past),
    row('privateMessage', 'private_conversation', { audience: 'organization_private', markdown: 'MSP-private note' }, past),
    row('customerPrivate', 'conversation', { audience: 'internal', markdown: 'CUSTOMER-PRIVATE SECRET' }, past),
    row('afterCutoff', 'conversation', { audience: 'shared_it', markdown: 'POST-CUTOFF SECRET' }, future),
    row('audit', 'work_audit', { changes: { task_name: 'renamed' } }, past),
    // `time_entry` rows cannot be stored yet (the source_type CHECK predates them); an unknown class
    // stands in to prove the allowlist excludes by default.
  ];
  const evidence = {} as BoundaryFixture['evidence'];
  for (const r of rows) { await db('co_managed_participation_evidence').insert(r.record); (evidence as any)[r.name] = r.evidenceId; }
  return { msp, customer, relationshipId, sponsorClient, seats, mspAdmin, customerAdmin, stranger, evidence };
}
