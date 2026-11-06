import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import type { AmpPackageRows } from '@alga-psa/migration-spec';
import { hasCoManagedLocalPermission, isCoManagedPermissionProvisioned } from '@alga-psa/co-managed/localPermission';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, type CoManagedSessionActor } from '@alga-psa/co-managed/sharedWorkIdentity';

/** The workspace grant covers retained data in domains this product does not provision. A
 * provisioned-but-denied native scope or a bundle field mask must never become an export bypass. */
export async function authorizeAmpWorkspaceExport(trx: Knex.Transaction, actor: CoManagedSessionActor, subject: AuthorizationSubject, rows: AmpPackageRows): Promise<void> {
  const provisioned = new Set<string>();
  for (const [resource, action] of [
    ['user', 'read'], ['team', 'read'], ['client', 'read'], ['contact', 'read'], ['security_settings', 'read'],
    ['ticket', 'read'], ['ticket_settings', 'read'], ['project', 'read'], ['asset', 'read'],
    ['workflow', 'read'], ['workflow', 'admin'], ['timesheet', 'read'], ['user_schedule', 'read'],
    ['interaction', 'read'], ['document', 'read'],
  ]) {
    if (!await isCoManagedPermissionProvisioned(trx, actor.tenant, resource, action, true)) continue;
    provisioned.add(resource);
    if (!await hasCoManagedLocalPermission(trx, actor, resource, action, true)) throw new CoManagedSharedWorkError();
  }
  if (provisioned.has('security_settings')) {
    const decision = await authorizeCoManagedLocalRecord(trx, actor, subject, 'security_settings', 'read', { id: actor.tenant });
    if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
  }
  const entities = rows as Record<string, readonly Record<string, unknown>[]>;
  const ids = new Map(Object.values(entities).flatMap(records => records.map(row => [String(row.package_record_id), String(row.source_record_id)] as const)));
  const sourceId = (value: unknown) => value == null ? undefined : ids.get(String(value));
  for (const [entity, resource] of [['people', 'user'], ['teams', 'team'], ['organizations', 'client'], ['contacts', 'contact'], ['assets', 'asset']] as const) {
    if (!provisioned.has(resource)) continue;
    for (const row of entities[entity] ?? []) {
      const links = entity === 'assets' ? (rows.asset_links ?? []).filter(link => link.asset_package_record_id === row.package_record_id) : [];
      const users = links.filter(link => link.target_type === 'people').map(link => sourceId(link.target_id)).filter((id): id is string => Boolean(id));
      const teams = links.filter(link => link.target_type === 'teams').map(link => sourceId(link.target_id)).filter((id): id is string => Boolean(id));
      const decision = await authorizeCoManagedLocalRecord(trx, actor, subject, resource, 'read', {
        id: String(row.source_record_id), clientId: entity === 'organizations' ? String(row.source_record_id) : sourceId(row.organization_package_record_id),
        ownerUserId: entity === 'people' ? String(row.source_record_id) : entity === 'assets' ? users[0] : sourceId(row.manager_package_record_id),
        assignedUserIds: users, teamIds: entity === 'teams' ? [String(row.source_record_id)] : teams,
      });
      if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
    }
  }
}
