const {scenario,privateRoot}=require('./runtime.cjs'),fs=require('fs');
(async()=>{await scenario('probe-native-ticket-page-dev',async({page,actor,go,mark,shot})=>{
 await actor('alice');await go('/msp/tickets/6a1806e0-d0c3-4349-ae81-a95b95d7dbf1');await page.waitForTimeout(8000);
 const t=await page.locator('body').innerText();await mark('alice-active',{crashed:t.includes('Something went wrong'),hasTitle:t.includes('CM requester conversation'),editTitle:await page.locator('button[title="Edit title"]').count()});
 const fx=require('../rehearsal-10b-c31dc3-r1/fixtures.json');const cred=JSON.parse(fs.readFileSync(privateRoot+'/'+fx.credentialFile));
 await actor({name:'ended',email:cred.email,password:cred.password});await go('/msp/tickets/'+fx.ticket);await page.waitForTimeout(8000);await page.getByRole('button',{name:'Entry',exact:true}).click().catch(()=>{});await page.waitForTimeout(3000);
 const u=await page.locator('body').innerText();await mark('ended-customer',{crashed:u.includes('Something went wrong'),editTitleEnabled:await page.locator('button[title="Edit title"]').filter({visible:true}).count()?await page.locator('button[title="Edit title"]').filter({visible:true}).first().isEnabled():false,save:await page.locator('#ticket-details-info-save-changes-btn').filter({visible:true}).count(),timeErr:u.includes('Could not load time entries')});await shot('ended');
 return {status:'partial',limitations:['dev probe']};
});})();
