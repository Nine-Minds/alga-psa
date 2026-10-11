import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { assertCoManagedSeatAdmission } from '@alga-psa/licensing';
import { lockCoManagedLocalAuthentication } from './localAuthentication';
import { authorizeCoManagedLocalRecord, snapshotCoManagedSessionActor, isCoManagedUuid,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';

export type CoManagedDelegatedOperation = 'board_settings' | 'user_profile' | 'invitation_resend';
export interface CoManagedDelegatedTarget { customerTenant: string; relationshipId: string }
export interface CoManagedDelegatedGrantInput { grantId: string; principalType: 'user' | 'team'; principalId: string; operation: CoManagedDelegatedOperation; targetId: string }
const GRANTS = 'co_management_delegated_grants', RECEIPTS = 'co_management_delegated_receipts';
const operations = ['board_settings', 'user_profile', 'invitation_resend'] as const;
const spec = {
  board_settings: { table: 'boards', id: 'board_id', resource: 'ticket_settings', action: 'update', fields: ['board_name','description','enable_live_ticket_timer'] },
  user_profile: { table: 'users', id: 'user_id', resource: 'user', action: 'update', fields: ['first_name','last_name','timezone'] },
  invitation_resend: { table: 'user_invitations', id: 'invitation_id', resource: 'user', action: 'invite', fields: [] },
} as const;
const deny: () => never = () => { throw new CoManagedSharedWorkError(); };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validOperation = (value: unknown): value is CoManagedDelegatedOperation => operations.includes(value as CoManagedDelegatedOperation);
function exact(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) deny();
}
async function retain(db: Knex, inputActor: CoManagedSessionActor, inputTarget: CoManagedDelegatedTarget, customerOnly: boolean,
  callback: (context: any) => Promise<any>) {
  const actor = snapshotCoManagedSessionActor(inputActor), target = structuredClone(inputTarget);
  if (!target || ![target.customerTenant,target.relationshipId].every(isCoManagedUuid)) deny();
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, target.customerTenant), home = tenantDb(trx, actor.tenant);
    const lifecycle = await getCoManagedOperationalState(trx, target.customerTenant);
    const query = owner.table('co_management_relationships').where({ relationship_id: target.relationshipId, state: 'active' }).whereNull('ended_at');
    if (customerOnly) query.forUpdate(); else query.forShare();
    const relationship = await query.first();
    if (!relationship || ![target.customerTenant,relationship.sponsor_tenant].includes(actor.tenant) || customerOnly && actor.tenant !== target.customerTenant) deny();
    const customer = await owner.table('tenants').forShare().first('product_code','suspended_at','client_name');
    const sponsor = await tenantDb(trx, relationship.sponsor_tenant).table('tenants').forShare().first('product_code','suspended_at','client_name');
    if (customer?.product_code !== 'co_managed' || sponsor?.product_code !== 'psa' || customer.suspended_at || sponsor.suspended_at) deny();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (actor.tenant === target.customerTenant) {
      const decision = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'co_management', 'manage', { id: actor.tenant });
      if (decision.redactedFields.length) deny();
    } else {
      if (!await home.table('clients').where('client_id', relationship.sponsor_client_id).forShare().first('client_id')) deny();
      const decision = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'client', 'read', { id: relationship.sponsor_client_id, clientId: relationship.sponsor_client_id });
      if (decision.redactedFields.length) deny();
    }
    const result = await callback({ trx, actor, target, owner, home, relationship, credential, lifecycle, customer, sponsor });
    await credential.assertCurrent(); return result;
  });
}
async function nonAdministratorRole(trx: Knex.Transaction, tenant: string, roleId: string) {
  // Retain the role parent so a concurrent new role-permission FK cannot expand
  // invitation terms after the customer-approved fingerprint is checked.
  const own = tenantDb(trx, tenant), role = await own.table('roles').where({ role_id: roleId, msp: true }).forUpdate().first('role_name');
  if (!role || /^(admin|administrator)$/i.test(role.role_name)) deny();
  const permissions = own.table('role_permissions as rp').where('rp.role_id', roleId);
  own.tenantJoin(permissions, 'permissions as p', 'rp.permission_id', 'p.permission_id');
  const rows = await permissions.orderBy('p.resource').orderBy('p.action').forShare('rp','p').select('p.resource','p.action');
  if (rows.some(row => ['co_management','security_settings','role','permission','user'].includes(row.resource) && row.action !== 'read')) deny();
  return { name: role.role_name, permissions: rows };
}
async function targetRecord(context: any, operation: CoManagedDelegatedOperation, targetId: string, write = false) {
  const { trx, owner, target } = context, definition = spec[operation];
  const query = owner.table(definition.table).where(definition.id, targetId);
  if (write) query.forUpdate(); else query.forShare();
  const row = await query.first(); if (!row) deny();
  if (operation === 'board_settings') {
    if (row.is_inactive) deny();
    return { row, label: row.board_name, values: { board_name: row.board_name, description: row.description, enable_live_ticket_timer: row.enable_live_ticket_timer }, fingerprint: null };
  }
  if (operation === 'user_profile') {
    if (row.user_type !== 'internal' || row.is_inactive) deny();
    const roles = await owner.table('user_roles').where('user_id', targetId).forShare().select('role_id');
    if (!roles.length) deny();
    for (const role of roles) await nonAdministratorRole(trx, target.customerTenant, role.role_id);
    return { row, label: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'User profile',
      values: { first_name: row.first_name, last_name: row.last_name, timezone: row.timezone }, fingerprint: null };
  }
  if (row.used_at || row.metadata?.co_managed_initial_admin || !isCoManagedUuid(row.metadata?.created_by) ||
      !await owner.table('users').where({ user_id: row.metadata.created_by, user_type: 'internal' }).forShare().first('user_id') ||
      !await owner.table('user_invitations').where('invitation_id', targetId).where('expires_at','>',trx.raw('clock_timestamp()')).first('invitation_id')) deny();
  const role = await nonAdministratorRole(trx, target.customerTenant, row.role_id);
  if (await owner.table('users').where({ user_type: 'internal' }).whereRaw('lower(trim(email)) = ?', [row.email.trim().toLowerCase()]).first('user_id')) deny();
  return { row, label: row.email, roleName: role.name, values: { email: row.email, first_name: row.first_name, last_name: row.last_name, role: role.name, expires_at: new Date(row.expires_at).toISOString() },
    fingerprint: hash([row.email,row.first_name,row.last_name,row.role_id,role.permissions,row.metadata,row.token,new Date(row.expires_at).toISOString()]) };
}
async function customerTarget(context: any, operation: CoManagedDelegatedOperation, targetId: string) {
  const definition = spec[operation];
  const decision = await authorizeCoManagedLocalRecord(context.trx, context.actor, context.credential.subject, definition.resource, definition.action, { id: targetId,
    ...(operation === 'board_settings' ? { boardId: targetId } : operation === 'user_profile' ? { ownerUserId: targetId } : {}) });
  if (decision.redactedFields.length) deny();
  return targetRecord(context, operation, targetId);
}
async function assignedPrincipal(context: any, kind: string, id: string) {
  const sponsor = tenantDb(context.trx, context.relationship.sponsor_tenant);
  if (!await sponsor.table('co_management_staff_assignments').where({ customer_tenant: context.target.customerTenant,
    relationship_id: context.target.relationshipId, principal_type: kind, principal_id: id, relationship_role: 'technician' }).forShare().first()) deny();
  const query = sponsor.table(kind === 'user' ? 'users' : 'teams').where(kind === 'user' ? 'user_id' : 'team_id', id);
  if (kind === 'user') query.where({ user_type: 'internal', is_inactive: false });
  const row = await query.forShare().first(); if (!row) deny();
  return kind === 'user' ? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.username : row.team_name;
}
async function recordGrantChange(context: any, grantId: string, eventType: string, scope: unknown) {
  const revision = context.relationship.revision + 1;
  if (!Number.isSafeInteger(revision) || revision >= 2147483647) deny();
  await context.owner.table('co_management_relationships').where('relationship_id', context.target.relationshipId).update({ revision, updated_at: context.trx.fn.now() });
  await context.owner.table('co_management_relationship_events').insert({ tenant: context.target.customerTenant, event_id: randomUUID(), relationship_id: context.target.relationshipId,
    revision, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId, event_type: eventType, scope: { grantId, ...scope as object }, scope_fingerprint: hash(scope) });
  return revision;
}
export async function saveCoManagedDelegatedGrant(db: Knex, actor: CoManagedSessionActor, target: CoManagedDelegatedTarget, expectedRevision: number, input: CoManagedDelegatedGrantInput) {
  exact(input,['grantId','principalType','principalId','operation','targetId']);
  const grant = structuredClone(input);
  if (!grant || ![grant.grantId,grant.principalId,grant.targetId].every(isCoManagedUuid) || !['user','team'].includes(grant.principalType) || !validOperation(grant.operation)) deny();
  return retain(db, actor, target, true, async context => {
    const { actor, target } = context;
    if (!context.lifecycle.canWrite) deny();
    await assignedPrincipal(context, grant.principalType, grant.principalId);
    const selected = await customerTarget(context, grant.operation, grant.targetId);
    const row = { principal_type: grant.principalType, principal_id: grant.principalId, operation: grant.operation, target_id: grant.targetId, target_fingerprint: selected.fingerprint };
    const old = await context.owner.table(GRANTS).where('grant_id',grant.grantId).forUpdate().first();
    // A grant ID is an immutable customer approval. Re-approval after revocation
    // uses a new ID, so an old command can never be redirected to another target.
    if (old && (old.relationship_id !== target.relationshipId || old.revoked_at || !Object.entries(row).every(([key,value]) => old[key] === value))) deny();
    if (old && !old.revoked_at && Object.entries(row).every(([key,value]) => old[key] === value) && expectedRevision === old.approved_revision - 1) return { revision: context.relationship.revision };
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== context.relationship.revision) throw new Error('Co-managed delegation changed; refresh before saving');
    if (old) return { revision: context.relationship.revision };
    const revision = await recordGrantChange(context, grant.grantId, 'delegation_granted', row);
    const values = { ...row, approved_by: actor.userId, approved_revision: revision, revoked_at: null };
    await context.owner.table(GRANTS).insert({ tenant: target.customerTenant, grant_id: grant.grantId, relationship_id: target.relationshipId, ...values });
    return { revision };
  });
}
export async function revokeCoManagedDelegatedGrant(db: Knex, actor: CoManagedSessionActor, target: CoManagedDelegatedTarget, expectedRevision: number, grantId: string) {
  if (!isCoManagedUuid(grantId)) deny();
  return retain(db,actor,target,true,async context => {
    const { actor, target } = context;
    const row = await context.owner.table(GRANTS).where({ grant_id: grantId, relationship_id: target.relationshipId }).forUpdate().first();
    if (!row) deny(); if (row.revoked_at) return { revision: context.relationship.revision };
    if (expectedRevision !== context.relationship.revision) throw new Error('Co-managed delegation changed; refresh before saving');
    await context.owner.table(GRANTS).where('grant_id',grantId).update({ revoked_at: context.trx.raw('now()') });
    return { revision: await recordGrantChange(context,grantId,'delegation_revoked',{}) };
  });
}
async function admitGrant(context: any, grant: any, write: boolean) {
  if (context.actor.tenant !== context.relationship.sponsor_tenant || grant.revoked_at || !validOperation(grant.operation)) deny();
  if (grant.principal_type === 'user' ? grant.principal_id !== context.actor.userId : !context.credential.subject.teamIds?.includes(grant.principal_id)) deny();
  await assignedPrincipal(context,grant.principal_type,grant.principal_id);
  const definition = spec[grant.operation as CoManagedDelegatedOperation];
  const decision = await authorizeCoManagedLocalRecord(context.trx,context.actor,context.credential.subject,definition.resource, write ? definition.action : 'read', {
    id: `${context.target.customerTenant}:delegated:${grant.operation}:${grant.target_id}`, clientId: context.relationship.sponsor_client_id,
    assignedUserIds: grant.principal_type === 'user' ? [grant.principal_id] : [], teamIds: grant.principal_type === 'team' ? [grant.principal_id] : [],
  });
  if (decision.redactedFields.length) deny();
  const selected = await targetRecord(context,grant.operation,grant.target_id,write);
  if (selected.fingerprint !== grant.target_fingerprint) deny();
  return selected;
}
export async function getCoManagedDelegatedScreen(db: Knex, actor: CoManagedSessionActor, target: CoManagedDelegatedTarget) {
  return retain(db,actor,target,false,async context => {
    const { actor, target } = context;
    const side = actor.tenant === target.customerTenant ? 'customer' : 'sponsor';
    const rows = await context.owner.table(GRANTS).where('relationship_id',target.relationshipId).whereNull('revoked_at').orderBy('grant_id').forShare();
    const grants: any[] = [];
    for (const row of rows) {
      try {
        const selected = side === 'customer' ? await customerTarget(context,row.operation,row.target_id) : await admitGrant(context,row,false);
        const principalName = await assignedPrincipal(context,row.principal_type,row.principal_id);
        grants.push({ grantId: row.grant_id, operation: row.operation, targetId: row.target_id, principalName, label: selected.label, values: selected.values,
          version: hash(selected.values), available: true });
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error;
        if (side === 'customer') grants.push({ grantId: row.grant_id, operation: row.operation, targetId: row.target_id, available: false }); }
    }
    return { side, workspaceName: context.customer.client_name, sponsorName: context.sponsor.client_name, revision: context.relationship.revision, canWrite: context.lifecycle.canWrite, grants };
  });
}
export async function searchCoManagedDelegatedOptions(db: Knex, actor: CoManagedSessionActor, target: CoManagedDelegatedTarget,
  input: { kind: 'principal' | CoManagedDelegatedOperation; search?: string; page?: number }) {
  if (!input || input.kind !== 'principal' && !validOperation(input.kind) || typeof (input.search ?? '') !== 'string' || (input.search?.length ?? 0) > 100 || !Number.isSafeInteger(input.page ?? 0) || (input.page ?? 0) < 0 || (input.page ?? 0) > 10000) deny();
  input = structuredClone(input);
  return retain(db,actor,target,true,async context => {
    const { actor, target } = context;
    const page = input.page ?? 0, search = (input.search?.trim() ?? '').toLowerCase(), options: { id: string; name: string; kind?: 'user' | 'team' }[] = [];
    // Exhaust the candidate relation in bounded keyset batches. Admission and
    // display-field search precede pagination: hidden records cannot influence
    // page boundaries or hasMore, and private identity fields are never searched.
    const matches = (name: string) => !search || name.toLowerCase().includes(search);
    if (input.kind === 'principal') {
      for (const kind of ['user','team'] as const) {
        let after: string | undefined;
        while (true) {
          const query = tenantDb(context.trx,context.relationship.sponsor_tenant).table('co_management_staff_assignments')
            .where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId, relationship_role: 'technician', principal_type: kind })
            .orderBy('principal_id').limit(100).select('principal_id');
          if (after) query.where('principal_id','>',after);
          const rows = await query;
          for (const row of rows) try {
            const name = await assignedPrincipal(context,kind,row.principal_id);
            if (matches(name)) options.push({ id: row.principal_id, kind, name });
          } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
          if (rows.length < 100) break;
          after = rows[rows.length-1].principal_id;
        }
      }
    } else {
      const definition = spec[input.kind]; let after: string | undefined;
      while (true) {
        const query = context.owner.table(definition.table).orderBy(definition.id).limit(100).select(definition.id);
        if (after) query.where(definition.id,'>',after);
        const rows = await query;
        for (const row of rows) try {
          const selected = await customerTarget(context,input.kind,row[definition.id]);
          if (matches(selected.label)) options.push({ id: row[definition.id], name: selected.label });
        } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
        if (rows.length < 100) break;
        after = rows[rows.length-1][definition.id];
      }
    }
    return { options: options.slice(page*25,(page+1)*25), hasMore: options.length > (page+1)*25 };
  });
}
export interface CoManagedDelegatedCommand { operationId: string; grantId: string; expectedVersion: string; patch?: Record<string,unknown> }
export async function executeCoManagedDelegatedCommand(db: Knex, actor: CoManagedSessionActor, target: CoManagedDelegatedTarget, input: CoManagedDelegatedCommand,
  sendInvitation?: (input: { customerTenant: string; email: string; name: string; roleName: string; workspaceName: string; invitedByName: string; token: string; expiresAt: string }) => Promise<boolean>) {
  exact(input,['operationId','grantId','expectedVersion','patch']); const command = structuredClone(input);
  if (!command || ![command.operationId,command.grantId].every(isCoManagedUuid) || !/^[a-f0-9]{64}$/.test(command.expectedVersion)) deny();
  return retain(db,actor,target,false,async context => {
    const { actor, target } = context;
    await assertCoManagedOperationalWrite(context.trx,target.customerTenant);
    const grant = await context.owner.table(GRANTS).where({ grant_id: command.grantId, relationship_id: target.relationshipId }).forShare().first();
    if (!grant) deny();
    await context.trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`co-delegated:${target.customerTenant}:${command.operationId}`]);
    const selected = await admitGrant(context,grant,true), fingerprint = hash({ actor: [actor.tenant,actor.userId], target, command });
    const previous = await context.owner.table(RECEIPTS).where('operation_id',command.operationId).first();
    if (previous) { if (previous.request_fingerprint !== fingerprint) deny(); return { completed: true }; }
    if (hash(selected.values) !== command.expectedVersion) throw new Error('Delegated target changed; refresh before saving');
    const operation = grant.operation as CoManagedDelegatedOperation, definition = spec[operation], patch = command.patch ?? {};
    exact(patch,definition.fields);
    if (operation === 'invitation_resend') {
      if (typeof sendInvitation !== 'function' || Object.keys(patch).length) deny();
      await assertCoManagedSeatAdmission(context.trx,target.customerTenant,{ kind: 'invitation', email: selected.row.email });
      await context.credential.assertCurrent();
      if (!await sendInvitation({ customerTenant: target.customerTenant, email: selected.row.email,
        name: `${selected.row.first_name} ${selected.row.last_name}`.trim(), roleName: selected.roleName!, workspaceName: context.customer.client_name,
        invitedByName: selected.row.metadata.invited_by_name || context.customer.client_name, token: selected.row.token, expiresAt: new Date(selected.row.expires_at).toISOString() })) throw new Error('Invitation delivery failed');
    } else {
      if (!Object.keys(patch).length) deny();
      for (const [key,value] of Object.entries(patch)) {
        if (key === 'enable_live_ticket_timer') { if (typeof value !== 'boolean') deny(); }
        else if (typeof value !== 'string' || value.length > (key === 'description' ? 2000 : 200) || key !== 'description' && !value.trim()) deny();
        if (key === 'timezone') try { new Intl.DateTimeFormat('en',{ timeZone: String(value) }).format(); } catch { deny(); }
      }
      await context.owner.table(definition.table).where(definition.id,grant.target_id).update({ ...patch, ...(operation === 'user_profile' ? { updated_at: context.trx.fn.now() } : {}) });
    }
    await context.credential.assertCurrent(); await assertCoManagedOperationalWrite(context.trx,target.customerTenant);
    await context.owner.table(RECEIPTS).insert({ tenant: target.customerTenant, operation_id: command.operationId, grant_id: command.grantId,
      actor_tenant: actor.tenant, actor_user_id: actor.userId, request_fingerprint: fingerprint });
    await context.owner.table('audit_logs').insert({ tenant: target.customerTenant, audit_id: randomUUID(), user_id: null, operation: 'co_managed_delegated_administration',
      table_name: definition.table, record_id: grant.target_id, changed_data: {}, details: { actor_tenant: actor.tenant, actor_user_id: actor.userId,
        relationship_id: target.relationshipId, grant_id: grant.grant_id, operation_id: command.operationId, delegated_operation: operation, changed_fields: Object.keys(patch).sort() } });
    return { completed: true };
  });
}

