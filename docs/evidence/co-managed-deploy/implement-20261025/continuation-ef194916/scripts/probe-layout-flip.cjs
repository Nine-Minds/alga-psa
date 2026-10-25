const {scenario,ids,sql}=require('./runtime.cjs');const f=require('../07-ticket-audiences-files-c1f6/fixtures.json');
const route='/msp/co-management/tickets/'+ids.customer+'/'+ids.relationship+'/'+f.ticketId;
(async()=>{await scenario('probe-layout-flip-c1f6',async({page,actor,go,mark,shot})=>{
 await actor('qa');await go(route);
 const state=async l=>mark(l,{grid:await page.locator('#ticket-layout-toggle-grid').getAttribute('aria-pressed'),entry:await page.locator('#ticket-layout-toggle-entry').getAttribute('aria-pressed'),composer:await page.locator('#ticket-details-conversation-add-comment-btn').count(),bento:await page.locator('[id^="ticket-details-bento"]').count(),url:page.url()});
 await state('loaded');
 await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(800);await state('entry-clicked');
 await page.reload();await page.waitForTimeout(2500);await state('after-reload');
 await page.getByRole('button',{name:'Entry',exact:true}).click();await page.waitForTimeout(800);
 await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();
 await page.locator('[contenteditable=true]').last().fill('CM flip probe');
 for(const n of [1,2,3]){await page.waitForTimeout(3000);await state('idle-'+n)}
 await page.locator('#co-shared-comment-files').setInputFiles(Array.from({length:21},(_,i)=>({name:`p${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('p')})));
 await state('staged');
 await page.locator('#ticket-details-conversation-add-comment-btn').click();
 for(const n of [1,2,3,4]){await page.waitForTimeout(700);await state('after-send-'+n)}
 await shot('after-send');
 return {status:'partial',limitations:['diagnostic probe']};
});})();
