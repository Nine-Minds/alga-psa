const {scenario,ids}=require('./runtime.cjs');const f=require('../07-ticket-audiences-files-c1f6/fixtures.json');
const route='/msp/co-management/tickets/'+ids.customer+'/'+ids.relationship+'/'+f.ticketId;
(async()=>{await scenario('probe-layout-race-c1f6',async({page,actor,go,mark})=>{
 const st=async()=>({grid:await page.locator('#ticket-layout-toggle-grid').getAttribute('aria-pressed').catch(()=>null)});
 const reqs=[];page.on('request',r=>{const a=r.headers()['next-action'];if(a)reqs.push({t:Date.now(),a:a.slice(0,10)})});
 for(const pre of ['Grid','Entry']){
  await actor('qa');await go(route);
  await page.getByRole('button',{name:pre,exact:true}).click();await page.waitForTimeout(6000); // settle saved preference = pre
  await page.goto(page.url());await page.locator('#ticket-layout-toggle-entry').waitFor();
  const t0=Date.now();await page.getByRole('button',{name:'Entry',exact:true}).click();
  const series=[];for(let i=0;i<24;i++){await page.waitForTimeout(500);series.push(((Date.now()-t0)/1000).toFixed(1)+':'+(await st()).grid)}
  await mark('saved-'+pre+'-then-immediate-Entry',{series:series.join(' ')});
 }
 return {status:'partial',limitations:['diagnostic probe']};
});})();
