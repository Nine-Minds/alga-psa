// Guide 12 privacy probe on the admitted production build (deploy-fix task 1).
// Alice (White Rabbit IT admin) posts on the requester ticket 000016 where the smoke reproduced the leak
// (comment aa0fa6f0 saved requester-visible and mailed to the requester). Proves, in Entry and Grid:
//  - the default "Shared IT teams" note is stored shared_it / internal, has no requester delivery row and the
//    SMTP sink receives nothing for the requester;
//  - re-selecting the displayed "Shared IT teams" (the original probe's step) behaves the same;
//  - positive control: a "Requester and IT teams" reply is stored requester-visible and reaches the requester.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, sink, mailsTo, WR } = require('./common.cjs');
const root = process.env.CM_ROOT;
const T = '81245210-accc-40ad-afaa-6680a85a75b0', REQ = 'cm-review-20261026-12-b.requester@whiterabbit.test';
const stamp = Date.now();
const commentFor = (marker) => json(`select c.comment_id, c.is_internal, c.created_at, ct.thread_id, ct.collaboration_audience, ct.is_internal as thread_is_internal
  from comments c join comment_threads ct on ct.tenant=c.tenant and ct.thread_id=c.thread_id
  where c.tenant='${WR}' and c.ticket_id='${T}' and c.note like '%${marker}%'`)[0];
const deliveries = (commentId) => ({
  requester: json(`select delivery_key, recipient_kind, status from co_management_requester_email_deliveries where tenant='${WR}' and comment_id='${commentId}'`),
  native: json(`select recipient, state from ticket_comment_email_deliveries where tenant='${WR}' and comment_id='${commentId}'`),
});

async function post(page, prefix, marker, pickAudience) {
  const select = page.locator(`#${prefix}-audience-select`);
  if (pickAudience) { await select.click(); await page.getByRole('option', { name: pickAudience, exact: true }).click(); await page.waitForTimeout(600); }
  const shown = (await select.innerText()).trim();
  await page.locator('[contenteditable=true]').last().fill(marker);
  return shown;
}

