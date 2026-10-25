const {scenario}=require('./runtime.cjs');const f=require('../rehearsal-10a-c31dc3/fixtures.json');
(async()=>{await scenario('probe-sla-page',async({page,actor,go,shot,inspect,mark})=>{await actor('qa');await go('/msp/co-management/sla?operationId='+f.operationId);await page.waitForTimeout(3000);await shot('sla');const v=await inspect('sla');
 await mark('sla',{text:v.text.slice(v.text.indexOf('SLA'),v.text.indexOf('SLA')+1500),ids:v.inputs.filter(x=>x.id&&/co-sla/.test(x.id)).map(x=>[x.id,x.text.slice(0,30),x.disabled])});return {status:'partial',limitations:['probe']}});})();
