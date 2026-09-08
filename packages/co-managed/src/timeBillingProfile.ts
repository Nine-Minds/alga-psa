import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { listClientBillingProfiles } from '@alga-psa/shared/billingClients/billingProfiles';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { authorizeCoManagedLocalRecord, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  snapshotCoManagedSessionActor, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { registerCoManagedTimeWorkReference } from './timeWorkReference';

const fields = ['billing', 'billing_profile_id', 'client_billing_profiles', 'client_id', 'co_managed_time_work_references.billing_profile_id'];
const hidden = (redactions: readonly string[]) => isCoManagedReadFieldHidden(redactions,
  fields.flatMap(field => [field, `values.${field}`, `tickets.${field}`, `project_tasks.${field}`, `clients.${field}`, `time_entries.${field}`]));
export class CoManagedTimeBillingProfileError extends Error {
  constructor(readonly code: 'INVALID_TIME_BILLING_PROFILE' | 'TIME_BILLING_PROFILE_CHANGED') { super(code); }
}
export interface CoManagedTimeBillingProfileChange { expectedProfileId: string | null; profileId: string | null }

async function withProfile<T>(db: Knex, suppliedActor: CoManagedSessionActor, suppliedResource: CoManagedSharedResource,
  command: (context: CoManagedSharedWorkContext, actor: CoManagedSessionActor, clientId: string) => Promise<T>) {
  const actor = snapshotCoManagedSessionActor(suppliedActor), resource = { ...suppliedResource };
  if (!['ticket', 'project_task'].includes(resource.kind) || resource.tenant === actor.tenant) throw new CoManagedSharedWorkError();
  return withCoManagedSharedWork(db, actor, resource, 'update', write =>
    withCoManagedSharedWork(write.trx, actor, write.resource, 'read', async read => {
      if (hidden([...write.redactedFields, ...read.redactedFields])) throw new CoManagedSharedWorkError();
      const home = tenantDb(write.trx, actor.tenant), owner = tenantDb(write.trx, read.resource.tenant);
      const relationship = await owner.table('co_management_relationships').where('relationship_id', read.resource.relationshipId).first('sponsor_client_id');
      const client = relationship && await home.table('clients').where({ client_id: relationship.sponsor_client_id, is_inactive: false }).forShare().first('client_id');
      if (!client) throw new CoManagedSharedWorkError();
      const subject = await lockCoManagedSessionIdentity(write.trx, actor);
      const record = { clientId: client.client_id, ownerUserId: actor.userId, assignedUserIds: [actor.userId] };
      const clientDecision = await authorizeCoManagedLocalRecord(write.trx, actor, subject, 'client', 'read', { id: client.client_id, clientId: client.client_id });
      if (hidden(clientDecision.redactedFields) || isCoManagedReadFieldHidden(clientDecision.redactedFields, ['name', 'client_billing_profiles.name'])) throw new CoManagedSharedWorkError();
      for (const action of ['read', 'create']) {
        const decision = await authorizeCoManagedLocalRecord(write.trx, actor, subject, 'time_entry', action, record);
        if (hidden(decision.redactedFields)) throw new CoManagedSharedWorkError();
      }
      const result = await command(write, actor, client.client_id);
      await assertCoManagedSessionUnexpired(write.trx, actor);
      await assertCoManagedOperationalWrite(write.trx, read.resource.tenant);
      return result;
    }));
}

/** A work-level soft default, identical to the native ticket/project picker.
 * Contract attribution wins; null leaves the native client/default resolution.
 * Listing does not create an MSP time-work identity or capture participation. */
export async function getCoManagedTimeBillingProfile(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource) {
  return withProfile(db, actor, resource, async (context, actor, clientId) => {
    const home = tenantDb(context.trx, actor.tenant);
    const reference = await home.table('co_managed_time_work_references').where({ customer_tenant: context.resource.tenant,
      relationship_id: context.resource.relationshipId, source_kind: context.resource.kind, source_id: context.resource.id }).forShare().first('client_id', 'billing_profile_id');
    if (reference && reference.client_id !== clientId) throw new CoManagedSharedWorkError();
    const profiles = await listClientBillingProfiles(context.trx, actor.tenant, clientId);
    return { clientId, profileId: (reference?.billing_profile_id ?? null) as string | null, profiles };
  });
}

/** Only the local work default changes. Existing entry contracts, approvals,
 * invoice links and immutable invoice snapshots are never rewritten. Native
 * billing keeps its existing precedence for new and uncontracted effort. */
export async function setCoManagedTimeBillingProfile(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  input: CoManagedTimeBillingProfileChange) {
  if (!input || Object.keys(input).some(key => !['expectedProfileId', 'profileId'].includes(key)) ||
      ![input.expectedProfileId, input.profileId].every(value => value === null || isCoManagedUuid(value))) throw new CoManagedTimeBillingProfileError('INVALID_TIME_BILLING_PROFILE');
  const request = { expectedProfileId: input.expectedProfileId?.toLowerCase() ?? null, profileId: input.profileId?.toLowerCase() ?? null };
  return withProfile(db, actor, resource, async (context, actor, clientId) => {
    const home = tenantDb(context.trx, actor.tenant);
    if (request.profileId && !await home.table('client_billing_profiles').where({ billing_profile_id: request.profileId,
      client_id: clientId, is_active: true }).forShare().first('billing_profile_id')) throw new CoManagedTimeBillingProfileError('INVALID_TIME_BILLING_PROFILE');
    const registered = await registerCoManagedTimeWorkReference(context.trx, actor, context.resource);
    const query = () => home.table('co_managed_time_work_references').where({ reference_id: registered.referenceId, client_id: clientId });
    const current = await query().forUpdate().first('billing_profile_id');
    if (!current) throw new CoManagedSharedWorkError();
    if (current.billing_profile_id === request.profileId) return { profileId: request.profileId };
    if (current.billing_profile_id !== request.expectedProfileId) throw new CoManagedTimeBillingProfileError('TIME_BILLING_PROFILE_CHANGED');
    await query().update({ billing_profile_id: request.profileId });
    await home.table('audit_logs').insert({ tenant: actor.tenant, audit_id: randomUUID(), table_name: 'co_managed_time_work_references',
      record_id: registered.referenceId, operation: 'UPDATE', user_id: actor.userId, timestamp: context.trx.raw('clock_timestamp()'),
      changed_data: { billing_profile_id: request.profileId }, details: { previous_billing_profile_id: current.billing_profile_id } });
    return { profileId: request.profileId };
  });
}
