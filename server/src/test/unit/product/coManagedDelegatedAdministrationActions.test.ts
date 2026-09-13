import { beforeEach, expect, it, vi } from 'vitest';
import { getCoManagedDelegatedAdministration, grantCoManagedDelegatedAdministration, runCoManagedDelegatedAdministration } from '../../../lib/actions/coManagedDelegatedAdministrationActions';
const mocks=vi.hoisted(()=>({browser:vi.fn(),screen:vi.fn(),list:vi.fn(),grant:vi.fn(),run:vi.fn(),send:vi.fn(),db:{},
  user:{tenant:'00000000-0000-4000-8000-000000000001',user_id:'00000000-0000-4000-8000-000000000002'},rows:{} as Record<string,any[]>}));
vi.mock('@alga-psa/auth',()=>({withAuth:(fn:any)=>(...args:any[])=>fn(mocks.user,{tenant:mocks.user.tenant},...args)}));
vi.mock('../../../lib/co-managed/browserActor',()=>({coManagedBrowserActor:mocks.browser}));
vi.mock('@alga-psa/co-managed',()=>({CoManagedSharedWorkError:class extends Error {constructor(){super('Forbidden');}},isCoManagedUuid:(value:any)=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value),
  getCoManagedDelegatedScreen:mocks.screen,listCoManagedDelegatedWorkspaces:mocks.list,saveCoManagedDelegatedGrant:mocks.grant,revokeCoManagedDelegatedGrant:vi.fn(),searchCoManagedDelegatedOptions:vi.fn(),executeCoManagedDelegatedCommand:mocks.run}));
vi.mock('@alga-psa/email',()=>({sendTeamInvitationEmail:mocks.send}));
vi.mock('@alga-psa/db',()=>({createTenantKnex:async()=>({knex:mocks.db}),tenantDb:(_db:any,tenant:string)=>({table:(table:string)=>{
  let rows=mocks.rows[`${tenant}:${table}`]??[];
  const query:any={where:(key:any,value:any)=>{rows=rows.filter(row=>typeof key==='string'?row[key]===value:Object.entries(key).every(([k,v])=>row[k]===v));return query;},
    whereNull:(key:string)=>{rows=rows.filter(row=>row[key]==null);return query;},first:async()=>rows[0]};return query;
}})}));
const operationId='00000000-0000-4000-8000-000000000003',customerTenant='00000000-0000-4000-8000-000000000004',relationshipId='00000000-0000-4000-8000-000000000005';
const actor={kind:'session',tenant:mocks.user.tenant,userId:mocks.user.user_id,sessionId:'tracked-session'};
beforeEach(()=>{vi.resetAllMocks();mocks.browser.mockResolvedValue(actor);mocks.list.mockResolvedValue([]);mocks.rows={
  [`${mocks.user.tenant}:tenants`]:[{product_code:'psa'}],
  [`${mocks.user.tenant}:co_managed_provisioning_operations`]:[{operation_id:operationId,customer_tenant:customerTenant,relationship_id:relationshipId}],
};});
it('resolves a sponsor operation into its durable target and passes the tracked home actor',async()=>{
  await getCoManagedDelegatedAdministration(operationId);expect(mocks.screen).toHaveBeenCalledWith(mocks.db,actor,{customerTenant,relationshipId});
  await getCoManagedDelegatedAdministration();expect(mocks.list).toHaveBeenCalledWith(mocks.db,actor);
});
it('rejects a guessed foreign operation and prevents sponsor-owned grant creation',async()=>{
  await expect(getCoManagedDelegatedAdministration('00000000-0000-4000-8000-000000000099')).rejects.toThrow('Forbidden');
  await expect(grantCoManagedDelegatedAdministration({revision:1,grant:{} as any})).rejects.toThrow('Forbidden');expect(mocks.grant).not.toHaveBeenCalled();expect(mocks.screen).not.toHaveBeenCalled();
});
it('requires browser authentication before target discovery or delegated commands',async()=>{
  mocks.browser.mockRejectedValue(new Error('No tracked session'));
  await expect(getCoManagedDelegatedAdministration()).rejects.toThrow('No tracked session');
  await expect(runCoManagedDelegatedAdministration({operationId,command:{} as any})).rejects.toThrow('No tracked session');
  expect(mocks.list).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();
});
it('sends only the retained original invitation and keeps provider tokens out of action results',async()=>{
  vi.stubEnv('NEXT_PUBLIC_BASE_URL','https://alga.example.test');mocks.send.mockResolvedValue(true);
  mocks.run.mockImplementation(async(_db,_actor,_target,_command,send)=>{await send({customerTenant,email:'customer@example.test',name:'Customer Person',roleName:'Technician',workspaceName:'Customer workspace',
    invitedByName:'Customer administrator',token:'original-token',expiresAt:new Date(Date.now()+20*60000).toISOString()});return {completed:true};});
  const result=await runCoManagedDelegatedAdministration({operationId,command:{operationId:'command',grantId:'grant',expectedVersion:'version'}});
  expect(result).toEqual({completed:true});expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({tenant:customerTenant,email:'customer@example.test',roleName:'Technician',
    invitedByName:'Customer administrator',inviteLink:'https://alga.example.test/auth/team/setup?token=original-token',expirationTime:'20 minutes'}));vi.unstubAllEnvs();
});
