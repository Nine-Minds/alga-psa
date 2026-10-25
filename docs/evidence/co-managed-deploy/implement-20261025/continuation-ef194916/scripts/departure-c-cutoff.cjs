// Guide 10, stage C: end the disposable relationship and test every post-cutoff path —
// seats, queued delivery, old access, sealed archive, customer post-departure change,
// commercial continuity, and the customer's retained data.
const {scenario,ids,origin,sql,until,assert,privateRoot,reverseDraft}=require('./runtime.cjs');
const fs=require('fs'),crypto=require('crypto');
const B=process.env.CM_STAGE_B||'10-departure-b-content';
const fx=require('../'+B+'/fixtures.json');
const sink=async()=>(await(await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result;
const disarm=async()=>{await fetch('http://127.0.0.1:9177/control/smtp-sink/faults/reject-mail/disarm',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})};
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'10-departure-c-cutoff',async({page,ctx,actor,go,check,mark,shot,inspect,dir})=>{
  const C=fx.customer,R=fx.relationship,T=fx.ticket,receipt={stageB:B};const save=()=>fs.writeFileSync(dir+'/receipt.json',JSON.stringify(receipt,null,2));
  const cred=JSON.parse(fs.readFileSync(privateRoot+'/'+fx.credentialFile));const customer={name:'departAdmin',email:cred.email,password:cred.password};
  const capacity=()=>Number(sql(`select capacity from co_managed_entitlements where tenant='${ids.msp}'`));
  const alloc=()=>JSON.parse(sql(`select row_to_json(a) from (select allocation_id,seats,state,released_at from co_managed_allocations where allocation_id='${fx.allocationId}') a`));
  const delivery=()=>JSON.parse(sql(`select row_to_json(d) from (select status,attempt_count,error_code,completed_at from co_management_email_deliveries where tenant='${ids.msp}' and delivery_key='${fx.queuedDelivery.delivery_key}') d`));
  const already=sql(`select state from co_management_relationships where tenant='${C}' and relationship_id='${R}'`)==='terminated';
  let priv=fx.files.find(x=>x.label==='customerprivate');
  if(already&&process.env.CM_RESUME_AFTER_CUTOFF==='1'){await mark('resume-after-cutoff',{relationship:R})}else{
  const clock=()=>JSON.parse(sql(`select clock from sla_organization_obligations where tenant='${ids.msp}' and source_tenant='${C}' and ticket_id='${T}' order by generation desc limit 1`)||'null');
  const before={capacity:capacity(),allocation:alloc(),delivery:delivery(),clock:clock()};receipt.before=before;save();
  await check('baseline-relationship-active-with-queued-delivery-and-msp-sla-obligation',sql(`select state from co_management_relationships where tenant='${C}' and relationship_id='${R}'`)==='active'&&before.delivery.status==='pending'&&!!before.clock?.startedAt,{allocation:before.allocation,delivery:before.delivery,slaStartedAt:before.clock?.startedAt,pauseReasons:before.clock?.pauseReasons,resolutionDueAt:before.clock?.resolution?.dueAt});
  // 1. End the relationship from the sponsor's departure screen.
  await actor('qa');await go('/msp/co-management/departure?operationId='+fx.operationId);
  await page.locator('#co-departure-review').click();await shot('c1-review-departure');
  await page.locator('#co-departure-confirm-confirm').click();
  await until(()=>sql(`select state from co_management_relationships where tenant='${C}' and relationship_id='${R}'`)==='terminated','relationship closed',90000);
  await page.locator('#co-departure-refresh').click();await page.getByText('This co-management relationship has ended.',{exact:false}).waitFor();await shot('c2-ended');
  const after=alloc();receipt.after=after;save();
  await check('allocation-released-once-and-paid-pool-unchanged',after.state==='released'&&!!after.released_at&&capacity()===before.capacity,{after,capacity:capacity()});
  const cut=clock();receipt.clockAfter=cut;save();
  const added=(cut?.pauseReasons||[]).filter(r=>!(before.clock?.pauseReasons||[]).includes(r));
  await check('msp-sla-clock-is-held-by-the-cutoff',cut&&cut.resolution.dueAt===null&&added.length>0,{before:before.clock?.pauseReasons,after:cut?.pauseReasons,addedByCutoff:added,resolutionDueAt:cut?.resolution?.dueAt});
  await page.reload();
  await check('refresh-repeats-neither-closure-nor-release',Number(sql(`select count(*) from co_managed_relationship_closures where tenant='${ids.msp}' and customer_tenant='${C}' and relationship_id='${R}'`))===1&&JSON.stringify(alloc())===JSON.stringify(after));
  // 2. The delivery queued before cutoff is not sent after it.
  await disarm();receipt.faultDisarmedAt=new Date().toISOString();save();
  const settled=await until(()=>{const d=delivery();return d.status!=='pending'?d:null},'queued delivery processed after cutoff',300000);
  receipt.queuedDeliveryAfter=settled;save();
  const mails=await sink();
  await check('queued-delivery-is-skipped-not-sent-after-cutoff',settled.status==='skipped'&&!mails.some(m=>String(m.text||m.html||'').includes(fx.queuedText)),{settled,controlMailStillPresent:mails.some(m=>String(m.text||m.html||'').includes(fx.mailControl))});
  // 3. Old live access is closed.
  for(const f of fx.files){const resp=await ctx.request.get(origin+f.href);await check('old-live-'+f.label+'-file-denied',!resp.ok(),{status:resp.status()})}
  await go(fx.route);await page.getByRole('alert').first().waitFor();
  await check('old-shared-route-no-longer-shows-live-ticket',!(await page.locator('main').innerText()).includes(fx.prefix+' shared'));await shot('c3-old-route-denied');
  // 4. The sealed archive holds what the MSP may retain.
  const manifest=()=>JSON.parse(sql(`select row_to_json(m) from (select content_hash,sealed_at from co_managed_archive_manifests where tenant='${ids.msp}' and customer_tenant='${C}' and relationship_id='${R}') m`)||'null');
  const evidenceCount=()=>Number(sql(`select count(*) from co_managed_participation_evidence where tenant='${ids.msp}' and customer_tenant='${C}' and relationship_id='${R}'`));
  const sealed=manifest(),evidenceAtSeal=evidenceCount();receipt.manifest=sealed;receipt.evidenceAtSeal=evidenceAtSeal;save();
  await check('archive-sealed-at-cutoff',!!sealed?.content_hash&&!!sealed.sealed_at,{sealed,evidenceAtSeal});
  const openArchive=async()=>{await go('/msp/co-managed/archive');const work=page.locator(`[id="co-archive-work-${C}-${R}-ticket-${T}"]`);
    for(let i=0;i<20&&!await work.count();i++){const next=page.locator('#co-archive-work-next');await next.waitFor();if(await next.isDisabled())break;await next.click();await page.waitForTimeout(500)}
    await work.click();await page.waitForTimeout(1500)};
  await openArchive();
  const archiveText=await page.locator('main').innerText();receipt.archiveTextBefore=archiveText.slice(0,4000);save();
  for(const label of ['shared','MSPprivate']){const f=fx.files.find(x=>x.label===label);const link=page.getByRole('link',{name:f.fileName,exact:true});await link.waitFor();
    const resp=await ctx.request.get(origin+await link.getAttribute('href'));await check('retained-'+label+'-bytes-match',resp.ok()&&crypto.createHash('sha256').update(await resp.body()).digest('hex')===f.sha256)}

  await check('archive-excludes-customer-private-content',!archiveText.includes(priv.text)&&await page.getByRole('link',{name:priv.fileName,exact:true}).count()===0);
  await check('archive-retains-the-msp-time-evidence',/time/i.test(archiveText)&&Number(sql(`select count(*) from co_managed_participation_evidence where tenant='${ids.msp}' and customer_tenant='${C}' and relationship_id='${R}' and event_type='time_recorded'`))>=1);
  await shot('c4-retained-archive');await inspect('c4-retained-archive');
  // 5. After cutoff the customer workspace is read-only (reading, export and upgrade remain):
  //    the native screen offers no change, and nothing the customer sees can reach the archive.
  await actor(customer);await go('/msp/tickets/'+T);await page.waitForTimeout(1500);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(1000);
  const newTitle=fx.prefix+' renamed after departure';
  const titleEdit=page.locator('button[title="Edit title"]').filter({visible:true});
  const customerChange={titleEditOffered:await titleEdit.count()>0&&await titleEdit.first().isEnabled(),saveOffered:await page.locator('#ticket-details-info-save-changes-btn').filter({visible:true}).count()>0,
    composerOffered:await page.locator('#ticket-details-conversation-show-comment-editor-btn').filter({visible:true}).count()>0,timePanelError:(await page.locator('main').innerText()).includes('Could not load time entries')};
  receipt.customerChange=customerChange;save();await shot('c5-customer-read-only-after-departure');
  await check('customer-workspace-offers-no-changes-after-departure',!customerChange.titleEditOffered&&!customerChange.saveOffered&&!customerChange.composerOffered&&!customerChange.timePanelError,customerChange);
  await actor('qa');await openArchive();const archiveAfter=await page.locator('main').innerText();
  await check('archive-and-seal-unchanged-after-cutoff',!archiveAfter.includes(newTitle)&&JSON.stringify(manifest())===JSON.stringify(sealed)&&evidenceCount()===evidenceAtSeal,{manifestUnchanged:JSON.stringify(manifest())===JSON.stringify(sealed),evidence:evidenceCount()});
  }
  // 6. Commercial continuity: MSP time and drafts survive and remain billable.
  await actor('qa');
  const [E1,E2]=fx.entries;const D1=fx.preCutoffInvoice;
  await check('commercial-entries-survive-departure',Number(sql(`select count(*) from time_entries where tenant='${ids.msp}' and entry_id in ('${E1.entry_id}','${E2.entry_id}') and approval_status='APPROVED'`))===2&&sql(`select invoiced from time_entries where tenant='${ids.msp}' and entry_id='${E2.entry_id}'`)==='f');
  await go('/msp/invoices/'+D1.invoice_id);await page.getByText(D1.invoice_number,{exact:false}).first().waitFor();
  await check('pre-cutoff-draft-still-opens-with-its-line',Number(sql(`select count(*) from invoice_time_entries where tenant='${ids.msp}' and invoice_id='${D1.invoice_id}' and entry_id='${E1.entry_id}'`))===1);await shot('c6-pre-cutoff-draft');
  await reverseDraft(page,D1.invoice_id);await mark('pre-cutoff-draft-reversed-after-departure',{invoice:D1.invoice_number});
  await go('/msp/billing?tab=invoicing');await page.waitForTimeout(2500);
  const range=page.locator('#billing-period-date-range');if(!await range.isVisible())await page.getByRole('button',{name:/^Filters/}).first().click();
  const toDate=range.getByRole('combobox').nth(1);await toDate.click();await toDate.press('Control+A');await toDate.pressSequentially('11/01/2026');await toDate.press('Tab');
  await page.locator('#apply-billing-period-date-filter').click();await page.waitForTimeout(3000);
  const table=page.locator('[data-automation-id="automatic-invoices-table"]');const groups=table.locator('button[id^="toggle-group-"]');
  for(let i=0;i<await groups.count();i++){const g=groups.nth(i);if((await g.getAttribute('aria-expanded'))!=='true')await g.click().catch(()=>{})}
  await page.waitForTimeout(1500);
  for(const e of [E1,E2]){const row=table.locator('tbody tr').filter({has:page.locator(`[data-testid^="non-contract-child-"][data-testid*="${e.entry_id}"]`)});await until(async()=>await row.count()===1,'entry offered after departure');await row.locator('input[id^="select-child-"]').check()}
  await shot('c7-both-entries-offered-after-departure');
  await page.locator('#preview-selected-button').click();await page.locator('#generate-invoice-from-preview-button').waitFor();await page.waitForTimeout(1000);
  const preview=await page.getByRole('dialog').innerText();receipt.postDeparturePreview=preview.slice(0,2000);save();
  await page.locator('#generate-invoice-from-preview-button').click();
  const sources=await until(()=>{const x=JSON.parse(sql(`select coalesce(json_agg(json_build_object('entry',t.entry_id,'invoice',i.invoice_number,'status',i.status,'snapshot',t.work_item_snapshot)),'[]') from invoice_time_entries t join invoices i on i.tenant=t.tenant and i.invoice_id=t.invoice_id where t.tenant='${ids.msp}' and t.entry_id in ('${E1.entry_id}','${E2.entry_id}')`));return x.length===2?x:null},'both entries invoiced after departure',90000);
  receipt.postDepartureSources=sources;save();
  const total=Number(sql(`select coalesce(sum(i.subtotal),0) from invoices i where i.tenant='${ids.msp}' and i.invoice_number in (${[...new Set(sources.map(s=>`'${s.invoice}'`))].join(',')})`));
  await check('msp-bills-retained-commercial-time-after-departure',sources.every(s=>s.status==='draft')&&total===Math.round(30/60*12000),{sources:sources.map(s=>({entry:s.entry,invoice:s.invoice})),totalCents:total});
  await check('invoice-lines-keep-the-retained-work-identity',sources.every(s=>JSON.stringify(s.snapshot||{}).includes(fx.ticketTitle)||JSON.stringify(s.snapshot||{}).includes(T)),{snapshots:sources.map(s=>s.snapshot)});
  await shot('c8-post-departure-invoice');
  // 7. The customer keeps its native record and its private content.
  await actor(customer);await go('/msp/tickets/'+T);await page.waitForTimeout(1500);await page.getByRole('button',{name:'Entry',exact:true}).click();
  await page.getByText(priv.text,{exact:true}).filter({visible:true}).first().waitFor();
  await check('customer-keeps-native-ticket-and-private-content-without-the-former-msp-clock',await page.locator('#co-ticket-sla-msp').count()===0);await shot('c9-customer-retains');
  return {status:'passed',limitations:[]};
});if(r.scenarioStatus==='failed')process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1});
