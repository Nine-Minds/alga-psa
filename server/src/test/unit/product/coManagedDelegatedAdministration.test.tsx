/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedDelegatedAdministration from '../../../components/co-managed/CoManagedDelegatedAdministration';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(()=>({flag:vi.fn(),load:vi.fn(),search:vi.fn(),grant:vi.fn(),revoke:vi.fn(),run:vi.fn(),session:{session_id:'session',user:{id:'actor',tenant:'home'}}}));
vi.mock('next-auth/react',()=>({useSession:()=>({data:mocks.session})}));
vi.mock('@alga-psa/ui/hooks',()=>({useFeatureFlag:mocks.flag}));
vi.mock('../../../lib/actions/coManagedAcceptanceActions',()=>({}));
vi.mock('../../../lib/actions/coManagedDelegatedAdministrationActions',()=>({getCoManagedDelegatedAdministration:mocks.load,searchCoManagedDelegatedAdministration:mocks.search,
  grantCoManagedDelegatedAdministration:mocks.grant,revokeCoManagedDelegatedAdministration:mocks.revoke,runCoManagedDelegatedAdministration:mocks.run}));
vi.mock('@alga-psa/ui/components/CustomSelect',()=>({default:({id,label,value,disabled,options,onValueChange}:any)=><label>{label}<select id={id} value={value} disabled={disabled} onChange={event=>onValueChange(event.target.value)}>
  <option value="">Choose</option>{options.map((option:any)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}));
vi.mock('@alga-psa/ui/lib/i18n/client',()=>({useTranslation:()=>({t:(key:string,args?:any)=>key==='banner'?`${args.customer} / ${args.sponsor}`:key}),useOptionalI18n:()=>null}));
const sponsor=()=>({side:'sponsor',workspaceName:'Customer A',sponsorName:'MSP',revision:5,canWrite:true,grants:[{grantId:'grant',operation:'user_profile',label:'Approved person',principalName:'Support',available:true,
  values:{first_name:'Customer',last_name:'Person',timezone:'UTC'},version:'initial-version'}]});
beforeEach(()=>{vi.resetAllMocks();mocks.flag.mockReturnValue({enabled:true,loading:false,error:null});mocks.load.mockResolvedValue(sponsor());mocks.search.mockResolvedValue({options:[],hasMore:false});mocks.run.mockResolvedValue({completed:true});});
afterEach(cleanup);
const mount=(operationId='operation')=>render(<CoManagedFeatureBoundary><CoManagedDelegatedAdministration operationId={operationId}/></CoManagedFeatureBoundary>);
it('does not load delegated UI or data when the release flag is disabled',()=>{
  mocks.flag.mockReturnValue({enabled:false,loading:false,error:null});mount();expect(mocks.load).not.toHaveBeenCalled();expect(screen.queryByRole('button')).toBeNull();
});
it('keeps the customer banner, exposes only granted fields, and retries the same immutable command',async()=>{
  mocks.run.mockRejectedValueOnce(new Error('response lost'));mount();await screen.findByText('Customer A / MSP');
  expect(screen.queryByLabelText('email')).toBeNull();expect(screen.queryByText('approveTitle')).toBeNull();
  fireEvent.change(screen.getByLabelText('fields.first_name'),{target:{value:'New name'}});fireEvent.click(screen.getByRole('button',{name:'save'}));
  await screen.findByText('saveError');const submitted=mocks.run.mock.calls[0][0];expect(submitted).toMatchObject({operationId:'operation',command:{grantId:'grant',expectedVersion:'initial-version',patch:{first_name:'New name'}}});
  expect((screen.getByLabelText('fields.first_name') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'retry'}));await waitFor(()=>expect(mocks.run).toHaveBeenCalledTimes(2));expect(mocks.run.mock.calls[1][0]).toEqual(submitted);
});
it('removes previously displayed target data when fresh authorization fails',async()=>{
  mount();await screen.findByText('Approved person');mocks.load.mockRejectedValueOnce(new Error('revoked'));fireEvent.click(screen.getByRole('button',{name:'refresh'}));
  await screen.findByText('loadError');expect(screen.queryByText('Approved person')).toBeNull();expect(screen.queryByDisplayValue('Customer')).toBeNull();
});
it('allows customer revocation during read-only lifecycle and sends the current revision',async()=>{
  mocks.load.mockResolvedValue({...sponsor(),side:'customer',canWrite:false});mount(undefined);await screen.findByText('readOnly');
  expect((screen.getByRole('button',{name:'approve'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'revoke'}));await waitFor(()=>expect(mocks.revoke).toHaveBeenCalledWith({revision:5,grantId:'grant'}));expect(mocks.run).not.toHaveBeenCalled();
});
it('provides only the authorized workspace discovery links without administration inputs',async()=>{
  mocks.load.mockResolvedValue({side:'directory',workspaces:[{operationId:'allowed-operation',name:'Approved workspace'}]});mount(undefined);
  const link=await screen.findByRole('link',{name:'Approved workspace'});expect(link.getAttribute('href')).toBe('/msp/co-management/administration?operationId=allowed-operation');
  expect(screen.queryByText('approveTitle')).toBeNull();expect(screen.queryByLabelText('fields.first_name')).toBeNull();
});
