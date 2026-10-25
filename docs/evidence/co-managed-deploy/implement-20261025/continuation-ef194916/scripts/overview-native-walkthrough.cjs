// Overview: full native edit / assignment / category / field-privacy tour on the
// shared White Rabbit ticket, from both organizations and the read-only viewer,
// restoring the ticket's original values at the end.
const {scenario,ids,shared,sql,until}=require('./runtime.cjs'),fs=require('fs');
const C=ids.customer,T=ids.ticket;
const row=()=>JSON.parse(sql(`select row_to_json(t) from (select title,status_id,priority_id,category_id,assigned_to,board_id from tickets where tenant='${C}' and ticket_id='${T}') t`));
const name=(table,col,idcol,id)=>id?sql(`select ${col} from ${table} where tenant='${C}' and ${idcol}='${id}'`):null;
const mspAssignee=()=>sql(`select coalesce(json_agg(a),'[]') from (select * from co_management_ticket_assignments where tenant='${C}' and ticket_id='${T}') a`);
(async()=>{const r=await scenario(process.env.CM_SCENARIO||'00-overview-native-walkthrough',async({page,actor,go,check,mark,shot,inspect,dir})=>{
  const stamp=Date.now(),category='CM overview category '+stamp,before=row();
  const baseline={...before,status:name('statuses','name','status_id',before.status_id),priority:name('priorities','priority_name','priority_id',before.priority_id),category:name('categories','category_name','category_id',before.category_id),board:name('boards','board_name','board_id',before.board_id)};
  fs.writeFileSync(dir+'/baseline.json',JSON.stringify(baseline,null,2));await mark('baseline',baseline);
  const combo=label=>page.getByRole('combobox').filter({hasText:new RegExp('^\\s*'+label+'\\s*$')}).filter({visible:true}).first();
  const pick=async(current,next)=>{await until(async()=>await combo(current).isEnabled().catch(()=>false),current+' picker ready',30000);await combo(current).click();await page.getByRole('option',{name:next,exact:true}).click()};
  const categoryBox=()=>page.locator('[data-automation-id$="-category-picker"], [data-automation-id$="-category-select"]').filter({visible:true}).getByRole('combobox').first();
  const pickCategory=async next=>{await categoryBox().click();await page.getByText(next,{exact:true}).filter({visible:true}).last().click();await page.keyboard.press('Escape').catch(()=>{})};
  const settle=Number(process.env.CM_LAYOUT_SETTLE_MS||0);
  const entry=async who=>{await go(who==='alice'?'/msp/tickets/'+T:shared);if(settle)await page.waitForTimeout(settle);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(800);await page.locator('#ticket-details-info-save-changes-btn').or(page.locator('#ticket-details-info')).filter({visible:true}).first().waitFor()};
  const save=async()=>{await page.locator('#ticket-details-info-save-changes-btn').click()};

  // 1. Customer administrator adds a category through native settings.
  await actor('alice');await go('/msp/settings?tab=ticketing&section=categories');
  await page.locator('#add-category-button').click();await page.locator('#quick-add-category-name').fill(category);
  const boardSelect=page.getByRole('dialog').getByRole('combobox').filter({hasText:/Select a board/}).first();await boardSelect.click();await page.getByRole('option',{name:baseline.board,exact:true}).click();
  await shot('01-customer-adds-category');await page.locator('#quick-add-category-submit').click();
  const categoryId=await until(()=>sql(`select category_id from categories where tenant='${C}' and category_name='${category}' and board_id='${before.board_id}'`),'category saved');
  await check('customer-admin-creates-board-category-natively',!!categoryId,{categoryId,board:baseline.board});

  // 2. MSP technician edits shared fields on the native ticket screen.
  await actor('qa');await entry('qa');
  await pick(baseline.status,'In Progress');await pick(baseline.priority,'Medium');await pickCategory(category);
  await shot('02-msp-edits-before-save');await save();
  await until(()=>{const x=row();return x.status_id!==before.status_id&&x.priority_id!==before.priority_id&&x.category_id===categoryId},'MSP edits persisted to the customer ticket');
  await page.reload();await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(800);
  const after=row();
  await check('msp-status-priority-category-persist-on-customer-ticket',name('statuses','name','status_id',after.status_id)==='In Progress'&&name('priorities','priority_name','priority_id',after.priority_id)==='Medium'&&after.category_id===categoryId,{after});
  await check('msp-edits-render-after-reload',await combo('In Progress').count()===1&&await combo('Medium').count()===1&&(await categoryBox().innerText()).includes(category));
  await shot('03-msp-edits-after-reload');

  // 3. MSP assignment through the Co-managed section.
  await page.locator('#co-ticket-assignment-change').click();await page.locator('#co-ticket-assignment-cancel').waitFor();
  await page.locator('#co-ticket-assignment-person').click();await page.getByRole('option',{name:/^QA Tester/}).first().click();
  await page.locator('#co-ticket-assignment-save').click();await page.locator('#co-ticket-assignment-cancel').waitFor({state:'detached'});
  await until(async()=>(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'),'MSP assignment shown');
  await page.reload();await page.locator('#co-ticket-assignment-value').waitFor();
  await check('msp-assignment-persists-after-reload',(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'));
  await shot('04-msp-assignment');

  // 4. Field boundaries and privacy for the MSP.
  await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(800);
  const disabled=async id=>{const l=page.locator('#'+id).filter({visible:true}).first();return (await l.count())>0&&await l.isDisabled()};
  await check('customer-owned-assignee-board-contact-client-are-read-only-for-msp',await page.locator('#user-and-team-picker-trigger').isDisabled()&&await combo(baseline.board).isDisabled()&&await disabled('ticket-details-properties-toggle-contact-picker-btn')&&await disabled('ticket-details-properties-show-client-picker-btn'));
  const customerOnly=['ticket-details-delete-ticket-button','ticket-details-duplicate-ticket-button','ticket-details-quick-invoice-button','ticket-materials-card','ticket-details-documents-section','credentials-screen-new','ticket-details-properties-watch-list-toggle','ticket-details-checklist-section-toggle','co-ticket-revoke'];
  const present=[];for(const id of customerOnly)if(await page.locator('#'+id).count())present.push(id);
  await check('customer-only-actions-and-sections-are-absent-for-msp',present.length===0,{checked:customerOnly,present});
  await shot('05-msp-field-boundaries');
  // Grid shows the same values and the same boundaries.
  await page.getByRole('button',{name:'Grid',exact:true}).click();await page.waitForTimeout(1500);
  const gridText=await page.locator('main').innerText();
  await check('grid-shows-same-edited-values',gridText.includes('In Progress')&&gridText.includes('Medium')&&gridText.includes(category));
  const gridPickers=page.locator('#user-and-team-picker-trigger').filter({visible:true});let enabledPickers=0;for(let i=0;i<await gridPickers.count();i++)if(await gridPickers.nth(i).isEnabled())enabledPickers++;
  await check('grid-keeps-customer-owned-assignee-read-only',enabledPickers===0&&/ASSIGNED TO/i.test(gridText),{visiblePickers:await gridPickers.count(),enabledPickers});
  await shot('06-msp-grid');

  // 5. Customer sees the MSP's edits, assigns natively and writes privately.
  await actor('alice');await entry('alice');
  const aliceText=await page.locator('main').innerText();
  await check('customer-native-ticket-shows-msp-edits-and-assignment',aliceText.includes('In Progress')&&aliceText.includes('Medium')&&aliceText.includes(category)&&(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'));
  const alice=sql(`select user_id from users where tenant='${C}' and email='alice@whiterabbit.test'`);
  await page.locator('#user-and-team-picker-trigger').click();await page.locator('[data-automation-id$="-option-'+alice+'"]').filter({visible:true}).first().click();await page.keyboard.press('Escape').catch(()=>{});
  await save();
  await until(()=>row().assigned_to===alice,'customer assignee saved');
  await check('customer-assigns-its-own-technician-natively',row().assigned_to===alice);
  const privateNote='CM overview customer-private '+stamp;
  await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();await page.locator('#ticket-details-conversation-audience-select').click();await page.getByRole('option',{name:/Private to/}).click();
  await page.locator('[contenteditable=true]').last().fill(privateNote);await page.locator('#ticket-details-conversation-add-comment-btn').click();
  await page.getByText(privateNote,{exact:true}).first().waitFor();
  await shot('07-customer-assigns-and-writes-privately');

  // 6. MSP sees the customer assignee but not the private note; viewer is read-only.
  await actor('qa');await entry('qa');
  const qaText=await page.locator('main').innerText();
  await check('msp-sees-customer-assignee',(await page.locator('#user-and-team-picker-trigger').innerText()).includes('Alice'));
  await check('msp-cannot-see-customer-private-note',!qaText.includes(privateNote));
  await actor('viewer');await go(shared);await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(1000);
  await check('viewer-sees-values-with-every-field-read-only',await combo('In Progress').isDisabled()&&await combo('Medium').isDisabled()&&await categoryBox().isDisabled()&&await page.locator('#ticket-details-info-save-changes-btn').count()===0&&!(await page.locator('main').innerText()).includes(privateNote));
  await shot('08-viewer-read-only');

  // 7. Restore the review fixture.
  await actor('alice');await entry('alice');
  await page.locator('#user-and-team-picker-trigger').click();await page.locator('[data-automation-id$="-option-unassigned"]').filter({visible:true}).first().click();
  await page.keyboard.press('Escape').catch(()=>{});await save();
  await until(()=>row().assigned_to===null,'customer assignee cleared');
  await actor('qa');await entry('qa');
  await pick('In Progress',baseline.status);await pick('Medium',baseline.priority);await pickCategory(baseline.category);await save();
  await until(()=>{const x=row();return x.status_id===before.status_id&&x.priority_id===before.priority_id&&x.category_id===before.category_id},'fields restored');
  await page.reload();await page.locator('#co-ticket-assignment-value').waitFor();await page.waitForTimeout(1500);
  await page.locator('#co-ticket-assignment-change').click();await until(async()=>await page.locator('#co-ticket-assignment-clear').isEnabled().catch(()=>false),'clear enabled');await page.locator('#co-ticket-assignment-clear').click();await page.locator('#co-ticket-assignment-cancel').waitFor({state:'detached'});
  await page.reload();await page.locator('#co-ticket-assignment-value').waitFor();
  const restored=row();
  await check('review-ticket-restored',restored.status_id===before.status_id&&restored.priority_id===before.priority_id&&restored.category_id===before.category_id&&restored.assigned_to===before.assigned_to&&!(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'),{restored});
  await shot('09-restored');
  fs.writeFileSync(dir+'/receipt.json',JSON.stringify({ticket:T,customer:C,categoryCreated:{categoryId,category},baseline,restored,privateNote},null,2));
  return {status:'passed',limitations:[]};
});if(r.scenarioStatus==='failed')process.exitCode=1;})();