(async () => {
  const r = await scenario(root, '12-privacy-probe', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const ticket = json(`select t.ticket_number, t.title, c.email from tickets t join contacts c on c.tenant=t.tenant and c.contact_name_id=t.contact_name_id where t.tenant='${WR}' and t.ticket_id='${T}'`)[0];
    await check('ticket-requester-is-the-probe-contact', ticket.email === REQ, ticket);
    const receipts = {};
    await actor(actors.alice());

    await chapter('Entry: the composer opens on "Shared IT teams" and Alice posts without touching it');
    await go('/msp/tickets/' + T); await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1500);
    await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();
    await page.locator('#ticket-details-conversation-audience-select').waitFor(); await page.waitForTimeout(1500);
    const m1 = `DEPLOYFIX-SHARED-IT-DEFAULT-NOT-FOR-REQUESTER ${stamp}`;
    const shown1 = await post(page, 'ticket-details-conversation', m1, null);
    await check('entry-default-audience-shown', shown1.includes('Shared IT teams'), { shown: shown1 });
    await shot('01-entry-default-before-post');
    await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(m1).first().waitFor();
    const c1 = await until(() => commentFor(m1), 'stored default comment');
    await check('entry-default-stored-shared-it-internal', c1.collaboration_audience === 'shared_it' && c1.is_internal === true && c1.thread_is_internal === true, c1);

    await chapter('Entry: re-selecting the displayed "Shared IT teams" (the original probe step) posts the same audience');
    await page.locator('#ticket-details-conversation-show-comment-editor-btn').click(); await page.waitForTimeout(1500);
    const m2 = `DEPLOYFIX-SHARED-IT-RESELECTED-NOT-FOR-REQUESTER ${stamp}`;
    const shown2 = await post(page, 'ticket-details-conversation', m2, 'Shared IT teams');
    await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(m2).first().waitFor();
    const c2 = await until(() => commentFor(m2), 'stored reselected comment');
    await check('entry-reselected-stored-shared-it-internal', shown2.includes('Shared IT teams') && c2.collaboration_audience === 'shared_it' && c2.is_internal === true, { shown: shown2, ...c2 });

    await chapter('Entry: a "Private to White Rabbit IT" note is stored organization-private');
    await page.locator('#ticket-details-conversation-show-comment-editor-btn').click(); await page.waitForTimeout(1500);
    const m5 = `DEPLOYFIX-PRIVATE-NOT-FOR-REQUESTER ${stamp}`;
    const shown5 = await post(page, 'ticket-details-conversation', m5, 'Private to White Rabbit IT');
    await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(m5).first().waitFor();
    const c5 = await until(() => commentFor(m5), 'stored private note');
    await check('entry-private-stored-organization-private', shown5.includes('Private') && c5.collaboration_audience === 'organization_private' && c5.is_internal === true, { shown: shown5, ...c5 });

    await chapter('Grid: the bento composer highlights "Shared IT teams" and posts it');
    await page.locator('#ticket-layout-toggle-grid').click(); await page.waitForTimeout(2000);
    await page.locator('#ticket-details-bento-timeline-tile-add-comment-btn').click(); await page.waitForTimeout(1500);
    const lane = page.locator('#ticket-details-bento-timeline-tile-composer-lane-shared_it');
    await check('grid-shared-it-lane-selected-by-default', (await lane.getAttribute('aria-pressed')) === 'true');
    const m3 = `DEPLOYFIX-SHARED-IT-GRID-NOT-FOR-REQUESTER ${stamp}`;
    await page.locator('[contenteditable=true]').last().fill(m3); await shot('02-grid-before-post');
    await page.locator('#ticket-details-bento-timeline-tile-composer-send').click(); await page.getByText(m3).first().waitFor();
    const c3 = await until(() => commentFor(m3), 'stored grid comment');
    await check('grid-stored-shared-it-internal', c3.collaboration_audience === 'shared_it' && c3.is_internal === true, c3);

    await chapter('Positive control: a "Requester and IT teams" reply is requester-visible and mailed to the requester');
    await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1500);
    await page.locator('#ticket-details-conversation-show-comment-editor-btn').click(); await page.waitForTimeout(1500);
    const m4 = `DEPLOYFIX-REQUESTER-REPLY-FOR-REQUESTER ${stamp}`;
    const shown4 = await post(page, 'ticket-details-conversation', m4, 'Requester and IT teams');
    await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(m4).first().waitFor();
    const c4 = await until(() => commentFor(m4), 'stored requester reply');
    await check('requester-reply-stored-requester-visible', shown4.includes('Requester') && c4.collaboration_audience === 'requester' && c4.is_internal === false, { shown: shown4, ...c4 });

    await chapter('Delivery: the requester receives only the requester reply (database rows and SMTP sink)');
    const mailFor = async (marker) => mailsTo(await sink(), REQ, marker).length;
    await until(async () => (await mailFor(m4)) > 0, 'requester mail for the requester reply', 180000);
    await until(() => deliveries(c4.comment_id).requester.some((d) => d.status === 'delivered'), 'requester delivery row delivered', 60000);
    for (const [id, c] of [['default', c1], ['reselected', c2], ['private', c5], ['grid', c3]]) {
      const d = deliveries(c.comment_id);
      receipts[id] = { comment: c, deliveries: d };
      await check(`${id}-no-requester-delivery-row`, d.requester.length === 0 && d.native.length === 0, d);
    }
    const mails = await sink();
    const leaked = [m1, m2, m5, m3].map((m) => ({ marker: m, toRequester: mailsTo(mails, REQ, m).length, anyRecipient: mails.filter((x) => (String(x.text) + String(x.html)).includes(m)).map((x) => x.to) }));
    await check('smtp-sink-nothing-for-requester-from-shared-it-notes', leaked.every((l) => l.toRequester === 0), leaked);
    receipts.requesterReply = { comment: c4, deliveries: deliveries(c4.comment_id), requesterMails: mailsTo(mails, REQ, m4).map((x) => ({ to: x.to, subject: x.subject, receivedAt: x.receivedAt })) };
    await check('requester-reply-reached-requester', receipts.requesterReply.requesterMails.length >= 1 && receipts.requesterReply.deliveries.requester.some((d) => d.status === 'delivered'), receipts.requesterReply);

    await chapter('Reload: the timeline keeps each note under its audience');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.getByText(m4).first().waitFor(); await page.waitForTimeout(1500);
    await shot('03-after-reload'); await inspect('03-after-reload');
    fs.writeFileSync(path.join(dir, 'db-smtp-receipt.json'), JSON.stringify({ ticket: { id: T, ...ticket }, markers: { m1, m2, m3, m4, m5 }, receipts, leakedToRequester: leaked }, null, 2));
    return { status: 'passed', limitations: ['Shared IT and private notes may still notify MSP/customer technicians; only requester delivery is asserted absent.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
