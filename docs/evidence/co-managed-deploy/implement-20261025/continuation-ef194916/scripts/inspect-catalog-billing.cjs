const {scenario,ids}=require('./runtime.cjs'),fs=require('fs');
(async()=>{await scenario('probe-catalog-billing-c1f6',async({page,actor,go,shot,inspect,mark})=>{
 await actor('qa');
 await go('/msp/clients/'+ids.client+'?tab=billing-dashboard');await page.waitForTimeout(4000);await shot('client-billing-dashboard');
 const v=await inspect('client-billing-dashboard');const i=v.text.indexOf('Not covered');
 await mark('dashboard',{hasUncovered:i>=0,snippet:v.text.slice(Math.max(0,i-1200),i+700)});
 await go('/msp/billing?tab=invoicing');await page.waitForTimeout(3000);
 for(const name of ['Needs attention','All']){const b=page.getByText(name,{exact:true}).first();if(await b.count()){await b.click();await page.waitForTimeout(1500)}}
 const row=page.locator('[data-automation-id="automatic-invoices-table"] tbody tr').filter({hasText:'White Rabbit'}).first();
 await row.locator('button[id^="toggle-group-"]').click().catch(()=>{});await page.waitForTimeout(1500);
 await shot('invoicing-expanded');const w=await inspect('invoicing-expanded');const j=w.text.indexOf('CLIENT / GROUP');await mark('invoicing',{snippet:w.text.slice(j,j+1500)});
 return {status:'partial',limitations:['diagnostic probe']};
});})();
