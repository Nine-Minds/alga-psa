const {scenario,origin,reviewDist}=require('./runtime.cjs'),fs=require('fs');
(async()=>{await scenario('probe-due-work-c31dc3',async({page,ctx,actor,go,mark,dir})=>{
 await actor('qa');await go('/msp/billing?tab=invoicing');
 const m=JSON.parse(fs.readFileSync('/home/robert/alga-copies/feature-co-managed-it/server/'+reviewDist+'/server/server-reference-manifest.json'));
 const id=Object.entries(m.node).find(([k,v])=>v.exportedName==='getAvailableRecurringDueWork')?.[0];
 const r=await ctx.request.post(origin+'/msp/billing?tab=invoicing',{headers:{'Next-Action':id,'Content-Type':'text/plain;charset=UTF-8',Origin:origin},data:JSON.stringify([{page:1,pageSize:100}])});
 const body=await r.text();fs.writeFileSync(dir+'/response.txt',body);
 await mark('response',{status:r.status(),unresolved:(body.match(/unresolved:time:[0-9a-f-]+/g)||[]).slice(0,30),len:body.length});
 return {status:'partial',limitations:['probe']};
});})();