/** Discovery never needs the sponsor management directory: only currently
 * assigned relationships with at least one readable customer grant appear. */
export async function listCoManagedDelegatedWorkspaces(db: Knex, inputActor: CoManagedSessionActor) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  const candidates = await withTransaction(db, async trx => {
    const credential = await lockCoManagedLocalAuthentication(trx,actor), home = tenantDb(trx,actor.tenant);
    if (!await home.table('tenants').where({ product_code: 'psa' }).whereNull('suspended_at').forShare().first()) deny();
    const assignments = await home.table('co_management_staff_assignments').where('relationship_role','technician')
      .where(query => query.where({ principal_type: 'user', principal_id: actor.userId })
        .orWhere(nested => nested.where('principal_type','team').whereIn('principal_id',credential.subject.teamIds ?? [])))
      .select('relationship_id','customer_tenant');
    const result: { operationId: string; customerTenant: string; relationshipId: string }[] = [];
    for (const assignment of assignments) {
      const operation = await home.table('co_managed_provisioning_operations').where({ relationship_id: assignment.relationship_id, customer_tenant: assignment.customer_tenant })
        .first('operation_id');
      if (operation && !result.some(row => row.operationId === operation.operation_id)) result.push({ operationId: operation.operation_id as string,
        customerTenant: assignment.customer_tenant as string, relationshipId: assignment.relationship_id as string });
    }
    await credential.assertCurrent(); return result;
  });
  const workspaces: { operationId: string; name: string }[] = [];
  for (const candidate of candidates) {
    try { const screen = await getCoManagedDelegatedScreen(db,actor,candidate);
      if (screen.grants.length) workspaces.push({ operationId: candidate.operationId, name: screen.workspaceName });
    } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
  }
  await withTransaction(db,async trx => { await (await lockCoManagedLocalAuthentication(trx,actor)).assertCurrent(); });
  return workspaces.sort((a,b) => a.name.localeCompare(b.name));
}
