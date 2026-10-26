// Live re-proof on the admitted production build: Contacts > Upload CSV (real dialog,
// update-existing) and the list's TagManager reflecting the import without reload.
// Native Oz (qa) and active White Rabbit (alice): A -> blank, then A -> B.
// Terminated Kansas Farms (admin): blank-tags update is refused, byte-identical DB.
const rt=require('./runtime.cjs'),{privateRoot,sql,until,origin,build,credential}=rt,fs=require('fs'),path=require('path');
const root=path.dirname(__dirname);
const scenario=(name,fn)=>rt.scenario(root,name,fn);
if(!build)throw Error('Set CM_REVIEW_DIST to the served production build.');
const json=q=>JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));
const contactRows=(tenant,email)=>json(`select contact_name_id,full_name,email,is_inactive,updated_at from contacts where tenant='${tenant}' and lower(email)=lower('${email}') order by contact_name_id`);
const tagRows=(tenant,email)=>json(`select m.mapping_id,m.tag_id,d.tag_text,m.tagged_id from tag_mappings m join tag_definitions d on d.tenant=m.tenant and d.tag_id=m.tag_id join contacts c on c.tenant=m.tenant and c.contact_name_id=m.tagged_id where m.tenant='${tenant}' and m.tagged_type='contact' and lower(c.email)=lower('${email}') order by d.tag_text`);
const fullSnapshot=tenant=>({contacts:json(`select * from contacts where tenant='${tenant}' order by contact_name_id`),tag_definitions:json(`select * from tag_definitions where tenant='${tenant}' order by tag_id`),tag_mappings:json(`select * from tag_mappings where tenant='${tenant}' order by mapping_id`)});
const csvCell=v=>/[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;

async function openContacts(page,go){await go('/msp/contacts');await page.locator('#contacts-actions-button').waitFor({timeout:60000});}
// Real dialog: actions > Upload CSV > file > Preview (auto-mapped full_name/email/tags) > confirm update > Import.
async function csvImport(page,{full_name,email,tags},mark,shot,label){
  const csv='full_name,email,tags\n'+[full_name,email,tags].map(csvCell).join(',')+'\n';
  await page.locator('#contacts-actions-button').click();
  await page.getByRole('menuitem',{name:/Upload CSV/i}).click();
  const input=page.locator('input[type=file]');await input.waitFor({state:'attached'});
  await input.setInputFiles({name:'tagmanager.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#preview-import').waitFor();
  const mapping=await page.evaluate(()=>document.querySelector('[role=dialog]')?.innerText||'');
  await shot(label+'-mapping');
  await page.locator('#preview-import').click();
  const confirm=page.locator('#undefined-confirm');
  await until(async()=>(await confirm.count())>0||(await page.locator('#import-contacts').count())>0,'preview or update confirm');
  let updateExisting=false;
  if(await confirm.count()){updateExisting=true;await confirm.click();}
  await page.locator('#import-contacts').waitFor();await shot(label+'-preview');
  await page.locator('#import-contacts').click();
  // Success: Contacts closes the dialog itself (onImportComplete). Failure: the dialog stays on its results step.
  const dialogGone=async()=>(await page.locator('#import-contacts').count())===0&&(await page.getByRole('heading',{name:'Import Contacts'}).count())===0;
  const outcome=await until(async()=>(await page.locator('#close-import-dialog').count())>0?'results':(await page.locator('#close-import-complete').count())>0?'complete-step':(await dialogGone())?'closed':null,'import finished',60000);
  const resultText=outcome==='closed'?'':await page.evaluate(()=>document.querySelector('[role=dialog]')?.innerText||'');
  await shot(label+'-result');
  const complete=outcome!=='results';
  if(outcome!=='closed')await page.locator(outcome==='results'?'#close-import-dialog':'#close-import-complete').click();
  await page.waitForTimeout(300);
  await mark('csv import '+label,{csv,updateExisting,complete,outcome,mappingHasTags:/tags/i.test(mapping),result:resultText.slice(-600)});
  return {csv,updateExisting,complete,resultText};
}
// Visible rows only: the page also renders a hidden printable copy of the table.
const rowFor=(page,email)=>page.locator('tr').filter({hasText:email}).filter({visible:true});
const chipsIn=async(page,email)=>rowFor(page,email).locator('span[title]').evaluateAll(es=>es.map(e=>e.getAttribute('title')).filter(Boolean));

async function writable({name,who,tenant,contact}){return scenario(name,async({page,actor,go,check,shot,inspect,mark})=>{
  const stamp=Date.now().toString(36),A='TM-A '+stamp,B='TM-B '+stamp;
  const receipt={tenant,contact,tagA:A,tagB:B,steps:[]};
  const record=(step,extra={})=>{const r={step,at:new Date().toISOString(),contacts:contactRows(tenant,contact.email),tag_mappings:tagRows(tenant,contact.email),...extra};receipt.steps.push(r);fs.writeFileSync(path.join(root,name,'db-receipt.json'),JSON.stringify(receipt,null,2));return r};
  const initial=record('before');
  await check('contact-exists-once-before',initial.contacts.length===1,{contacts:initial.contacts.length});
  await actor(who);await openContacts(page,go);
  await rowFor(page,contact.email).waitFor({timeout:60000});
  let loadedAt=await page.evaluate(()=>performance.timeOrigin);
  const noReload=async id=>check(id,await page.evaluate(()=>performance.timeOrigin)===loadedAt,{timeOrigin:loadedAt});
  const flow=async(label,tags,expectChips)=>{
    const r=await csvImport(page,{...contact,tags},mark,shot,label);
    await check(label+'-import-complete',r.complete&&r.updateExisting,{complete:r.complete,updateExisting:r.updateExisting});
    const db=record(label);
    await check(label+'-db-tags',JSON.stringify(db.tag_mappings.map(t=>t.tag_text))===JSON.stringify(expectChips)&&db.contacts.length===1,{tags:db.tag_mappings.map(t=>t.tag_text),contacts:db.contacts.length});
    const chips=await until(async()=>{const c=await chipsIn(page,contact.email);return JSON.stringify(c)===JSON.stringify(expectChips)?c:null},label+' chips '+JSON.stringify(expectChips),20000);
    await check(label+'-ui-chips-without-reload',true,{chips});
    await check(label+'-contact-listed-once',(await rowFor(page,contact.email).count())===1,{rows:await rowFor(page,contact.email).count()});
    await noReload(label+'-same-document');
    await shot(label+'-list');await inspect(label+'-list');
  };
  await flow('01-set-A',A,[A]);
  await flow('02-blank-clears',' '.trim(),[]);
  await flow('03-set-A-again',A,[A]);
  await flow('04-replace-with-B',B,[B]);
  await page.reload({waitUntil:'domcontentloaded'});await rowFor(page,contact.email).waitFor({timeout:60000});await page.waitForTimeout(1500);
  const afterReload=await chipsIn(page,contact.email);await shot('05-after-reload');
  // Deliberate reload above; later flows are again checked against this document.
  loadedAt=await page.evaluate(()=>performance.timeOrigin);
  await check('05-reload-agrees',JSON.stringify(afterReload)===JSON.stringify([B]),{chips:afterReload});
  // Leave the fixture as found: tags cleared.
  await flow('06-restore-blank','',[]);
  return {status:'passed',limitations:[]};
});}

async function terminated(){return scenario('terminated-customer',async({page,actor,go,check,shot,inspect,mark})=>{
  const tenant='3261f313-8e04-45df-94bc-0343e92ba454',relationshipId='ad0808b5-25df-4e95-987a-aa650c8ba24f',email='admin@kansasfarms.test';
  const cred=credential('reprovision-20261025-departing-admin.json');
  const rel=()=>json(`select relationship_id,sponsor_tenant,state,ended_at,updated_at from co_management_relationships where tenant='${tenant}' and relationship_id='${relationshipId}'`)[0];
  const relBefore=rel();await check('relationship-terminated-before',relBefore.state==='terminated'&&relBefore.ended_at!==null,relBefore);
  const before=fullSnapshot(tenant);const contactBefore=contactRows(tenant,email);const tagsBefore=tagRows(tenant,email);
  await actor({name:'terminated-customer-admin',email:cred.email,password:cred.password});await openContacts(page,go);
  await rowFor(page,email).waitFor({timeout:60000});const chipsBefore=await chipsIn(page,email);await shot('01-before');
  const r=await csvImport(page,{full_name:'MUST NOT SAVE '+Date.now().toString(36),email,tags:''},mark,shot,'02-blank-update');
  await check('import-refused-read-only',!r.complete&&r.resultText.includes('This co-managed workspace is read-only'),{result:r.resultText.slice(-400)});
  const after=fullSnapshot(tenant);const relAfter=rel();
  const identical=JSON.stringify(before)===JSON.stringify(after);
  fs.writeFileSync(path.join(root,'terminated-customer','db-receipt.json'),JSON.stringify({tenant,relationshipBefore:relBefore,relationshipAfter:relAfter,contactBefore,contactAfter:contactRows(tenant,email),tagsBefore,tagsAfter:tagRows(tenant,email),
    countsBefore:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.length])),countsAfter:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.length])),identical,before,after},null,2));
  await check('contacts-tag-tables-byte-identical',identical,{counts:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.length]))});
  await check('relationship-still-terminated',JSON.stringify(relAfter)===JSON.stringify(relBefore),relAfter);
  await check('contact-listed-once-unchanged-chips',(await rowFor(page,email).count())===1&&JSON.stringify(await chipsIn(page,email))===JSON.stringify(chipsBefore),{chipsBefore});
  await page.reload({waitUntil:'domcontentloaded'});await rowFor(page,email).waitFor({timeout:60000});await page.waitForTimeout(1500);await shot('03-after-reload');
  await check('reload-name-unchanged',(await rowFor(page,email).innerText()).includes(contactBefore[0].full_name),{full_name:contactBefore[0].full_name});
  return {status:'passed',limitations:[]};
});}

