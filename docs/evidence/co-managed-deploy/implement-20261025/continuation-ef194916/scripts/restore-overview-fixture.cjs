// Restores the shared White Rabbit review ticket after an interrupted overview rehearsal,
// through the same native UI the walkthrough uses.
const {scenario,ids,shared,sql,until}=require('./runtime.cjs');
const C=ids.customer,T=ids.ticket,row=()=>JSON.parse(sql(`select row_to_json(t) from (select status_id,priority_id,category_id,assigned_to from tickets where tenant='${C}' and ticket_id='${T}') t`));
const name=(table,col,idcol,id)=>sql(`select ${col} from ${table} where tenant='${C}' and ${idcol}='${id}'`);
(async()=>{await scenario('restore-overview-fixture',async({page,actor,go,check})=>{
 const target={status:'Open',priority:'High',category:'SMOKE customer cat 20261016'};const cur=row();
 await actor('qa');await go(shared);await page.waitForTimeout(4000);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(1000);
 const combo=l=>page.getByRole('combobox').filter({hasText:new RegExp('^\\s*'+l+'\\s*$')}).filter({visible:true}).first();
 const curStatus=name('statuses','name','status_id',cur.status_id),curPri=name('priorities','priority_name','priority_id',cur.priority_id);
 if(curStatus!==target.status){await combo(curStatus).click();await page.getByRole('option',{name:target.status,exact:true}).click()}
 if(curPri!==target.priority){await combo(curPri).click();await page.getByRole('option',{name:target.priority,exact:true}).click()}
 const cb=page.locator('[data-automation-id$="-category-picker"], [data-automation-id$="-category-select"]').filter({visible:true}).getByRole('combobox').first();
 if(!(await cb.innerText()).includes(target.category)){await cb.click();await page.getByText(target.category,{exact:true}).filter({visible:true}).last().click();await page.keyboard.press('Escape').catch(()=>{})}
 await page.locator('#ticket-details-info-save-changes-btn').click();
 await until(()=>{const x=row();return name('statuses','name','status_id',x.status_id)===target.status&&name('priorities','priority_name','priority_id',x.priority_id)===target.priority&&x.category_id==='defeaa60-ef9b-40a6-be42-f145af3223a8'},'restored');
 await page.reload();await page.locator('#co-ticket-assignment-value').waitFor();
 if(!(await page.locator('#co-ticket-assignment-value').innerText()).includes('Not assigned')){await page.locator('#co-ticket-assignment-change').click();await until(async()=>await page.locator('#co-ticket-assignment-clear').isEnabled().catch(()=>false),'clear enabled');await page.locator('#co-ticket-assignment-clear').click();await page.locator('#co-ticket-assignment-cancel').waitFor({state:'detached'})}
 await page.reload();await page.locator('#co-ticket-assignment-value').waitFor();
 if(row().assigned_to){await actor('alice');await go('/msp/tickets/'+T);await page.waitForTimeout(4000);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.locator('#user-and-team-picker-trigger').click();await page.locator('[data-automation-id$="-option-unassigned"]').filter({visible:true}).first().click();await page.keyboard.press('Escape').catch(()=>{});await page.locator('#ticket-details-info-save-changes-btn').click();await until(()=>row().assigned_to===null,'assignee cleared');await actor('qa');await go(shared);await page.locator('#co-ticket-assignment-value').waitFor()}
 await check('fixture-restored',row().assigned_to===null&&(await page.locator('#co-ticket-assignment-value').innerText()).includes('Not assigned'),row());
 return {status:'passed',limitations:['rehearsal cleanup']};
});})();
