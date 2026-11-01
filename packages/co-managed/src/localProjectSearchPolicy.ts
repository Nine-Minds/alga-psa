import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { serves } from '@alga-psa/core/capability';
import { getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization';
import { isCoManagedWorkspace } from './coManagedWorkspace';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { lockCoManagedLocalAuthentication, type CoManagedLocalAuthentication } from './localAuthentication';
import { hasCoManagedLocalPermission } from './localPermission';
import { applyCoManagedQueuePolicy } from './queuePolicy';

/** Constructed by the authenticated transport; never accepted from search input. */
export type CoManagedSearchAuthentication = CoManagedLocalAuthentication;

/**
 * Project search policy for a co-managed customer workspace's own staff. Returns null (caller keeps
 * the ordinary search path byte-for-byte) unless the co-managed capability serves this tenant AND the
 * workspace is a `co_managed` product tenant. Retained for the whole search including counts.
 */
export async function getCoManagedLocalProjectSearchPolicy(trx: Knex.Transaction,
  actor: { tenant: string; userId: string; userType: string }, authentication?: CoManagedSearchAuthentication) {
  actor = { ...actor };
  authentication = authentication ? { ...authentication } : undefined;
  if (!trx.isTransaction || ![actor.tenant, actor.userId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  // Flag off, no entitlement or kill switch: the capability does not serve, so nothing changes.
  if (!(await serves('co-managed', actor.tenant)).served) return null;
  const owner = tenantDb(trx, actor.tenant);
  if (!await isCoManagedWorkspace(trx, actor.tenant)) return null;
  await getCoManagedOperationalState(trx, actor.tenant);
  const locked = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!locked || locked.suspended_at) throw new CoManagedSharedWorkError();
  const base = owner.table('projects').select('tenant', 'project_id', 'client_id', 'assigned_to', 'project_name', 'description', 'created_at', 'updated_at',
    trx.raw('NULL::uuid as auth_owner'), { auth_client: 'client_id', auth_assigned: 'assigned_to' }, trx.raw('NULL::uuid as auth_board'), trx.raw('NULL::uuid as auth_team'));
  const projects = trx.from(base.as('q')).select('q.*');
  // Task notes have never been a client-portal surface; requester project policy needs its own admission.
  if (actor.userType === 'client') return { projects: projects.whereRaw('false'), redactedFields: [] as string[], assertCurrent: async () => {} };
  if (actor.userType !== 'internal' || !authentication) throw new CoManagedSharedWorkError();
  const { subject, assertCurrent } = await lockCoManagedLocalAuthentication(trx, { tenant: actor.tenant, userId: actor.userId, ...authentication });
  if (!await hasCoManagedLocalPermission(trx, actor, 'project', 'read', true)) projects.whereRaw('false');
  const rules = (await resolveBundleNarrowingRulesForEvaluation(trx, { subject, resource: { type: 'project', action: 'read' }, knex: trx }, { lock: true }))
    .filter(rule => rule.resource === 'project' && rule.action === 'read');
  applyCoManagedQueuePolicy(projects, subject, rules, { resourceType: 'project', shared: false, ownerAvailable: false, boardAvailable: false });
  await assertCurrent();
  return { projects, redactedFields: rules.flatMap(rule => rule.redactedFields ?? []), assertCurrent };
}

export { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
