// Reproduction probe: does a "Shared IT teams" comment on a requester ticket reach the requester mailbox?
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors } = require('../../09-time-and-billing/scripts/common.cjs');
const T = '81245210-accc-40ad-afaa-6680a85a75b0', REQ = 'cm-review-20261026-12-b.requester@whiterabbit.test';
const TEXT = 'CM-REVIEW-20261026-12-b probe shared-IT audience ' + Date.now();
const sink = async () => (await (await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result || [];
(async () => { await scenario(__dirname + '/..', 'probe-shared-audience-mail', async ({ page, actor, go, mark, check, shot, inspect }) => {
  await actor(actors.alice()); await go('/msp/tickets/' + T); await page.locator('#ticket-details-conversation-show-comment-editor-btn').click(); await page.waitForTimeout(1200);
  const sel = page.locator('#ticket-details-conversation-audience-select');
  await sel.click(); await page.getByRole('option', { name: 'Shared IT teams', exact: true }).click(); await page.waitForTimeout(600);
  const shown = await sel.innerText(); await mark('audience-shown-before-post', { shown });
  await page.locator('[contenteditable=true]').last().fill(TEXT); await shot('01-before-post'); await inspect('01-before-post');
  await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(TEXT).first().waitFor();
  const row = await until(() => sql(`select row_to_json(c) from (select comment_id,is_internal from comments where ticket_id='${T}' and note like '%probe shared-IT audience%' order by created_at desc limit 1) c`), 'comment row');
  await page.waitForTimeout(20000);
  const mails = (await sink()).filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(REQ) && (String(m.text) + String(m.html)).includes(TEXT));
  await mark('result', { shown, comment: JSON.parse(row), requesterMailsWithText: mails.length, deliveryRows: sql(`select count(*) from co_management_requester_email_deliveries where comment_id='${JSON.parse(row).comment_id}'`) });
  await page.reload(); await page.getByText(TEXT).first().waitFor(); await shot('02-after-reload'); await inspect('02-after-reload');
  return { status: mails.length ? 'defect-reproduced' : 'not-reproduced' };
}); })();
