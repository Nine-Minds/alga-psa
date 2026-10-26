// Live re-run of the ended-customer tag-write journey on the admitted build, now including the
// contact CSV import tag writer, plus positive controls: active co-managed (alice) and native Oz (qa).
const {scenario,privateRoot,sql,until,reviewDist}=require('./runtime.cjs'),fs=require('fs'),path=require('path');
const root=path.dirname(__dirname);
const ended={tenant:'3261f313-8e04-45df-94bc-0343e92ba454',relationship:'ad0808b5-25df-4e95-987a-aa650c8ba24f',ticket:'0a767ca1-0f61-4817-a1af-e8d4183ff402',existingTag:'Barn network',
  contact:{full_name:'Dorothy Gale',email:'admin@kansasfarms.test',client_id:'75dda991-66ad-4ecd-8329-7f7dd9f75c25'}};
const manifest=JSON.parse(fs.readFileSync(`/home/robert/alga-copies/feature-co-managed-it/server/${reviewDist}/server/server-reference-manifest.json`,'utf8')).node;
const actionId=name=>{const hits=Object.entries(manifest).filter(([,v])=>v.exportedName===name&&/packages\/(tags|clients)\//.test(v.filename||''));if(hits.length!==1)throw Error(`action ${name}: ${hits.length} matches`);return hits[0][0]};
const json=q=>JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));
const tagRows=(tenant,extra='')=>json(`select m.mapping_id,m.tag_id,d.tag_text,m.tagged_id,m.tagged_type from tag_mappings m join tag_definitions d on d.tenant=m.tenant and d.tag_id=m.tag_id where m.tenant='${tenant}' ${extra} order by m.mapping_id`);
const definitions=(tenant,text)=>Number(sql(`select count(*) from tag_definitions where tenant='${tenant}' and tag_text='${text}'`));
const snapshot=tenant=>({tag_definitions:json(`select * from tag_definitions where tenant='${tenant}' order by tag_id`),tag_mappings:json(`select * from tag_mappings where tenant='${tenant}' order by mapping_id`),contacts:json(`select * from contacts where tenant='${tenant}' order by contact_name_id`)});
const relationship=()=>json(`select relationship_id,sponsor_tenant,state,ended_at,updated_at from co_management_relationships where tenant='${ended.tenant}' and relationship_id='${ended.relationship}'`)[0];
const layout=async(page,name)=>{await page.locator(`#ticket-layout-toggle-${name}`).click();await page.waitForTimeout(1500)};
const affordances=async page=>({addPopover:await page.locator('#tag-add-button').count(),addInline:await page.locator('[id$="-input-button"]').count(),remove:await page.locator('button[title="Remove tag"]').count()});
// Invoke a server action exactly as the client bundle does, with the signed-in browser session.
const callAction=(page,route,name,args)=>page.evaluate(async({route,id,args})=>{const r=await fetch(route,{method:'POST',headers:{'Next-Action':id,'Accept':'text/x-component','Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(args)});return {status:r.status,body:await r.text()}},{route,id:actionId(name),args}).then(r=>({action:name,actionId:actionId(name),args,...r}));
const readOnly='This co-managed workspace is read-only. Sign-in, reading, export, and license recovery remain available.';

async function terminated(){return scenario('terminated-customer',async({page,actor,go,check,shot,inspect,mark})=>{
  const cred=JSON.parse(fs.readFileSync(privateRoot+'/reprovision-20261025-departing-admin.json'));
  const relBefore=relationship();await check('relationship-terminated-before',relBefore.state==='terminated'&&relBefore.ended_at!==null,relBefore);
  const before=snapshot(ended.tenant);
  await check('ticket-has-existing-tag',tagRows(ended.tenant,`and m.tagged_id='${ended.ticket}' and d.tag_text='${ended.existingTag}'`).length===1,{tag:ended.existingTag});
  await actor({name:'terminated-customer-admin',email:cred.email,password:cred.password});
  await go('/msp/tickets/'+ended.ticket);
  for(const name of ['entry','grid']){
    await layout(page,name);await page.getByText(ended.existingTag).first().waitFor();
    const a=await affordances(page);await inspect(name+'-tags');await shot(name+'-tags');
    await check(`${name}-existing-tag-displayed`,true,{tag:ended.existingTag});
    await check(`${name}-no-tag-add-or-remove-control`,a.addPopover===0&&a.addInline===0&&a.remove===0,a);
  }
  await go('/msp/tickets');await page.waitForTimeout(1500);const list=await affordances(page);await inspect('ticket-list');await shot('ticket-list');
  await check('ticket-list-no-tag-mutation-controls',list.addPopover===0&&list.addInline===0&&list.remove===0,list);
  await go('/msp/contacts');await page.waitForTimeout(1500);await shot('contacts');
  const mapping=tagRows(ended.tenant,`and m.tagged_id='${ended.ticket}'`)[0];
  const writes=[];
  const route='/msp/contacts';
  writes.push(await callAction(page,route,'createTag',[{tag_text:'Direct write after departure',tagged_id:ended.ticket,tagged_type:'ticket'}]));
  writes.push(await callAction(page,route,'updateTagColor',[mapping.mapping_id,'#FF0000','#FFFFFF']));
  writes.push(await callAction(page,route,'updateTagText',[mapping.mapping_id,'Renamed after departure']));
  writes.push(await callAction(page,route,'deleteTag',[mapping.mapping_id]));
  writes.push(await callAction(page,route,'deleteAllTagsByText',[ended.existingTag,'ticket']));
  // Contact CSV import: an update-existing row with a tags column, and a new tagged row.
  writes.push(await callAction(page,route,'importContactsFromCSV',[[{...ended.contact,tags:'CSV after departure'}],true]));
  writes.push(await callAction(page,route,'importContactsFromCSV',[[{full_name:'CSV new after departure',email:'csv-new-after-departure@kansasfarms.test',client_id:ended.contact.client_id,tags:'CSV after departure'}],false]));
  fs.writeFileSync(path.join(root,'terminated-customer','direct-server-action-writes.json'),JSON.stringify(writes,null,2));
  for(const w of writes) await check(`direct-${w.action}-refused`,w.status===200&&w.body.includes(readOnly),{status:w.status,body:w.body.slice(0,400)});
  const after=snapshot(ended.tenant);const relAfter=relationship();
  fs.writeFileSync(path.join(root,'terminated-customer','db-receipt.json'),JSON.stringify({tenant:ended.tenant,relationshipBefore:relBefore,relationshipAfter:relAfter,
    countsBefore:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.length])),countsAfter:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.length])),identical:JSON.stringify(before)===JSON.stringify(after),before,after},null,2));
  await check('tag-and-contact-tables-unchanged',JSON.stringify(before)===JSON.stringify(after),{before:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.length]))});
  await check('relationship-still-terminated',JSON.stringify(relAfter)===JSON.stringify(relBefore),relAfter);
  return {status:'passed',limitations:[]};
});}

