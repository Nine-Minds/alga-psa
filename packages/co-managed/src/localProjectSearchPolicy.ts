import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedActiveHomeIdentity, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';
import { applyCoManagedQueuePolicy } from './queuePolicy';

/** Constructed by the authenticated transport; never accepted from search input. */
export type CoManagedSearchAuthentication = { kind: 'session'; sessionId: string } | { kind: 'api_key'; apiKeyId: string };

/** Retains local project policy for a whole search (including counts). Customer
 * ownership survives departure; this grants no access to another tenant's index. */
export async function getCoManagedLocalProjectSearchPolicy(trx: Knex.Transaction,
  actor: { tenant: string; userId: string; userType: string }, authentication?: CoManagedSearchAuthentication) {
  actor = { ...actor };
  authentication = authentication ? { ...authentication } : undefined;
  if (!trx.isTransaction || ![actor.tenant, actor.userId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  await getCoManagedOperationalState(trx, actor.tenant);
  if (!await hasCoManagedConversationOwnership(trx, actor.tenant)) return null;
  const owner = tenantDb(trx, actor.tenant);
  const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!['psa', 'co_managed'].includes(workspace?.product_code) || workspace.suspended_at) throw new CoManagedSharedWorkError();
  const base = owner.table('projects').select('tenant', 'project_id', 'client_id', 'assigned_to', 'project_name', 'description', 'created_at', 'updated_at',
    trx.raw('NULL::uuid as auth_owner'), { auth_client: 'client_id', auth_assigned: 'assigned_to' }, trx.raw('NULL::uuid as auth_board'), trx.raw('NULL::uuid as auth_team'));
  const projects = trx.from(base.as('q')).select('q.*');
  // Task notes have never been a client-portal surface. Requester project policy
  // needs its own admission before any of this family becomes portal-searchable.
  if (actor.userType === 'client') return { projects: projects.whereRaw('false'), redactedFields: [] as string[], assertCurrent: async () => {} };
  if (actor.userType !== 'internal' || !authentication) throw new CoManagedSharedWorkError();
  const sessionActor = authentication.kind === 'session' ? { ...actor, kind: 'session' as const, sessionId: authentication.sessionId } : null;
  const subject = sessionActor ? await lockCoManagedSessionIdentity(trx, sessionActor) : await lockCoManagedActiveHomeIdentity(trx, actor);
  let assertCurrent: () => Promise<void>;
  if (sessionActor) assertCurrent = () => assertCoManagedSessionUnexpired(trx, sessionActor);
  else {
    if (authentication.kind !== 'api_key' || !isCoManagedUuid(authentication.apiKeyId)) throw new CoManagedSharedWorkError();
    const keyId = authentication.apiKeyId;
    const keyQuery = () => owner.table('api_keys').where({ api_key_id: keyId, user_id: actor.userId, active: true })
      .where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()')));
    if (!await keyQuery().forShare().first('api_key_id')) throw new CoManagedSharedWorkError();
    subject.apiKeyId = keyId;
    assertCurrent = async () => { if (!await keyQuery().first('api_key_id')) throw new CoManagedSharedWorkError(); };
  }
  if (!await hasCoManagedLocalPermission(trx, actor, 'project', 'read', true)) projects.whereRaw('false');
  const rules = (await resolveBundleNarrowingRulesForEvaluation(trx, { subject, resource: { type: 'project', action: 'read' }, knex: trx }, { lock: true }))
    .filter(rule => rule.resource === 'project' && rule.action === 'read');
  applyCoManagedQueuePolicy(projects, subject, rules, { resourceType: 'project', shared: false, ownerAvailable: false, boardAvailable: false });
  await assertCurrent();
  return { projects, redactedFields: rules.flatMap(rule => rule.redactedFields ?? []), assertCurrent };
}

export { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
export { coManagedConversationBodySources } from './conversationPolicy';
