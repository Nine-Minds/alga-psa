// Guide 10, stage A: a disposable co-management relationship prepared natively —
// provision, accept, grant the MSP technician access, and share a native ticket.
const {scenario,ids,origin,sql,until,assert,privateRoot,reviewDist}=require('./runtime.cjs');
const fs=require('fs'),crypto=require('crypto');
const stamp=Date.now(),prefix='CM DEPART '+stamp;
const operation=w=>JSON.parse(sql(`select row_to_json(o) from (select operation_id,customer_tenant,relationship_id,allocation_id,state,invitation_sent_at from co_managed_provisioning_operations where request->>'workspaceName'='${w}' order by created_at desc limit 1)o`)||'null');
const capacity=()=>Number(sql(`select capacity from co_managed_entitlements where tenant='${ids.msp}'`));
const used=()=>Number(sql(`select coalesce(sum(seats),0) from co_managed_allocations where tenant='${ids.msp}' and state<>'released'`));
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'10-departure-a-provision',async({page,ctx,actor,go,check,mark,shot,inspect,dir})=>{
  const resume=process.env.CM_RESUME_FIXTURE?require('../'+process.env.CM_RESUME_FIXTURE+'/fixtures.json'):null;
  const fixture=resume?{...resume}:{stamp,prefix};const save=()=>fs.writeFileSync(dir+'/fixtures.json',JSON.stringify(fixture,null,2));
  let password,email=fixture.adminEmail;
  if(resume){password=JSON.parse(fs.readFileSync(privateRoot+'/'+fixture.credentialFile)).password;await mark('resume-provisioned-relationship',{customer:fixture.customer,relationship:fixture.relationship,from:process.env.CM_RESUME_FIXTURE})}
  else{
  await actor('qa');
  if(capacity()-used()<1){const want=used()+1;await go('/msp/co-managed');await page.locator('#co-managed-seat-quantity').fill(String(want));
    await page.locator('#co-managed-review-purchase').click();await page.locator('#co-managed-confirm-purchase').click();
    await until(()=>capacity()===want,'simulator capacity for the disposable relationship');await mark('purchased-one-seat',{capacity:want})}
  fixture.capacityBefore=capacity();fixture.usedBefore=used();
  const name=prefix,workspace=name+' IT';email='depart.admin.'+stamp+'@cmreview.test';
  await go('/msp/clients');await page.locator('#create-client-button').click();await page.locator('#client-name').fill(name);
  await page.locator('#create-view-client-btn').click();await page.waitForURL(/\/msp\/clients\/[a-f0-9-]+/);
  fixture.clientId=new URL(page.url()).pathname.split('/').at(-1);
  await go('/msp/co-managed');await page.locator('#co-managed-create-workspace').click();
  await page.locator('#co-managed-client-search').fill(name);await page.waitForTimeout(600);await page.locator('#co-managed-client').click();await page.getByRole('option',{name,exact:true}).click();
  await page.locator('#co-managed-workspace-name').fill(workspace);
  await page.locator('#co-managed-admin-firstName').fill('Depart');await page.locator('#co-managed-admin-lastName').fill('Admin');await page.locator('#co-managed-admin-email').fill(email);
  await page.locator('#co-managed-workspace-seats').fill('1');
  await page.locator('#co-managed-escalation-board').click();await page.getByRole('option',{name:'General Support',exact:true}).click();
  await page.locator('#co-managed-submit-workspace').click();
  const op=await until(()=>{const o=operation(workspace);return o?.state==='pending_acceptance'&&o.invitation_sent_at?o:null},'invitation sent',90000);
  Object.assign(fixture,{operationId:op.operation_id,customer:op.customer_tenant,relationship:op.relationship_id,allocationId:op.allocation_id,workspace,adminEmail:email});save();
  await check('disposable-workspace-provisioned-with-one-allocation',Number(sql(`select count(*) from co_managed_allocations where allocation_id='${op.allocation_id}' and state<>'released'`))===1,{operationId:op.operation_id,customer:op.customer_tenant});
  const mails=(await(await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result;
  const mail=mails.filter(m=>m.to?.includes(email)).at(-1);assert.ok(mail,'administrator invitation delivered');
  const link=mail.text?.match(/(https?:\/\/\S*\/auth\/team\/setup\S*)/)||mail.html?.match(/href="([^"]*\/auth\/team\/setup[^"]*)"/);assert.ok(link,'setup link');
  const u=new URL(link[1].replaceAll('&amp;','&'));await ctx.clearCookies();await page.goto(origin+u.pathname+u.search);
  password='CMdepart!'+crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(privateRoot+'/departure-'+stamp+'-credential.json',JSON.stringify({email,password,tenant:op.customer_tenant}));
  fixture.credentialFile='departure-'+stamp+'-credential.json';save();
  await page.locator('#password').fill(password);await page.locator('#confirmPassword').fill(password);await page.locator('#create-team-account-button').click();
  await page.locator('#co-managed-accept-relationship').waitFor({timeout:45000});await shot('a1-pending-acceptance');
  await page.locator('#co-managed-accept-relationship').click();
  await until(()=>sql(`select state from co_management_relationships where tenant='${op.customer_tenant}' and relationship_id='${op.relationship_id}'`)==='active','relationship active');
  await go('/msp/tickets');
  if(await page.locator('#companyAddressLine1').count()){await page.locator('#companyAddressLine1').fill('1 Departure Lane');await page.locator('#companyCity').fill('Emerald City');
    await page.locator('#company-country-picker').click();await page.getByText('United States',{exact:true}).click();await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForTimeout(700);
    for(let i=0;i<6;i++){const skip=page.getByRole('button',{name:'Skip',exact:true});if(await skip.count()&&await skip.isEnabled()){await skip.click();await page.waitForTimeout(500)}else break}
    const finish=page.getByRole('button',{name:'Finish Setup',exact:true});if(await finish.count()&&await finish.isEnabled()){await finish.click();await page.waitForTimeout(800)}}
  await go('/msp/tickets');await page.getByRole('heading',{name:'Ticketing Dashboard',exact:true}).waitFor();
  await check('customer-accepts-and-reaches-its-native-desk',true);
  // MSP staff access for the technician who will work the shared ticket.
  await actor('qa');await go('/msp/clients/'+fixture.clientId+'?tab=co-managed');await page.locator('#co-policy-user-search').waitFor();
  const qaId=sql(`select user_id from users where tenant='${ids.msp}' and email='qa@emeraldcity.oz'`);fixture.qaId=qaId;
  if(!await page.locator('#co-policy-user-remove-'+qaId).count()){await page.locator('#co-policy-user-search').fill('QA');await page.waitForTimeout(650);
    await page.locator('#co-policy-user-select').click();await page.getByRole('option',{name:/^QA Tester/}).first().click();await page.locator('#co-policy-user-add').click();
    await page.locator('#co-policy-user-access-'+qaId).click();await page.getByRole('option',{name:'Collaborate',exact:true}).click();await page.locator('#co-policy-save').click();
    await until(()=>Number(sql(`select count(*) from co_management_staff_assignments where tenant='${ids.msp}' and customer_tenant='${op.customer_tenant}' and principal_id='${qaId}'`))===1,'QA staff assignment')}
  await check('msp-technician-has-collaborate-access',true);await shot('a2-staff-access');
  }
  const op={customer_tenant:fixture.customer,relationship_id:fixture.relationship};
  // The MSP maps the customer's priorities to its SLA before work can be escalated.
  await actor('qa');await go('/msp/co-management/sla?operationId='+fixture.operationId);
  const maps=page.locator('button[id^="co-sla-map-"]');await maps.first().waitFor();
  const mapped={};
  // The MSP's default policy (Oz Standard SLA) has a target only for P1 - Critical.
  for(let i=0;i<await maps.count();i++){const m=maps.nth(i);const id=await m.getAttribute('id');
    if((await m.innerText()).trim()==='P1 - Critical'){mapped[id]='P1 - Critical';continue}
    await m.click();await page.getByRole('option',{name:'P1 - Critical',exact:true}).click();mapped[id]='P1 - Critical'}
  const mapCount=await maps.count();await page.locator('#co-sla-save').click();
  await until(()=>Number(sql(`select count(*) from co_managed_sla_priority_mappings where customer_tenant='${fixture.customer}' and relationship_id='${fixture.relationship}' and msp_priority_id is not null`))===mapCount,'priority mappings saved');
  await check('msp-maps-every-customer-priority-to-its-sla',true,{mapped});await shot('a2b-sla-priority-mapping');
  // Customer creates a native ticket and hands it to the MSP.
  const customer={name:'departAdmin',email,password};
  await actor(customer);await go('/msp/tickets');await page.locator('#add-ticket-button').click();
  const title=fixture.prefix+' shared ticket';await page.locator('#ticket-quick-add-title').fill(title);
  const pickFirst=async trigger=>{await page.locator(trigger).click();const opt=page.locator('[role="option"]:not([aria-disabled="true"])').filter({visible:true}).first();await opt.waitFor();const label=(await opt.innerText()).trim();await opt.click();return label};
  fixture.ticketClient=await pickFirst('#ticket-quick-add-client-trigger');
  fixture.ticketBoard=await pickFirst('#ticket-quick-add-board-picker');
  await page.waitForTimeout(800);
  const statusText=(await page.locator('#ticket-quick-add').innerText()).trim();
  fixture.ticketStatus=/Select Status/i.test(statusText)?await pickFirst('#ticket-quick-add'):statusText;
  await shot('a3-customer-creates-native-ticket');
  await page.locator('#ticket-quick-add-create-open-btn').click();
  await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/,{timeout:45000});
  fixture.ticket=new URL(page.url()).pathname.split('/').at(-1);fixture.ticketTitle=title;save();
  await check('customer-native-ticket-created',sql(`select title from tickets where tenant='${op.customer_tenant}' and ticket_id='${fixture.ticket}'`)===title,{ticket:fixture.ticket,client:fixture.ticketClient,board:fixture.ticketBoard});
  await page.locator('#co-ticket-escalate').click();await page.locator('#co-ticket-handoff-note').fill('Please take this disposable departure ticket '+fixture.stamp);
  await page.locator('#co-ticket-handoff-submit').click();await page.locator('#co-ticket-handoff-note').waitFor({state:'detached'});
  await until(()=>sql(`select responsibility from co_management_ticket_work where tenant='${op.customer_tenant}' and ticket_id='${fixture.ticket}'`)==='msp','handed to the MSP');
  fixture.route='/msp/co-management/tickets/'+op.customer_tenant+'/'+op.relationship_id+'/'+fixture.ticket;save();
  await check('customer-hands-the-native-ticket-to-the-msp',true,{route:fixture.route});await shot('a4-handed-off');
  await actor('qa');await go(fixture.route);await page.getByText(title,{exact:false}).filter({visible:true}).first().waitFor();
  await check('msp-opens-the-shared-ticket',true);await shot('a5-msp-opens-shared-ticket');
  return {status:'passed',limitations:[]};
});if(r.scenarioStatus==='failed')process.exitCode=1;})();
