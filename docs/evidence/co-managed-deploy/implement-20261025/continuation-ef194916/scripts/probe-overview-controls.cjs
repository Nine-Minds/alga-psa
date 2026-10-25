const {scenario,ids,shared}=require('./runtime.cjs'),fs=require('fs');
(async()=>{await scenario('probe-overview-controls-c1f6',async({page,actor,go,shot,mark,dir})=>{
 const out={};
 for(const who of ['qa','alice','viewer']){await actor(who);await go(who==='alice'?'/msp/tickets/'+ids.ticket:shared);
  for(const mode of ['Entry','Grid']){await page.getByRole('button',{name:mode,exact:true}).click();await page.waitForTimeout(2500);
   out[who+'-'+mode]=await page.evaluate(()=>[...document.querySelectorAll('main button[id],main input[id],main [role=combobox],main [data-automation-id]')].filter(e=>!/comment-|audience-select|tabs-|reply-|copy-/.test(e.id||'')).map(e=>({id:e.id||e.getAttribute('data-automation-id'),text:(e.innerText||e.value||'').slice(0,40),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true'})));
   await shot(who+'-'+mode)}}
 fs.writeFileSync(dir+'/controls.json',JSON.stringify(out,null,1));
 return {status:'partial',limitations:['diagnostic probe']};
});})();
