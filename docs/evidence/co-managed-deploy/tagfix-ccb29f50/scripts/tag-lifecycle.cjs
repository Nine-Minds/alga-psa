// Live re-run of the departed-customer tag-write defect on the admitted build,
// plus positive controls: an active co-managed customer (Alice) and a native PSA tenant (QA).
const {scenario,privateRoot,sql,until}=require('./runtime.cjs'),fs=require('fs'),path=require('path');
const fx=require('/home/robert/alga-copies/feature-co-managed-it/docs/evidence/co-managed-deploy/implement-20261025/continuation-ef194916/runs/56e708a31b0c68e2c287863ddbe73adc2422b1e7/10-departure-b-content-56e7/fixtures.json');
const root=path.dirname(__dirname);
const tagRows=(tenant,extra='')=>JSON.parse(sql(`select coalesce(json_agg(x order by x.mapping_id),'[]') from (select m.mapping_id,m.tag_id,d.tag_text,m.tagged_id,m.created_by from tag_mappings m join tag_definitions d on d.tenant=m.tenant and d.tag_id=m.tag_id where m.tenant='${tenant}' ${extra}) x`));
const definitions=(tenant,text)=>Number(sql(`select count(*) from tag_definitions where tenant='${tenant}' and tag_text='${text}'`));
const layout=async(page,name)=>{await page.locator(`#ticket-layout-toggle-${name}`).click();await page.waitForTimeout(1500)};
const affordances=async page=>({
  addPopover:await page.locator('#tag-add-button').count(),
  addInline:await page.locator('[id$="-input-button"]').count(),
  remove:await page.locator('button[title="Remove tag"]').count(),
});

async function departed(){return scenario('01-departed-customer-tags-read-only',async({page,actor,go,check,shot,inspect})=>{
  const cred=JSON.parse(fs.readFileSync(privateRoot+'/'+fx.credentialFile));
  const state=sql(`select state from co_management_relationships where tenant='${fx.customer}' and relationship_id='${fx.relationship}'`);
  await check('relationship-terminated',state==='terminated',{relationship:fx.relationship,state});
  const before=tagRows(fx.customer);
  await actor({name:'departed-customer',email:cred.email,password:cred.password});
  await go('/msp/tickets/'+fx.ticket);
  for(const name of ['entry','grid']){
    await layout(page,name);
    await page.getByText('SMOKE ended tag 1792962099027').first().waitFor();
    const a=await affordances(page);await inspect(name+'-tags');await shot(name+'-tags');
    await check(`${name}-existing-tag-displayed`,true,{tag:'SMOKE ended tag 1792962099027'});
    await check(`${name}-no-tag-mutation-controls`,a.addPopover===0&&a.addInline===0&&a.remove===0,a);
  }
  await page.reload();await page.locator('#ticket-layout-toggle-entry').waitFor();await page.waitForTimeout(1500);
  // The ticket list: inline tags (when shown) carry no add, remove or edit control.
  await go('/msp/tickets');await page.getByText(fx.ticketTitle).first().waitFor();await page.waitForTimeout(1500);
  const list=await affordances(page);const listTagShown=await page.getByText('SMOKE ended tag 1792962099027').count();
  await inspect('ticket-list');await shot('ticket-list');
  await check('ticket-list-no-tag-mutation-controls',list.addPopover===0&&list.addInline===0&&list.remove===0,{...list,inlineTagShown:listTagShown>0});
  const after=tagRows(fx.customer);
  fs.writeFileSync(path.join(root,'01-departed-customer-tags-read-only','db-receipt.json'),JSON.stringify({tenant:fx.customer,relationship:fx.relationship,state,before,after},null,2));
  await check('db-unchanged',JSON.stringify(after)===JSON.stringify(before),{mappings:after.length});
  return {status:'passed',limitations:['Departed actor is the disposable departure fixture admin used by the original reproduction (tenant d46de2e8), not alice@whiterabbit.test, whose workspace is active.']};
});}

