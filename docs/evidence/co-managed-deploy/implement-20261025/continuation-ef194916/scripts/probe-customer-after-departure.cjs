const {scenario,sql,privateRoot}=require('./runtime.cjs'),fs=require('fs');const fx=require('../rehearsal-10b-c31dc3-r1/fixtures.json');
(async()=>{await scenario('probe-customer-after-departure',async({page,actor,go,mark,shot})=>{
 const cred=JSON.parse(fs.readFileSync(privateRoot+'/'+fx.credentialFile));await actor({name:'c',email:cred.email,password:cred.password});
 const failures=[];page.on('response',async r=>{const a=r.request().headers()['next-action'];if(a){const b=await r.text().catch(()=>'');if(/actionError|permissionError|READ_ONLY|readOnly|FORBIDDEN|error/i.test(b))failures.push({status:r.status(),body:b.slice(0,400)})}});
 await go('/msp/tickets/'+fx.ticket);await page.waitForTimeout(3000);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(2000);
 const edit=page.locator('button[title="Edit title"]').filter({visible:true});await mark('edit-button',{count:await edit.count(),enabled:await edit.count()?await edit.first().isEnabled():null});
 if(await edit.count()){await edit.first().click();await page.waitForTimeout(500);const inp=page.locator('#ticket-details-info-title-input');await mark('title-input',{count:await inp.count()});
  if(await inp.count()){await inp.fill(fx.prefix+' probe rename');await page.locator('#ticket-details-info-save-title-btn').click();await page.waitForTimeout(2500)}}
 const toasts=await page.locator('[role="status"],[role="alert"],.toast,[data-sonner-toast]').allInnerTexts();
 await mark('after-save',{title:sql(`select title from tickets where tenant='${fx.customer}' and ticket_id='${fx.ticket}'`),toasts,failures:failures.slice(0,6)});await shot('probe');
 return {status:'partial',limitations:['probe']};
});})();