async function removeThroughProduct(page,text){
  await page.locator(`span[title="${text}"] button[title="Remove tag"]`).click();
  const del=page.getByRole('button',{name:'Remove & Delete Definition'});
  await del.waitFor({state:'visible',timeout:15000});await del.click();await del.waitFor({state:'hidden',timeout:15000});
}
async function writable({name,who,tenant,ticket,contact}){return scenario(name,async({page,actor,go,check,shot,inspect})=>{
  const tag='SMOKE csvtag control '+Date.now(),csvTag='SMOKE csvtag contact '+Date.now();
  await actor(who);await go('/msp/tickets/'+ticket);await layout(page,'entry');
  await page.locator('#tag-add-button').first().click();await shot('tag-picker');
  await page.locator('#tag-save-button').locator('..').locator('input').fill(tag);await page.locator('#tag-save-button').click();
  await until(()=>tagRows(tenant,`and d.tag_text='${tag}' and m.tagged_id='${ticket}'`).length===1,'mapping for '+tag);
  await page.reload();await page.locator('#ticket-layout-toggle-entry').waitFor();await page.getByText(tag).first().waitFor();
  const added=tagRows(tenant,`and d.tag_text='${tag}'`);await shot('after-add-reload');await inspect('after-add-reload');
  await check('tag-persisted',added.length===1,{added});
  await removeThroughProduct(page,tag);
  await until(()=>tagRows(tenant,`and d.tag_text='${tag}'`).length===0&&definitions(tenant,tag)===0,'cleanup of '+tag);
  await page.reload();await page.locator('#ticket-layout-toggle-entry').waitFor();await page.waitForTimeout(1500);await shot('after-remove-reload');
  await check('tag-removed-and-no-leftovers',await page.getByText(tag).count()===0,{});
  // Contact CSV import keeps writing tags (and does not wait on its own admission locks).
  const contactBefore=json(`select * from contacts where tenant='${tenant}' and email='${contact.email}'`)[0];
  const route='/msp/contacts';
  const set=await callAction(page,route,'importContactsFromCSV',[[{...contact,tags:csvTag}],true]);
  const withTag=tagRows(tenant,`and d.tag_text='${csvTag}' and m.tagged_type='contact'`);
  await check('csv-import-tag-persisted',set.status===200&&/"success":true/.test(set.body)&&withTag.length===1&&withTag[0].tagged_id===contactBefore.contact_name_id,{status:set.status,body:set.body.slice(0,300),withTag});
  const clear=await callAction(page,route,'importContactsFromCSV',[[{...contact,tags:''}],true]);
  const cleared=tagRows(tenant,`and d.tag_text='${csvTag}'`);
  await check('csv-import-tags-cleared',clear.status===200&&/"success":true/.test(clear.body)&&cleared.length===0,{status:clear.status,body:clear.body.slice(0,300)});
  const tidy=await callAction(page,route,'deleteAllTagsByText',[csvTag,'contact']);
  const contactAfter=json(`select * from contacts where tenant='${tenant}' and email='${contact.email}'`)[0];
  const same=['contact_name_id','full_name','email','client_id','is_inactive','role','notes'].every(k=>JSON.stringify(contactBefore[k])===JSON.stringify(contactAfter[k]));
  fs.writeFileSync(path.join(root,name,'db-receipt.json'),JSON.stringify({tenant,ticket,tag,added,afterRemoval:{mappings:tagRows(tenant,`and d.tag_text='${tag}'`),definitions:definitions(tenant,tag)},
    csv:{contact:contactBefore.contact_name_id,csvTag,set:{status:set.status,body:set.body},withTag,clear:{status:clear.status,body:clear.body},afterClear:cleared,tidy:{status:tidy.status,body:tidy.body},definitionsLeft:definitions(tenant,csvTag),contactFieldsUnchanged:same}},null,2));
  await check('csv-import-no-leftovers',definitions(tenant,csvTag)===0&&same,{definitionsLeft:definitions(tenant,csvTag),contactFieldsUnchanged:same});
  return {status:'passed',limitations:[]};
});}

