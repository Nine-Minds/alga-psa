import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

export function registerCoManagedDelegatedAdministrationCases(getDb: () => Knex, fixture: () => Promise<any>) {
  async function setup(invitation = false) {
    const f = await fixture(), db = getDb(), domain = await import('../../../../../packages/co-managed/src/delegatedAdministration');
    // The base shared-work fixture intentionally grants only ticket/project access.
    // Delegation also requires the actor's actual native administration permissions.
    for (const [resource, action] of [['client','read'],['ticket_settings','read'],['ticket_settings','update'],['user','read'],['user','update'],['user','invite']]) {
      const permission = await f.customer.table('permissions').where({ resource, action, msp: true, client: false }).first();
      await f.sponsor.table('permissions').insert({ ...permission, tenant: f.principal.tenant }).onConflict(['tenant','permission_id']).ignore();
      await f.sponsor.table('role_permissions').insert({ tenant: f.principal.tenant, role_id: f.roleId, permission_id: permission.permission_id }).onConflict().ignore();
    }
    const roleId = randomUUID(), targetId = randomUUID();
    await f.customer.table('roles').insert({ tenant: f.actor.tenant, role_id: roleId, role_name: `Delegated ordinary ${roleId}`, msp: true, client: false });
    if (invitation) await f.customer.table('user_invitations').insert({ tenant: f.actor.tenant, invitation_id: targetId, email: `customer-${targetId}@example.test`,
      first_name: 'Customer', last_name: 'Invitee', role_id: roleId, token: randomUUID(), expires_at: new Date(Date.now()+3600000),
      metadata: { created_by: f.actor.userId, invited_by_name: 'Customer Admin' } });
    else {
      const ownUser = await f.customer.table('users').where('user_id',f.actor.userId).first();
      await f.customer.table('users').insert({ ...ownUser, user_id: targetId, username: `customer-${targetId}`, email: `customer-${targetId}@example.test`,
        first_name: 'Customer', last_name: 'Technician', timezone: 'UTC' });
      await f.customer.table('user_roles').insert({ tenant: f.actor.tenant, user_id: targetId, role_id: roleId });
    }
    const target = f.target, revision = async () => (await f.customer.table('co_management_relationships').first()).revision;
    const grant = async (operation: any, id = targetId, principalType: 'user'|'team' = 'user', principalId = f.principal.userId) => {
      const input = { grantId: randomUUID(), operation, targetId: id, principalType, principalId };
      await domain.saveCoManagedDelegatedGrant(db,f.customerPrincipal,target,await revision(),input); return input;
    };
    const screen = () => domain.getCoManagedDelegatedScreen(db,f.principal,target);
    const command = async (input: any, patch?: any) => ({ operationId: randomUUID(), grantId: input.grantId,
      expectedVersion: (await screen()).grants.find((row: any) => row.grantId === input.grantId).version, ...(patch ? { patch } : {}) });
    return { ...f, ...domain, db, target, homeRoleId:f.roleId, roleId, targetId, revision, grant, screen, command };
  }
  it('delegated administration edits only approved board/profile fields with exact retries and qualified attribution', async () => {
    const f = await setup(), board = await f.grant('board_settings',f.operation.customer_board_id), profile = await f.grant('user_profile');
    const before = await f.customer.table('boards').where('board_id',board.targetId).first();
    const update = await f.command(board,{ board_name: 'Customer support', description: 'Approved board description', enable_live_ticket_timer: false });
    await f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,update);
    await f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,update);
    expect(await f.customer.table('boards').where('board_id',board.targetId).first()).toEqual({ ...before, ...update.patch });
    const user = await f.customer.table('users').where('user_id',f.targetId).first();
    await f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,await f.command(profile,{ first_name: 'Updated', timezone: 'America/New_York' }));
    expect(await f.customer.table('users').where('user_id',f.targetId).first()).toMatchObject({ email: user.email, username: user.username, hashed_password: user.hashed_password, first_name: 'Updated', timezone: 'America/New_York' });
    expect(await f.customer.table('co_management_delegated_receipts')).toHaveLength(2);
    expect((await f.customer.table('audit_logs').where('operation','co_managed_delegated_administration')).every((row: any) => row.user_id === null && row.details.actor_tenant === f.principal.tenant)).toBe(true);
    await expect(f.customer.table('co_management_delegated_receipts').update({ actor_user_id: f.actor.userId })).rejects.toThrow('immutable');
  });
  it('delegated administration rejects proxies, credential changes, administrator targets and sponsor grant expansion', async () => {
    const f = await setup(), profile = await f.grant('user_profile');
    for (const patch of [{ email: 'msp@example.test' },{ hashed_password: 'new-password' },{ role_ids: [f.roleId] },{ is_inactive: false },{ reports_to: f.principal.userId }]) {
      await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,await f.command(profile,patch))).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    }
    await expect(f.grant('user_profile',f.actor.userId)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await expect(f.saveCoManagedDelegatedGrant(f.db,f.principal,f.target,await f.revision(),{ ...profile, grantId: randomUUID() })).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    const admin = await f.customer.table('user_roles').where('user_id',f.actor.userId).first();
    await f.customer.table('user_roles').insert({ tenant: f.actor.tenant, user_id: f.targetId, role_id: admin.role_id });
    expect((await f.screen()).grants).toEqual([]);
  });
  it('delegated invitation resend preserves approved customer identity and terms, and retries delivery without disclosing tokens', async () => {
    const f = await setup(true), grant = await f.grant('invitation_resend'), request = await f.command(grant);
    const before = await f.customer.table('user_invitations').where('invitation_id',f.targetId).first(), send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(JSON.stringify(await f.screen())).not.toContain(before.token);
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send)).rejects.toThrow('delivery failed');
    expect(await f.customer.table('co_management_delegated_receipts')).toEqual([]);
    await f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send);
    await f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send);
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toMatchObject({ email: before.email, token: before.token, customerTenant: f.actor.tenant });
    expect(await f.customer.table('user_invitations').where('invitation_id',f.targetId).first()).toEqual(before);
    await f.customer.table('user_invitations').where('invitation_id',f.targetId).update({ email: 'msp-proxy@example.test' });
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });
  it('delegated administration rechecks revoked grants, home bundles and sessions and permits security reduction during lapse', async () => {
    const f = await setup(), grant = await f.grant('user_profile'), request = await f.command(grant,{ first_name: 'Never applied' });
    const bundles = await import('@alga-psa/authorization');
    const { bundleId,revisionId } = await bundles.createAuthorizationBundle(f.db,{ tenant: f.principal.tenant, name: 'Delegate restriction', actorUserId: f.principal.userId });
    await bundles.upsertBundleRule(f.db,{ tenant: f.principal.tenant,bundleId,revisionId,resourceType:'user',action:'update',templateKey:'selected_clients',
      config:{ selectedClientIds:[f.operation.request.clientId],redactedFields:['first_name'] } });
    await bundles.publishBundleRevision(f.db,{ tenant:f.principal.tenant,bundleId,revisionId,actorUserId:f.principal.userId });
    await bundles.createBundleAssignment(f.db,{ tenant:f.principal.tenant,bundleId,targetType:'user',targetId:f.principal.userId });
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request)).rejects.toMatchObject({ code:'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.sponsor.table('authorization_bundle_rules').where('revision_id',revisionId).update({config:{ selectedClientIds:[f.operation.request.clientId] }});
    await f.sponsor.table('sessions').where('session_id',f.principal.sessionId).update({revoked_at:new Date()});
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    await f.sponsor.table('sessions').where('session_id',f.principal.sessionId).update({revoked_at:null});
    await f.sponsor.table('co_managed_entitlements').update({ valid_until:new Date(Date.now()-40*86400000),lapse_started_at:new Date(Date.now()-40*86400000),read_only_after:new Date(Date.now()-10*86400000) });
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request)).rejects.toMatchObject({code:'CO_MANAGED_READ_ONLY'});
    await f.revokeCoManagedDelegatedGrant(f.db,f.customerPrincipal,f.target,await f.revision(),grant.grantId);
    expect((await f.screen()).grants).toEqual([]);
  });

  it('delegated administration discovery follows exact team grants and current membership without management-directory access', async () => {
    const f = await setup(), teamId = randomUUID();
    await f.sponsor.table('teams').insert({ tenant:f.principal.tenant,team_id:teamId,manager_id:f.principal.userId,team_name:'Approved support team' });
    await f.sponsor.table('team_members').insert({ tenant:f.principal.tenant,team_id:teamId,user_id:f.principal.userId });
    await f.sponsor.table('co_management_staff_assignments').insert({ tenant:f.principal.tenant,customer_tenant:f.actor.tenant,relationship_id:f.target.relationshipId,
      principal_type:'team',principal_id:teamId,relationship_role:'technician' });
    expect(await f.listCoManagedDelegatedWorkspaces(f.db,f.principal)).toEqual([]);
    const grant = await f.grant('user_profile',f.targetId,'team',teamId);
    const permission = await f.sponsor.table('permissions').where({resource:'co_management',action:'manage'}).first();
    await f.sponsor.table('role_permissions').where({role_id:f.homeRoleId,permission_id:permission.permission_id}).del();
    expect(await f.listCoManagedDelegatedWorkspaces(f.db,f.principal)).toEqual([{operationId:f.operation.operation_id,name:(await f.customer.table('tenants').first()).client_name}]);
    const request = await f.command(grant,{first_name:'Team update'});
    await f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request);
    await f.sponsor.table('team_members').where({team_id:teamId,user_id:f.principal.userId}).del();
    expect(await f.listCoManagedDelegatedWorkspaces(f.db,f.principal)).toEqual([]);
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
  });
  it('delegated invitation admission rejects expired invitations, changed role terms and exhausted customer seats', async () => {
    const f = await setup(true), grant = await f.grant('invitation_resend'), request = await f.command(grant), send = vi.fn().mockResolvedValue(true);
    const before = await f.customer.table('user_invitations').where('invitation_id',f.targetId).first();
    await f.customer.table('user_invitations').where('invitation_id',f.targetId).update({expires_at:new Date(Date.now()-1000)});
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    await f.customer.table('user_invitations').where('invitation_id',f.targetId).update({expires_at:before.expires_at});
    const permission = await f.customer.table('permissions').where({resource:'ticket',action:'read',msp:true,client:false}).first();
    await f.customer.table('role_permissions').insert({tenant:f.actor.tenant,role_id:f.roleId,permission_id:permission.permission_id});
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    await f.customer.table('role_permissions').where({role_id:f.roleId,permission_id:permission.permission_id}).del();
    const existing = await f.customer.table('users').where('user_id',f.actor.userId).first(), userId = randomUUID();
    await f.customer.table('users').insert({...existing,user_id:userId,username:userId,email:`${userId}@example.test`});
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled(); expect(await f.customer.table('co_management_delegated_receipts')).toEqual([]);
  });
  it('delegated invitation serializes concurrent retries and customer revocation through delivery', async () => {
    const f = await setup(true), grant = await f.grant('invitation_resend'), request = await f.command(grant);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered=resolve;}), wait = new Promise<void>(resolve => {release=resolve;});
    const send = vi.fn(async () => {entered();await wait;return true;});
    const first = f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send); await started;
    const retry = f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,send);
    release(); await Promise.all([first,retry]); expect(send).toHaveBeenCalledTimes(1);
    let revokeCompleted=false;
    const newRequest = {...request,operationId:randomUUID()};
    let releaseSecond!: () => void, enteredSecond!: () => void;
    const secondStarted = new Promise<void>(resolve => {enteredSecond=resolve;}), secondWait=new Promise<void>(resolve=>{releaseSecond=resolve;});
    const second = f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,newRequest,async()=>{enteredSecond();await secondWait;return true;}); await secondStarted;
    const revoke = f.revokeCoManagedDelegatedGrant(f.db,f.customerPrincipal,f.target,await f.revision(),grant.grantId).then(()=>{revokeCompleted=true;});
    await new Promise(resolve=>setTimeout(resolve,30)); expect(revokeCompleted).toBe(false);
    releaseSecond(); await Promise.all([second,revoke]);
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,newRequest,send)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
  });

  it('delegated invitation pins role terms against concurrent permission expansion until delivery commits', async () => {
    const f=await setup(true),grant=await f.grant('invitation_resend'),request=await f.command(grant);
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
    const delivery=f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,async()=>{entered();await wait;return true;});await started;
    const permission=await f.customer.table('permissions').where({resource:'ticket',action:'read',msp:true,client:false}).first();
    let expanded=false;
    const expansion=f.customer.table('role_permissions').insert({tenant:f.actor.tenant,role_id:f.roleId,permission_id:permission.permission_id}).then(()=>{expanded=true;});
    await new Promise(resolve=>setTimeout(resolve,30));expect(expanded).toBe(false);
    release();await Promise.all([delivery,expansion]);
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request,vi.fn())).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
  });
  it('delegated administration snapshots actor, target and command before waiting for lifecycle locks',async()=>{
    const f=await setup(),grant=await f.grant('user_profile'),request=await f.command(grant,{first_name:'Approved value'});
    const blocker=await f.db.transaction();
    try {
      await blocker('co_managed_entitlements').where('tenant',f.principal.tenant).forUpdate().first();
      const actor={...f.principal},target={...f.target},input=structuredClone(request);
      const write=f.executeCoManagedDelegatedCommand(f.db,actor,target,input);
      actor.userId=randomUUID();target.customerTenant=randomUUID();input.patch.first_name='Mutated value';input.operationId=randomUUID();
      await blocker.commit();await write;
      expect((await f.customer.table('users').where('user_id',f.targetId).first()).first_name).toBe('Approved value');
      expect(await f.customer.table('co_management_delegated_receipts').first()).toMatchObject({operation_id:request.operationId,actor_user_id:f.principal.userId});
    } finally { if (!blocker.isCompleted()) await blocker.rollback(); }
  });

  it('delegated administration keeps approval identities immutable and supports a fresh approval after revocation',async()=>{
    const f=await setup(),grant=await f.grant('user_profile'),request=await f.command(grant,{first_name:'Stale command'});
    await expect(f.saveCoManagedDelegatedGrant(f.db,f.customerPrincipal,f.target,await f.revision(),{...grant,operation:'board_settings',targetId:f.operation.customer_board_id})).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    await f.revokeCoManagedDelegatedGrant(f.db,f.customerPrincipal,f.target,await f.revision(),grant.grantId);
    const replacement=await f.grant('user_profile');expect(replacement.grantId).not.toBe(grant.grantId);
    await expect(f.executeCoManagedDelegatedCommand(f.db,f.principal,f.target,request)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    expect((await f.screen()).grants.map((row:any)=>row.grantId)).toEqual([replacement.grantId]);
  });

  it('delegated administration option search paginates only authorized display fields and admitted principals',async()=>{
    const f=await setup(),bundles=await import('@alga-psa/authorization');
    const {bundleId,revisionId}=await bundles.createAuthorizationBundle(f.db,{tenant:f.actor.tenant,name:'Selected delegated board',actorUserId:f.actor.userId});
    await bundles.upsertBundleRule(f.db,{tenant:f.actor.tenant,bundleId,revisionId,resourceType:'ticket_settings',action:'update',templateKey:'selected_boards',config:{selectedBoardIds:[f.operation.customer_board_id]}});
    await bundles.publishBundleRevision(f.db,{tenant:f.actor.tenant,bundleId,revisionId,actorUserId:f.actor.userId});
    await bundles.createBundleAssignment(f.db,{tenant:f.actor.tenant,bundleId,targetType:'user',targetId:f.actor.userId});
    const search=(kind:any,term='',page=0)=>f.searchCoManagedDelegatedOptions(f.db,f.customerPrincipal,f.target,{kind,search:term,page});
    const before=await search('board_settings');expect(before.options).toHaveLength(1);expect(before.hasMore).toBe(false);
    const board=await f.customer.table('boards').where('board_id',f.operation.customer_board_id).first();
    await f.customer.table('boards').insert(Array.from({length:105},(_,i)=>({...board,board_id:randomUUID(),board_name:`Hidden board marker ${i}`,is_default:false})));
    expect(await search('board_settings')).toEqual(before);
    expect(await search('board_settings','Hidden board marker')).toEqual({options:[],hasMore:false});
    expect(await search('board_settings','',1)).toEqual({options:[],hasMore:false});
    const user=await f.customer.table('users').where('user_id',f.targetId).first();
    expect(await search('user_profile',user.username)).toEqual({options:[],hasMore:false});
    expect(await search('user_profile',user.email)).toEqual({options:[],hasMore:false});
    expect((await search('user_profile','Customer Technician')).options.map((row:any)=>row.id)).toEqual([f.targetId]);
    const own=await f.sponsor.table('users').where('user_id',f.principal.userId).first();
    const inactive=Array.from({length:105},(_,i)=>({...own,user_id:randomUUID(),username:`inactive-delegate-${i}-${randomUUID()}`,email:`inactive-${randomUUID()}@example.test`,is_inactive:true,first_name:'Hidden principal',last_name:String(i)}));
    await f.sponsor.table('users').insert(inactive);
    await f.sponsor.table('co_management_staff_assignments').insert(inactive.map(row=>({tenant:f.principal.tenant,customer_tenant:f.actor.tenant,relationship_id:f.target.relationshipId,
      principal_type:'user',principal_id:row.user_id,relationship_role:'technician'})));
    const principals=await search('principal');expect(principals.options.map((row:any)=>row.id)).toEqual([f.principal.userId]);expect(principals.hasMore).toBe(false);
    expect(await search('principal','Hidden principal')).toEqual({options:[],hasMore:false});
    expect(await search('principal','',1)).toEqual({options:[],hasMore:false});
  });
}
