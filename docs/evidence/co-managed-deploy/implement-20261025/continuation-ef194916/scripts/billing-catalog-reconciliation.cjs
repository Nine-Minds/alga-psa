// Guide 09: approved MSP catalog time on shared co-managed work (no contract covers
// the service) is visible in the client's unresolved-charge review as catalog-rate
// work, appears once in Automatic Invoices, and reconciles to the catalog rate on a
// draft invoice traced back to the source entry. CM_PREVIEW_ONLY=1 stops before generation.
const {scenario,ids,sql,until,reverseDraft}=require('./runtime.cjs'),fs=require('fs');
const f=require('../billing-fixture.json');
const ENTRY=process.env.CM_CATALOG_ENTRY||'22d6acc4-1e3d-4769-bf10-f8668793decd';
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'09-catalog-pricing-reconciliation',async({page,actor,go,check,mark,shot,inspect,dir})=>{
  const entry=JSON.parse(sql(`select row_to_json(e) from (select e.entry_id,e.billable_duration,e.approval_status,e.invoiced,e.contract_line_id,e.contract_line_unresolved_reason,e.billing_mode,e.work_item_type,e.service_id,s.service_name,s.default_rate,r.client_id from time_entries e join service_catalog s on s.tenant=e.tenant and s.service_id=e.service_id join co_managed_time_work_references r on r.tenant=e.tenant and r.reference_id=e.work_item_id where e.tenant='${ids.msp}' and e.entry_id='${ENTRY}') e`));
  const expectedCents=Math.round(entry.billable_duration/60*entry.default_rate);
  await check('source-is-approved-commercial-catalog-time-on-shared-work',entry.approval_status==='APPROVED'&&entry.contract_line_id===null&&entry.billing_mode==='commercial'&&entry.work_item_type==='co_managed'&&entry.client_id===ids.client,{entry,expectedCents});
  await actor('qa');const money=page.locator('#client-details-cc-card-money').getByRole('button',{name:'Open',exact:true});
  // 2. The period already has a draft for this billing profile; reverse it through
  //    Recurring Invoice History so late catalog time is billed with the contracted time.
  const CONTRACTED='7fc0b76c-f887-4a63-88bb-89b3341a37ea';
  const draftQ=()=>sql(`select coalesce(json_agg(i),'[]') from (select i.invoice_id,i.invoice_number,i.billing_cycle_id from invoices i where i.tenant='${ids.msp}' and i.client_id='${ids.client}' and i.billing_profile_id='${f.profileId}' and i.status='draft' and i.billing_period_start='2026-10-01') i`);
  const drafts=JSON.parse(draftQ());
  await mark('existing-profile-drafts',{drafts});
  for(const d of drafts)await reverseDraft(page,d.invoice_id);
  await go('/msp/billing?tab=invoicing');await page.waitForTimeout(2500);
  await check('reversing-the-profile-drafts-reopens-the-examined-entry',JSON.parse(draftQ()).length===0&&sql(`select invoiced::text from time_entries where tenant='${ids.msp}' and entry_id='${ENTRY}'`)==='false',{reversed:drafts.map(d=>d.invoice_number)});
  // Catalog-pricing review of the reopened entry on the client's billing dashboard.
  if(process.env.CM_SKIP_REVIEW!=='1'){
  // 1. Catalog-pricing review on the client's billing dashboard.
  await actor('qa');await go('/msp/clients/'+ids.client);
await money.click();await page.waitForTimeout(2500);
  const review=page.getByText(entry.service_name,{exact:true}).first();await review.waitFor({timeout:45000});
  const card=page.locator('li').filter({hasText:entry.service_name}).filter({hasText:'Not covered by any contract'}).first();
  await card.waitFor();const cardText=await card.innerText();
  await check('review-lists-uncovered-catalog-time-with-catalog-rate-explanation',cardText.includes('Not covered by any contract')&&cardText.includes(entry.billable_duration+' min')&&/catalog rate is the only rate/i.test(cardText),{cardText});
  await check('uncovered-item-needs-no-catalog-pricing-decision',await card.locator('[id^="catalog-pricing-"]').count()===0&&await card.locator('[id^="assign-line-"]').count()===0);
  await card.scrollIntoViewIfNeeded();await shot('01-catalog-pricing-review');
  } else await actor('qa');
  await go('/msp/billing?tab=invoicing');await page.waitForTimeout(2500);
  const table=page.locator('[data-automation-id="automatic-invoices-table"]');await table.waitFor();
  // Unresolved work is offered for periods ending inside the date filter, which
  // defaults to today; include the period that ends on 1 November.
  const range=page.locator('#billing-period-date-range');
  if(!await range.isVisible())await page.getByRole('button',{name:/^Filters/}).first().click();
  const toDate=range.getByRole('combobox').nth(1);await toDate.click();await toDate.press('Control+A');await toDate.pressSequentially('11/01/2026');await toDate.press('Tab');
  await page.locator('#apply-billing-period-date-filter').click();await page.waitForTimeout(3000);
  await mark('date-filter-includes-period-ending-nov-1',{to:await toDate.inputValue()});
  const groups=table.locator('button[id^="toggle-group-"]');for(let i=0;i<await groups.count();i++){const g=groups.nth(i);if((await g.getAttribute('aria-expanded'))!=='true')await g.click().catch(()=>{})}
  await page.waitForTimeout(1500);
  // Every approved, uninvoiced October entry on this billing profile is now eligible again:
  // the contracted entries bill on the contract line, the catalog entries at the catalog rate.
  const eligible=t=>JSON.parse(sql(`select coalesce(json_agg(x order by x.entry_id),'[]') from (select e.entry_id,e.billable_duration,e.service_id from time_entries e join co_managed_time_work_references r on r.tenant=e.tenant and r.reference_id=e.work_item_id where e.tenant='${ids.msp}' and r.billing_profile_id='${f.profileId}' and r.client_id='${ids.client}' and e.approval_status='APPROVED' and not e.invoiced and e.start_time>='2026-10-01' and e.start_time<'2026-11-01' and e.service_id='${t}') x`));
  const contracted=eligible(f.serviceId),catalog=eligible(entry.service_id);
  await mark('eligible-entries',{contracted:contracted.map(x=>[x.entry_id,x.billable_duration]),catalog:catalog.map(x=>[x.entry_id,x.billable_duration])});
  if(!catalog.some(x=>x.entry_id===ENTRY))throw new Error('The examined catalog entry is not eligible');
  const catalogRows=[];
  for(const c of catalog){const row=table.locator('tbody tr').filter({has:page.locator(`[data-testid^="non-contract-child-"][data-testid*="${c.entry_id}"]`)});
    await until(async()=>await row.count()>0,'unresolved catalog row offered for '+c.entry_id,30000);catalogRows.push(row)}
  await check('automatic-invoices-offers-each-catalog-entry-once',(await Promise.all(catalogRows.map(r=>r.count()))).every(n=>n===1),{rows:catalog.length,example:await catalogRows[catalog.findIndex(x=>x.entry_id===ENTRY)].first().innerText()});
  const catalogBox=catalogRows[0].first().locator('input[id^="select-child-"]');
  const catalogBoxId=await catalogBox.getAttribute('id');
  const groupKey=catalogBoxId.slice('select-child-'.length,catalogBoxId.indexOf('-client_cadence_window'));
  const contractRow=table.locator('tbody tr').filter({hasText:f.contractName}).filter({has:page.locator(`input[id^="select-child-${groupKey}-"]`)});
  await contractRow.first().waitFor();
  await check('contracted-and-catalog-time-share-one-invoice-group',await contractRow.count()===1,{groupKey});
  await contractRow.first().scrollIntoViewIfNeeded();await shot('02-due-work-contracted-and-catalog');
  await contractRow.first().locator(`input[id^="select-child-${groupKey}-"]`).check();
  for(const row of catalogRows)await row.first().locator('input[id^="select-child-"]').check();
  await page.locator('#preview-selected-button').click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await page.locator('#generate-invoice-from-preview-button').waitFor();await page.waitForTimeout(1000);
  const preview=await dialog.innerText();
  const rate=entry.default_rate,fmt=c=>'$'+(c/100).toFixed(2);
  const contractedMinutes=contracted.reduce((n,x)=>n+x.billable_duration,0),contractedCents=Math.round(contractedMinutes/60*12000);
  const catalogLine=new RegExp(entry.service_name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s+'+(entry.billable_duration/60)+'\\s+\\'+fmt(rate)+'\\s+\\'+fmt(expectedCents));
  await check('preview-prices-catalog-time-at-catalog-rate',catalogLine.test(preview),{line:`${entry.service_name} ${entry.billable_duration/60} h × ${fmt(rate)} = ${fmt(expectedCents)}`});
  await check('preview-keeps-contracted-time-at-its-contract-rate',preview.includes('Contract: '+f.contractName)&&preview.includes(fmt(contractedCents)),{contractedMinutes,amount:fmt(contractedCents)});
  await shot('03-preview');await inspect('03-preview');
  if(process.env.CM_PREVIEW_ONLY==='1')return {status:'partial',limitations:['rehearsal: preview only, nothing generated']};
  // 3. Generate and reconcile every draft to its source entries.
  await page.locator('#generate-invoice-from-preview-button').click();
  const invoiceFor=id=>{const x=sql(`select row_to_json(i) from (select i.invoice_id,i.invoice_number,i.status,i.subtotal,i.client_id,i.billing_profile_id from invoices i join invoice_time_entries t on t.tenant=i.tenant and t.invoice_id=i.invoice_id where i.tenant='${ids.msp}' and t.entry_id='${id}') i`);return x?JSON.parse(x):null};
  for(const x of [...contracted,...catalog])await until(()=>invoiceFor(x.entry_id),'draft for '+x.entry_id,90000);
  const invoice=invoiceFor(ENTRY),contractInvoice=invoiceFor(contracted[0].entry_id);
  const detail=inv=>({charges:JSON.parse(sql(`select coalesce(json_agg(c),'[]') from (select description,quantity,unit_price,net_amount from invoice_charges where tenant='${ids.msp}' and invoice_id='${inv.invoice_id}') c`)),sources:JSON.parse(sql(`select coalesce(json_agg(entry_id order by entry_id),'[]') from invoice_time_entries where tenant='${ids.msp}' and invoice_id='${inv.invoice_id}'`))});
  const cat=detail(invoice),con=detail(contractInvoice);
  const catalogInvoices=[...new Set(catalog.map(x=>invoiceFor(x.entry_id).invoice_id))];
  const catalogTotal=catalogInvoices.reduce((n,id)=>n+Number(sql(`select subtotal from invoices where invoice_id='${id}'`)),0);
  await check('catalog-time-reconciles-to-the-catalog-rate-and-its-source-entries',invoice.status==='draft'&&invoice.client_id===ids.client&&cat.sources.includes(ENTRY)&&catalogTotal===catalog.reduce((n,x)=>n+Math.round(x.billable_duration/60*rate),0),{invoice,examined:cat,catalogInvoices:catalogInvoices.length,catalogTotal});
  await check('contracted-time-reconciles-to-its-contract-line-and-source-entries',contractInvoice.status==='draft'&&JSON.stringify(con.sources)===JSON.stringify(contracted.map(x=>x.entry_id).sort())&&Number(contractInvoice.subtotal)===contractedCents,{contractInvoice,...con});
  await check('each-entry-is-invoiced-exactly-once',[...contracted,...catalog].every(x=>Number(sql(`select count(*) from invoice_time_entries where tenant='${ids.msp}' and entry_id='${x.entry_id}'`))===1&&sql(`select invoiced from time_entries where tenant='${ids.msp}' and entry_id='${x.entry_id}'`)==='t'));
  await go('/msp/invoices/'+invoice.invoice_id);await page.getByText(invoice.invoice_number,{exact:false}).first().waitFor();await shot('04-catalog-draft-invoice');
  const charges=cat.charges,sources=cat.sources;
  if(process.env.CM_SKIP_REVIEW!=='1'){await go('/msp/clients/'+ids.client);await money.click();await page.waitForTimeout(2500);
    await check('review-no-longer-lists-the-invoiced-catalog-entry',await page.locator('li').filter({hasText:entry.service_name}).filter({hasText:entry.billable_duration+' min'}).count()===0)}
  fs.writeFileSync(dir+'/invoice-receipt.json',JSON.stringify({entry,invoice,charges,sources,expectedCents,contractInvoice,contracted:con,reversedDrafts:drafts,eligible:{contracted,catalog}},null,2));
  return {status:'passed',limitations:['Draft invoice only; nothing finalized or emailed.']};
});if(r.scenarioStatus==='failed')process.exitCode=1;})();
