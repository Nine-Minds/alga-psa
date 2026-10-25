// Guide 09: customer operational time on the shared task stays operational (no service,
// contract or billable minutes) and changes only the customer's share of recorded effort;
// both organizations see the same arithmetic. Delta-based, so it can be recorded again.
const {scenario,ids,sql,until}=require('./runtime.cjs'),fs=require('fs');
const f=require('../'+(process.env.CM_BILLING_CAPTURE||'09-billing-capture-current')+'/fixtures.json');
const hours=t=>Number(String(t).replace(/[^0-9.]/g,''));
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'09-operational-commercial-effort-delta',async({page,actor,go,check,shot,dir})=>{
  const read=async()=>{const dd=await page.locator('section[aria-label="Recorded effort"] dd').allTextContents();return {raw:dd,customer:hours(dd[0]),msp:hours(dd[1]),combined:hours(dd[2])}};
  const before={};
  for(const who of ['alice','qa']){await actor(who);await go(f.taskRoute);await page.locator('section[aria-label="Recorded effort"] dd').first().waitFor();before[who]=await read()}
  await actor('alice');await go(f.taskRoute);await page.locator('#co-shared-log-time').click();
  await page.locator('#time-entry-dialog-duration-hours-0').fill('0');await page.locator('#time-entry-dialog-duration-minutes-0').fill('6');
  const note='CM billing customer operational '+f.stamp+' '+Date.now();await page.locator('#time-entry-dialog-notes-0').fill(note);
  await page.locator('#time-entry-dialog-save-dialog-btn').click();
  const entry=await until(()=>{const v=sql(`select row_to_json(x) from(select entry_id,billing_mode,billable_duration,service_id,contract_line_id,work_item_type,work_item_id,extract(epoch from(end_time-start_time))/60 as minutes from time_entries where tenant='${ids.customer}' and notes='${note}')x`);return v?JSON.parse(v):null},'customer native operational entry');
  await check('customer-six-minutes-have-no-commercial-routing',entry.work_item_type==='project_task'&&entry.work_item_id===f.taskId&&entry.billing_mode==='operational'&&entry.billable_duration===0&&entry.service_id===null&&entry.contract_line_id===null&&Number(entry.minutes)===6,{entry});
  const after={};
  for(const who of ['alice','qa']){await actor(who);await go(f.taskRoute);
    await until(async()=>{const a=await read();return Math.abs(a.customer-before[who].customer-0.1)<0.006?a:null},who+' sees the customer effort grow by six minutes');
    after[who]=await read();
    await check(who+'-sees-customer-plus-six-minutes-and-unchanged-msp-effort',Math.abs(after[who].customer-before[who].customer-0.1)<0.006&&after[who].msp===before[who].msp&&Math.abs(after[who].combined-(after[who].customer+after[who].msp))<0.006,{before:before[who].raw,after:after[who].raw});
    await check(who+'-does-not-see-other-organization-time-note',!(await page.locator('body').innerText()).includes(who==='qa'?note:'CM billing '+f.stamp+' contracted'));
    await shot(who+'-effort')}
  await check('both-organizations-see-the-same-effort',JSON.stringify(after.alice.raw)===JSON.stringify(after.qa.raw),{alice:after.alice.raw,qa:after.qa.raw});
  fs.writeFileSync(dir+'/receipt.json',JSON.stringify({customerEntry:entry,before,after},null,2));
  return {status:'passed',limitations:[]};
});if(r.scenarioStatus==='failed')process.exitCode=1;})();
