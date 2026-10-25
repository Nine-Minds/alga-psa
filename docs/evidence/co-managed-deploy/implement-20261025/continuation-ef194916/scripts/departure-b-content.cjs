// Guide 10, stage B: everything that must exist before cutoff — messages and files
// in every audience, the MSP assignment, commercial time (one invoiced, one approved
// and uninvoiced) and a delivery to the MSP that is still queued.
const {scenario,ids,origin,sql,until,assert,privateRoot}=require('./runtime.cjs');
const fs=require('fs'),crypto=require('crypto');
const A=process.env.CM_STAGE_A||'10-departure-a-provision';
const fx=require('../'+A+'/fixtures.json');
const CATALOG=process.env.CM_CATALOG_SERVICE||'CM Catalog Support 1792944312315';
const sink=async()=>(await(await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result;
const fault=async(op)=>{const r=await fetch(`http://127.0.0.1:9177/control/smtp-sink/faults/reject-mail/${op}`,{method:'POST',headers:{'content-type':'application/json'},body:op==='arm'?JSON.stringify({code:451}):'{}'});assert.ok(r.ok,'fault '+op)};
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'10-departure-b-content',async({page,ctx,actor,go,check,mark,shot,inspect,dir})=>{
  const out={...fx,stageA:A,files:[],entries:[]};const save=()=>fs.writeFileSync(dir+'/fixtures.json',JSON.stringify(out,null,2));save();
  const cred=JSON.parse(fs.readFileSync(privateRoot+'/'+fx.credentialFile));const customer={name:'departAdmin',email:cred.email,password:cred.password};
  const C=fx.customer,route=fx.route,stamp=fx.stamp;
  const open=async who=>{await actor(who);await go(who===customer?'/msp/tickets/'+fx.ticket:route);await page.waitForTimeout(1500);await page.getByRole('button',{name:'Entry',exact:true}).click();
    const show=page.locator('#ticket-details-conversation-show-comment-editor-btn');await show.waitFor();if(await show.isVisible())await show.click();await page.locator('#ticket-details-conversation-audience-select').waitFor()};
  const post=async(who,audience,label,withFile=true)=>{await open(who);await page.locator('#ticket-details-conversation-audience-select').click();
    await page.getByRole('option',{name:audience,exact:typeof audience==='string'}).click();
    const text=fx.prefix+' '+label,fileName='cm-depart-'+label+'-'+stamp+'.txt',bytes=Buffer.from(text+'\n');
    await page.locator('[contenteditable=true]').last().fill(text);
    if(withFile)await page.locator('#co-shared-comment-files').setInputFiles({name:fileName,mimeType:'text/plain',buffer:bytes});
    await page.locator('#ticket-details-conversation-add-comment-btn').click();
    await page.getByText(text,{exact:true}).filter({visible:true}).first().waitFor();
    if(withFile){const link=page.getByRole('link',{name:fileName,exact:true});await link.waitFor();const href=await link.getAttribute('href');
      const resp=await ctx.request.get(origin+href);await check(label+'-file-bytes-before-cutoff',resp.ok()&&(await resp.body()).equals(bytes));
      out.files.push({label,fileName,href,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),text});save()}
    await shot('b-'+label);return text};
  // 1. MSP assignment, so comment mail has a recipient.
  await actor('qa');await go(route);await page.locator('#co-ticket-assignment-value').waitFor();
  if(!(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester')){await page.locator('#co-ticket-assignment-change').click();await page.locator('#co-ticket-assignment-cancel').waitFor();
  await page.locator('#co-ticket-assignment-person').click();await page.getByRole('option',{name:/^QA Tester/}).first().click();await page.locator('#co-ticket-assignment-save').click();
  await page.locator('#co-ticket-assignment-cancel').waitFor({state:'detached'})}
  await check('msp-technician-assigned-to-the-shared-ticket',(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'));
  // 2. Messages and files in every audience.
  const prior=process.env.CM_STAGE_B_RESUME?require('../'+process.env.CM_STAGE_B_RESUME+'/fixtures.json'):null;
  if(prior?.files?.length===3){out.files=prior.files;out.mailControl=prior.mailControl;save();await mark('resume-stage-b-content',{from:process.env.CM_STAGE_B_RESUME})}
  else{await post('qa','Shared IT teams','shared');await post('qa','My organization only','MSPprivate');await post(customer,/Private to/,'customerprivate');
  // 3. Positive control: a shared customer reply reaches the assigned MSP technician by mail.
  const control=await post(customer,'Shared IT teams','mail-control',false);out.mailControl=control;save();}
  const control=out.mailControl;
  const qaMail='qa@emeraldcity.oz';
  await until(async()=>(await sink()).some(m=>m.to?.includes(qaMail)&&String(m.text||m.html||'').includes(control)),'control comment mail delivered to the MSP assignee',240000);
  await check('msp-assignee-receives-shared-customer-message-by-mail',true,{to:qaMail});
  // 4. Commercial time by an isolated technician (operator prerequisite, as in guide 09).
  const techEmail='cm.depart.tech.'+stamp+'@cmreview.test',techName='CM Depart Tech '+stamp;
  const existingTech=sql(`select user_id from users where tenant='${ids.msp}' and email='${techEmail}'`);
  const techId=existingTech||crypto.randomUUID(),teamId=existingTech?sql(`select team_id from team_members where tenant='${ids.msp}' and user_id='${techId}' limit 1`):crypto.randomUUID();
  if(!existingTech)sql(`begin;
insert into users select (jsonb_populate_record(null::users,to_jsonb(u)||jsonb_build_object('user_id','${techId}','username','${techEmail}','email','${techEmail}','first_name','CM','last_name','Depart Tech ${stamp}','is_inactive',false))).* from users u where tenant='${ids.msp}' and email='qa@emeraldcity.oz';
insert into user_roles(tenant,user_id,role_id) select tenant,'${techId}',role_id from user_roles where tenant='${ids.msp}' and user_id='5e6e332e-047d-488f-be12-9bce7e5d7bf8';
insert into teams(tenant,team_id,team_name,manager_id) values('${ids.msp}','${teamId}','CM departure approval ${stamp}','5e6e332e-047d-488f-be12-9bce7e5d7bf8');
insert into team_members(tenant,team_id,user_id) values('${ids.msp}','${teamId}','${techId}');
commit;`);
  Object.assign(out,{techId,teamId,techEmail,techName});save();
  await mark('operator-prerequisite-isolated-technician',{techId,teamId,approver:'QA Tester'});
  await actor('qa');await go('/msp/clients/'+fx.clientId+'?tab=co-managed');await page.locator('#co-policy-user-search').waitFor();
  if(!await page.locator('#co-policy-user-remove-'+techId).count()){
  await page.locator('#co-policy-user-search').fill(String(stamp));await page.waitForTimeout(700);await page.locator('#co-policy-user-select').click();
  await page.getByRole('option',{name:techName,exact:true}).click();await page.locator('#co-policy-user-add').click();
  await page.locator('#co-policy-user-access-'+techId).click();await page.getByRole('option',{name:'Collaborate',exact:true}).click();await page.locator('#co-policy-save').click();
  await until(()=>Number(sql(`select count(*) from co_management_staff_assignments where tenant='${ids.msp}' and customer_tenant='${C}' and principal_id='${techId}'`))===1,'technician staff access');}
  await check('technician-granted-collaborate-access',true);
  // 5. The MSP client's first billing cycle, through its billing schedule.
  await go('/msp/clients/'+fx.clientId+'?tab=billing');await page.locator('#client-billing-email-input').waitFor();
  const billingEmail='billing.depart.'+stamp+'@cmreview.test';
  if(await page.locator('#client-billing-email-input').inputValue()!==billingEmail){await page.locator('#client-billing-email-input').fill(billingEmail);await page.locator('#save-billing-config-btn').click();
    await until(()=>sql(`select billing_email from clients where tenant='${ids.msp}' and client_id='${fx.clientId}'`)===billingEmail,'billing email saved')}
  await check('msp-client-billing-email-set',true,{billingEmail});
  if(!Number(sql(`select count(*) from client_billing_cycles where tenant='${ids.msp}' and client_id='${fx.clientId}'`))){await page.locator('#client-billing-create-next-cycle').first().waitFor();await page.locator('#client-billing-create-next-cycle').first().click();}
  await until(()=>Number(sql(`select count(*) from client_billing_cycles where tenant='${ids.msp}' and client_id='${fx.clientId}'`))>0,'billing cycle created');
  out.cycles=JSON.parse(sql(`select json_agg(c) from (select billing_cycle_id,period_start_date,period_end_date from client_billing_cycles where tenant='${ids.msp}' and client_id='${fx.clientId}') c`));save();
  await check('msp-client-billing-cycle-created-natively',true,{cycles:out.cycles});await shot('b-billing-cycle');
  // 6. Technician logs two catalog entries on the shared ticket.
  await actor({name:'departTech',email:techEmail});
  for(const [label,minutes] of [['invoiced-before-cutoff',20],['uninvoiced-at-cutoff',10]]){
    const note=fx.prefix+' commercial '+label;
    const have=sql(`select row_to_json(e) from (select entry_id,time_sheet_id,billable_duration,billing_mode,work_item_type,work_item_id,contract_line_id from time_entries where tenant='${ids.msp}' and notes='${note}') e`);
    if(have){const e=JSON.parse(have);out.entries.push({label,minutes,note,...e});save();await check(label+'-is-commercial-msp-time-on-shared-work',true,{entry:e,recovered:true});continue}
    await go(route);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(800);
    await page.locator('#ticket-details-properties-add-time-entry-btn').click();
    await page.getByRole('combobox').filter({hasText:'Select a service'}).click();await page.getByRole('option',{name:CATALOG,exact:true}).click();
    await page.locator('#time-entry-dialog-duration-hours-0').fill('0');await page.locator('#time-entry-dialog-duration-minutes-0').fill(String(minutes));
    await page.locator('#time-entry-dialog-notes-0').fill(note);await shot('b-time-'+label);await page.locator('#time-entry-dialog-save-dialog-btn').click();
    const e=await until(()=>{const x=sql(`select row_to_json(e) from (select entry_id,time_sheet_id,billable_duration,billing_mode,work_item_type,work_item_id,contract_line_id from time_entries where tenant='${ids.msp}' and notes='${note}') e`);return x?JSON.parse(x):null},'time persisted');
    out.entries.push({label,minutes,note,...e});save();
    await check(label+'-is-commercial-msp-time-on-shared-work',e.billing_mode==='commercial'&&e.work_item_type==='co_managed'&&e.billable_duration===minutes&&e.contract_line_id===null,{entry:e});
  }
  const sheet=out.entries[0].time_sheet_id;
  if(sql(`select approval_status from time_sheets where tenant='${ids.msp}' and id='${sheet}'`)!=='APPROVED'){
  await go('/msp/time-entry/timesheet/'+sheet);await page.locator('#submit-timesheet-button').click();
  await until(()=>sql(`select approval_status from time_sheets where tenant='${ids.msp}' and id='${sheet}'`)==='SUBMITTED','sheet submitted');
  await actor('qa');await go('/msp/time-sheet-approvals');await page.locator('#view-timesheet-'+sheet+'-btn').click();await page.locator('#timesheet-approve-btn').click();}
  await actor('qa');
  await until(()=>sql(`select approval_status from time_sheets where tenant='${ids.msp}' and id='${sheet}'`)==='APPROVED','sheet approved');
  await check('separate-approver-approves-both-entries',Number(sql(`select count(*) from time_entries where tenant='${ids.msp}' and time_sheet_id='${sheet}' and approval_status='APPROVED'`))===2);
  // 7. Invoice only the first entry before cutoff.
  const E1=out.entries[0].entry_id;
  await go('/msp/billing?tab=invoicing');await page.waitForTimeout(2500);
  const range=page.locator('#billing-period-date-range');if(!await range.isVisible())await page.getByRole('button',{name:/^Filters/}).first().click();
  const toDate=range.getByRole('combobox').nth(1);await toDate.click();await toDate.press('Control+A');await toDate.pressSequentially('11/01/2026');await toDate.press('Tab');
  await page.locator('#apply-billing-period-date-filter').click();await page.waitForTimeout(3000);
  const table=page.locator('[data-automation-id="automatic-invoices-table"]');const groups=table.locator('button[id^="toggle-group-"]');
  for(let i=0;i<await groups.count();i++){const g=groups.nth(i);if((await g.getAttribute('aria-expanded'))!=='true')await g.click().catch(()=>{})}
  await page.waitForTimeout(1500);
  const row=table.locator('tbody tr').filter({has:page.locator(`[data-testid^="non-contract-child-"][data-testid*="${E1}"]`)});await until(async()=>await row.count()===1,'first entry offered');
  await row.locator('input[id^="select-child-"]').check();await page.locator('#preview-selected-button').click();await page.locator('#generate-invoice-from-preview-button').waitFor();
  await shot('b-preview-first-entry');await page.locator('#generate-invoice-from-preview-button').click();
  const inv=await until(()=>{const x=sql(`select row_to_json(i) from (select i.invoice_id,i.invoice_number,i.status,i.subtotal from invoices i join invoice_time_entries t on t.tenant=i.tenant and t.invoice_id=i.invoice_id where i.tenant='${ids.msp}' and t.entry_id='${E1}') i`);return x?JSON.parse(x):null},'pre-cutoff draft',90000);
  out.preCutoffInvoice=inv;save();
  await check('first-entry-drafted-before-cutoff-at-catalog-rate',inv.status==='draft'&&Number(inv.subtotal)===Math.round(20/60*12000),{inv});
  // 8. A shared customer message whose MSP delivery is still queued at cutoff.
  await fault('arm');out.faultArmed=true;save();
  const queued=await post(customer,'Shared IT teams','queued-at-cutoff',false);out.queuedText=queued;save();
  const pending=await until(()=>{const x=sql(`select row_to_json(d) from (select d.delivery_key,d.status,d.attempt_count,d.error_code,d.next_attempt_at,d.comment_id from co_management_email_deliveries d where d.tenant='${ids.msp}' and d.customer_tenant='${C}' and d.ticket_id='${fx.ticket}' order by d.created_at desc limit 1) d`);const d=x?JSON.parse(x):null;return d&&d.status==='pending'&&d.attempt_count>0?d:null},'delivery queued after a refused send',240000);
  out.queuedDelivery=pending;save();
  await check('msp-delivery-is-queued-and-unsent-at-cutoff',!(await sink()).some(m=>String(m.text||m.html||'').includes(queued)),{pending});
  await shot('b-ready-for-cutoff');
  return {status:'passed',limitations:['Isolated technician/team created by operator SQL (same prerequisite as guide 09); assignment, staff access, billing cycle, time capture, approval, invoicing and messages use native UI. SMTP sink reject-mail fault holds the queued delivery.']};
});if(r.scenarioStatus==='failed')process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1});