(async()=>{
  const results=[],only=process.env.ONLY;
  const aliceCred=credential('reprovision-20261025-active-admin.json'),qa={name:'qa',email:'qa@emeraldcity.oz',password:credential('continuation-test-login.json').password};
  if(!only||only==='native')results.push(await writable({name:'native-oz',who:qa,tenant:'fa7f912f-6b62-463e-85cc-ffedab47ac44',contact:{full_name:'CSV Native 0238 Updated',email:'csv.native.0238@example.test'}}));
  if(!only||only==='active')results.push(await writable({name:'active-white-rabbit',who:{name:'alice',email:aliceCred.email,password:aliceCred.password},tenant:'c64b2666-7dd6-4c61-8ced-4b233f628e61',contact:{full_name:'CSV Active 0238 Short',email:'csv.active.0238@example.test'}}));
  if(!only||only==='terminated')results.push(await terminated());
  fs.writeFileSync(path.join(root,only?`summary-${only}.json`:'summary.json'),JSON.stringify(results.map(r=>({scenario:r.scenario,status:r.scenarioStatus,error:r.error,origin,build:r.build,durationSeconds:r.durationSeconds,assertions:r.assertions.map(a=>a.id)})),null,2));
  if(results.some(r=>r.scenarioStatus==='failed'))process.exitCode=1;
})();