(async()=>{
  const results=[];
  const only=process.env.ONLY;
  if(!only||only==='terminated')results.push(await terminated());
  const aliceCred=JSON.parse(fs.readFileSync(privateRoot+'/reprovision-20261025-active-admin.json'));
  if(!only||only==='active')results.push(await writable({name:'active-customer-control',who:{name:'alice',email:aliceCred.email,password:aliceCred.password},tenant:'c64b2666-7dd6-4c61-8ced-4b233f628e61',ticket:'cbe64b12-08a7-4b31-b9b9-01afe26094e5',
    contact:{full_name:'Alice Liddell',email:'alice@whiterabbit.test',client_id:'75e50fc5-b2bc-4d80-8ca2-67755cd82dea'}}));
  if(!only||only==='native')results.push(await writable({name:'native-oz-control',who:'qa',tenant:'fa7f912f-6b62-463e-85cc-ffedab47ac44',ticket:'14619f1e-dd21-4f7e-902f-32fb983766df',
    contact:{full_name:'Dorothy Gale',email:'dorothy@oz.com',client_id:'f2334ed4-1c31-4b4d-b771-80edb684b551'}}));
  fs.writeFileSync(path.join(root,only?`summary-${only}.json`:'summary.json'),JSON.stringify(results.map(r=>({scenario:r.scenario,status:r.scenarioStatus,error:r.error,build:{dist:reviewDist,...r.build},assertions:r.assertions.map(a=>a.id)})),null,2));
  if(results.some(r=>r.scenarioStatus==='failed'))process.exitCode=1;
})();
