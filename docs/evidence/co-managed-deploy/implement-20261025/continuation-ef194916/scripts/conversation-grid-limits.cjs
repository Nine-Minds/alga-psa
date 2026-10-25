// Guide 07 supplement: Grid enforces the same audience rules as Entry, and
// unsupported file count/size/audience is reported before any publication.
const {scenario,ids,sql,until}=require('./runtime.cjs'),fs=require('fs');
const f=require('../'+(process.env.CM_AUDIENCE_FIXTURE||'07-ticket-audiences-files-c1f6')+'/fixtures.json');
const route='/msp/co-management/tickets/'+ids.customer+'/'+ids.relationship+'/'+f.ticketId;
const msg=k=>f.messages.find(m=>m.key===k).text;
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'07-grid-parity-and-file-limits-c1f6',async({page,actor,go,check,mark,shot,inspect})=>{
  async function grid(who){await actor(who);await go(who==='alice'?'/msp/tickets/'+f.ticketId:route);
    await page.getByRole('button',{name:'Grid',exact:true}).click();await page.waitForTimeout(1500);
    await page.getByText(msg('requester'),{exact:true}).first().waitFor();return page.locator('body').innerText()}
  let body=await grid('qa');
  await check('QA-Grid-shows-requester-and-MSP-private',body.includes(msg('requester'))&&body.includes(msg('msp-private')));
  await check('QA-Grid-hides-customer-private',!body.includes(msg('customer-private')));
  await shot('qa-grid-audiences');
  body=await grid('alice');
  await check('Alice-Grid-shows-requester-and-customer-private',body.includes(msg('requester'))&&body.includes(msg('customer-private')));
  await check('Alice-Grid-hides-MSP-private',!body.includes(msg('msp-private')));
  await shot('alice-grid-audiences');
  // File limits, Entry composer as QA.
  await actor('qa');await go(route);await page.getByRole('button',{name:'Entry',exact:true}).click();
  const open=page.locator('#ticket-details-conversation-show-comment-editor-btn'),send=page.locator('#ticket-details-conversation-add-comment-btn');
  await open.click();await send.waitFor();
  await page.locator('#ticket-details-conversation-audience-select').click();await page.getByRole('option',{name:'Shared IT teams',exact:true}).click();
  const help=await page.locator('#co-shared-comment-files-help').innerText();await mark('limits-help',{help});
  const text='CM limits probe '+Date.now();await page.locator('[contenteditable=true]').last().fill(text);
  const many=Array.from({length:21},(_,i)=>({name:`cm-limit-${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('x'+i)}));
  await page.locator('#co-shared-comment-files').setInputFiles(many);
  const alert=page.locator('#co-shared-comment-files').locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]').getByRole('alert');
  await alert.waitFor();
  await check('twenty-one-files-reported-before-publication',(await alert.innerText()).length>0,{help,alert:await alert.innerText()});
  await shot('too-many-files-reported');
  await send.click();await page.waitForTimeout(2500);
  const stored=()=>Number(sql(`select count(*) from comments where tenant='${ids.customer}' and ticket_id='${f.ticketId}' and note::text like '%${text}%'`));
  await check('over-limit-send-persists-nothing-and-keeps-draft',stored()===0&&await send.isVisible()&&(await page.locator('[contenteditable=true]').last().innerText()).includes(text),{stored:stored()});
  await page.locator('[id^="co-shared-comment-file-remove-"]').first().click();
  await until(async()=>await alert.count()===0,'alert clears at the limit');
  await check('removing-one-file-clears-the-count-error',await page.locator('[id^="co-shared-comment-file-remove-"]').count()===20);
  while(await page.locator('[id^="co-shared-comment-file-remove-"]').count())await page.locator('[id^="co-shared-comment-file-remove-"]').first().click();
  await page.locator('#co-shared-comment-files').setInputFiles({name:'cm-limit-oversize.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(20*1048576,1)});
  await alert.waitFor();
  await check('oversize-file-reported-before-publication',true,{alert:await alert.innerText()});
  await shot('oversize-file-reported');
  await page.locator('[id^="co-shared-comment-file-remove-"]').first().click();
  await until(async()=>await alert.count()===0,'alert clears after removal');
  // Audience probe with one valid staged file.
  await page.locator('#co-shared-comment-files').setInputFiles({name:'cm-limit-audience.txt',mimeType:'text/plain',buffer:Buffer.from('a')});
  await page.locator('#ticket-details-conversation-audience-select').click();
  const options=(await page.locator('[role="option"]:not([aria-disabled="true"])').filter({visible:true}).allInnerTexts()).map(x=>x.trim()).filter(Boolean);await page.keyboard.press('Escape');
  const audiences={};
  for(const name of options){await page.locator('#ticket-details-conversation-audience-select').click();await page.getByRole('option',{name,exact:true}).click();await page.waitForTimeout(400);
    audiences[name]={pickerOffered:await page.locator('#co-shared-comment-files').count()===1,unavailableAlert:await page.getByText(/cannot|not available|unavailable/i).filter({has:page.locator('xpath=self::*[@role="alert"]')}).count()}}
  await check('every-offered-audience-states-attachment-availability',Object.values(audiences).every(a=>a.pickerOffered||a.unavailableAlert>0),{audiences});
  await page.locator('#ticket-details-conversation-cancel-btn, button:has-text("Cancel")').last().click().catch(()=>{});
  await page.waitForTimeout(1000);
  const discard=page.getByRole('button',{name:/Discard/i});if(await discard.count())await discard.first().click();
  await check('probe-left-no-message',stored()===0);
  await shot('probe-cancelled');
  return {status:'passed',limitations:[]};
});if(r.scenarioStatus==='failed')process.exitCode=1;})();