// Remove one tag through the ticket screen; the last use asks whether to keep the definition.
async function removeThroughProduct(page,text){
  await page.locator(`span[title="${text}"] button[title="Remove tag"]`).click();
  const deleteDefinition=page.getByRole('button',{name:'Remove & Delete Definition'});
  await deleteDefinition.waitFor({state:'visible',timeout:15000});await deleteDefinition.click();
  await deleteDefinition.waitFor({state:'hidden',timeout:15000});
}

async function writable({name,who,tenant,ticket}){return scenario(name,async({page,actor,go,check,shot,inspect,mark})=>{
  const tag='SMOKE tagfix '+Date.now();
  await actor(who);await go('/msp/tickets/'+ticket);await layout(page,'entry');
  // Tags left by an earlier interrupted attempt of this run are removed through the product first.
  for(const left of tagRows(tenant,`and d.tag_text like 'SMOKE tagfix %' and m.tagged_id='${ticket}'`)){
    await page.getByText(left.tag_text).first().waitFor();await removeThroughProduct(page,left.tag_text);
    await until(()=>tagRows(tenant,`and d.tag_text='${left.tag_text}'`).length===0&&definitions(tenant,left.tag_text)===0,'cleanup of earlier '+left.tag_text);
    await mark('removed earlier attempt tag',left);
  }
  await page.locator('#tag-add-button').first().click();await shot('tag-picker');
  await page.locator('#tag-save-button').locator('..').locator('input').fill(tag);await page.locator('#tag-save-button').click();
  await until(()=>tagRows(tenant,`and d.tag_text='${tag}' and m.tagged_id='${ticket}'`).length===1,'mapping for '+tag);
  await page.reload();await page.locator('#ticket-layout-toggle-entry').waitFor();await page.getByText(tag).first().waitFor();
  const added=tagRows(tenant,`and d.tag_text='${tag}'`);await shot('after-add-reload');await inspect('after-add-reload');
  await check('tag-persisted',added.length===1,{added});
  await removeThroughProduct(page,tag);
  await until(()=>tagRows(tenant,`and d.tag_text='${tag}'`).length===0&&definitions(tenant,tag)===0,'cleanup of '+tag);
  await page.reload();await page.locator('#ticket-layout-toggle-entry').waitFor();await page.waitForTimeout(1500);
  const visible=await page.getByText(tag).count();await shot('after-remove-reload');
  fs.writeFileSync(path.join(root,name,'db-receipt.json'),JSON.stringify({tenant,ticket,tag,added,afterRemoval:{mappings:tagRows(tenant,`and d.tag_text='${tag}'`),definitions:definitions(tenant,tag)}},null,2));
  await check('tag-removed-and-cleaned',visible===0,{visible});
  return {status:'passed',limitations:[]};
});}

(async()=>{
  const results=[];
  if(!process.env.SKIP_DEPARTED)results.push(await departed());
  if(!process.env.SKIP_WRITABLE)results.push(await writable({name:'02-active-customer-alice-tag-write',who:'alice',tenant:'1f98df77-cd15-44c2-8f4d-42ff52d01e84',ticket:'cfff4242-7962-4100-a54c-687eaa540500'}));
  if(!process.env.SKIP_WRITABLE)results.push(await writable({name:'03-native-psa-qa-tag-write',who:'qa',tenant:'24ac76c8-df59-4b10-8371-c56222904580',ticket:'68a51c93-2c2a-4bb6-be7e-5562d405a33d'}));
  fs.writeFileSync(path.join(root,process.env.SKIP_DEPARTED?'summary-writable-rerun.json':'summary.json'),JSON.stringify(results.map(r=>({scenario:r.scenario,status:r.scenarioStatus,error:r.error,build:r.build,assertions:r.assertions.map(a=>a.id)})),null,2));
  if(results.some(r=>r.scenarioStatus==='failed'))process.exitCode=1;
})();
