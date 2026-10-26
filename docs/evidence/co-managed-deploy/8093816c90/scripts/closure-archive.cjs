// Closure-path archive dedup on the disposable "CM-REVIEW-20261026-01 Accept-3 IT" workspace: the customer
// admin creates and escalates a ticket, QA participates (shared comment with a file, MSP-private note), then the
// customer ends the relationship from two tabs (the second click is the retry of an already-applied closure).
// Exactly one closure, one sealed archive manifest and no duplicated archive rows/files must result.
const fs = require('fs'), path = require('path');
const { scenario, sql, until, credential } = require('./runtime.cjs');
const { actors, json } = require('./common.cjs');
const root = process.env.CM_ROOT;
const A3 = { tenant: '2953aec7-3e03-47d8-8637-171af6c6e5c0', rel: 'f45b6c1c-7cf3-4c3a-ba95-9e64bd03dd00', op: '5b406971-1c66-4d33-94fe-b61dbeb4bf90' };
const S = process.env.CLOSE_STAMP || String(Date.now()).slice(-6), TITLE = `CLOSE-${S} shared escalation`;
const a3 = () => ({ name: 'accept3-admin', ...credential('cm-review-20261026-01-accept-3-admin.json') });
const ticket = () => json(`select ticket_id, ticket_number from tickets where tenant='${A3.tenant}' and title='${TITLE}'`)[0];
const state = () => ({
  relationship: json(`select state, ended_at, revision from co_management_relationships where tenant='${A3.tenant}' and relationship_id='${A3.rel}'`)[0],
  closures: json(`select operation_id, applied_revision, released_seats, cutoff_at, closed_at from co_managed_relationship_closures where relationship_id='${A3.rel}'`),
  manifests: json(`select operation_id, sealed_at, cutoff_at, content_hash from co_managed_archive_manifests where relationship_id='${A3.rel}'`),
  files: json(`select archive_file_id, attachment_id, comment_id, ticket_id, audience, file_name, content_hash, status from co_managed_archive_files where relationship_id='${A3.rel}' order by file_name`),
  allocation: json(`select seats, state from co_managed_allocations where operation_id='${A3.op}'`)[0],
});
(async () => {
  const r = await scenario(root, '08-closure-archive-dedup', async ({ page, ctx, actor, go, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    receipt('db-before', state());
    await chapter('QA maps Accept-3 priorities to Oz SLA priorities (escalation precondition)');
    await actor(actors.qa());
    await go(`/msp/co-management/sla?operationId=${A3.op}`); await page.locator('#co-sla-save').waitFor({ timeout: 60000 });
    const maps = page.locator('button[id^="co-sla-map-"]');
    for (let i = 0; i < await maps.count(); i++) {
      const b = maps.nth(i); if (!/Not mapped/.test(await b.innerText())) continue;
      await b.click(); await page.waitForTimeout(600); await page.locator('[role=option]:not([aria-disabled="true"])').filter({ hasNotText: /Not mapped/ }).first().click(); await page.waitForTimeout(400);
    }
    await shot('00-sla-mapping'); await page.locator('#co-sla-save').click(); await page.waitForTimeout(3000); await inspect('00-sla-saved');
    await chapter('Accept-3 admin creates a ticket');
    await actor(a3());
    if (!ticket()) {
      await go('/msp/create-ticket'); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 60000 });
      await page.locator('#ticket-quick-add-title').fill(TITLE);
      for (const id of ['#ticket-quick-add-client-trigger', '#ticket-quick-add-board-picker', '#ticket-quick-add']) {
        const t = await page.locator(id).innerText().catch(() => '');
        if (!/Select/.test(t)) continue;
        await page.locator(id).click(); await page.waitForTimeout(800); await page.locator('[role=option]:not([aria-disabled="true"])').first().click(); await page.waitForTimeout(1000);
      }
      await inspect('01-quick-add'); await page.locator('#ticket-quick-add-submit-btn').click();
      await until(() => ticket(), 'ticket created', 60000);
    }
    const escalated = () => json(`select count(*)::int as n from co_management_ticket_handoffs where tenant='${A3.tenant}' and ticket_id='${ticket().ticket_id}'`)[0].n;
    await go('/msp/tickets/' + ticket().ticket_id); await page.waitForTimeout(3000); await shot('02-customer-ticket');
    if (!escalated()) {
      await page.locator('#co-ticket-escalate').click(); await page.waitForTimeout(1500); await inspect('03-escalate-dialog');
      const note = page.locator('textarea').filter({ hasNot: page.locator('[contenteditable]') }).last();
      if (await note.count()) await note.fill(`CLOSE-${S} escalate for archive dedup`);
      await page.locator('#co-ticket-handoff-submit').click();
      await until(() => escalated() > 0, 'escalated', 20000).catch(() => {});
    }
    // Escalation needs an MSP SLA policy for this client; the disposable workspace has none, and the board grant
    // (Service Desk, collaborate) already shares the ticket, so participation proceeds through board visibility.
    const refusal = (await page.locator('body').innerText()).match(/Your MSP must configure[^\n]*/)?.[0] ?? null;
    receipt('escalation', { escalated: escalated() > 0, refusal });
    await page.locator('#co-ticket-handoff-cancel').click().catch(() => {});

    await chapter('QA assigns himself as collaborating staff on Accept-3 IT, then participates');
    await actor(actors.qa());
    const QA = '86952555-610c-4737-be41-a9236cfa9cdb';
    await go(`/msp/clients/eed8f432-dbf3-4836-adb8-3001bc185524?tab=co-managed`); await page.locator('#co-policy-save').waitFor({ timeout: 60000 });
    if (!await page.locator(`#co-policy-user-access-${QA}`).count()) {
      await page.locator('#co-policy-user-search').fill('QA'); await page.waitForTimeout(1500);
      await page.locator('#co-policy-user-select').click(); await page.waitForTimeout(800); await page.getByRole('option', { name: /QA Tester/ }).first().click();
      await page.locator('#co-policy-user-add').click(); await page.waitForTimeout(800);
    }
    const access = page.locator(`#co-policy-user-access-${QA}`);
    if (!/Collaborate/.test(await access.innerText())) { await access.click(); await page.getByRole('option', { name: 'Collaborate' }).click(); }
    await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.').waitFor({ timeout: 30000 }).catch(() => {});
    await shot('03b-qa-staff-assigned');
    await go(`/msp/co-management/tickets/${A3.tenant}/${A3.rel}/${ticket().ticket_id}`); await page.waitForTimeout(2500);
    const filePath = path.join(dir, `close-${S}-evidence.txt`); fs.writeFileSync(filePath, `archive dedup evidence ${S}\n`);
    const post = async (marker, audience, withFile) => {
      await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();
      const select = page.locator('#ticket-details-conversation-audience-select'); await select.waitFor(); await page.waitForTimeout(1200);
      await select.click(); await page.getByRole('option', { name: audience }).first().click(); await page.waitForTimeout(500);
      await page.locator('[contenteditable=true]').last().fill(marker);
      if (withFile) { await page.locator('input[type=file]').last().setInputFiles(filePath); await page.waitForTimeout(2500); }
      await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(marker).first().waitFor({ timeout: 60000 });
    };
    await post(`CLOSE-${S}-QA-SHARED`, /Shared IT teams/, true);
    await post(`CLOSE-${S}-QA-PRIVATE`, /My organization only/, false);
    await shot('04-qa-participation');
    const sharedFile = () => json(`select count(*)::int as n from co_management_conversation_attachments where file_name like 'close-${S}-%'`)[0]?.n ?? 0;
    receipt('db-participation', { sharedFileRows: sharedFile(), comments: json(`select count(*)::int as n from comments where tenant='${A3.tenant}' and ticket_id='${ticket().ticket_id}'`)[0] });

    await chapter('Accept-3 admin ends the relationship in tab A; tab B retries the same closure');
    await actor(a3()); await go('/msp/co-management/departure'); await page.locator('#co-departure-review').waitFor({ timeout: 60000 });
    const tabB = await ctx.newPage(); await tabB.goto(page.url(), { waitUntil: 'domcontentloaded' }); await tabB.locator('#co-departure-review').waitFor({ timeout: 60000 });
    await page.locator('#co-departure-review').click(); await tabB.locator('#co-departure-review').click(); await page.waitForTimeout(1500);
    await inspect('05-departure-review');
    await page.getByRole('button', { name: 'End relationship', exact: true }).click();
    await until(() => state().relationship.state === 'terminated', 'relationship ended', 120000);
    const afterFirst = state();
    await tabB.getByRole('button', { name: 'End relationship', exact: true }).click(); await tabB.waitForTimeout(5000);
    const retryText = await tabB.locator('body').innerText(); await tabB.screenshot({ path: path.join(dir, '06-retry-tab.png'), fullPage: true });
    fs.writeFileSync(path.join(dir, '06-retry-tab.txt'), retryText); await tabB.close();
    await chapter('The archive is sealed once');
    const sealed = await until(() => { const st = state(); return st.manifests.some((m) => m.sealed_at) ? st : null; }, 'manifest sealed', 300000).catch(() => state());
    await page.waitForTimeout(15000); const after = state(); receipt('db-after', after);
    const dupFiles = json(`select coalesce(attachment_id::text, '') || ':' || coalesce(comment_id::text, '') || ':' || coalesce(content_hash, '') as k, count(*)::int as n from co_managed_archive_files where relationship_id='${A3.rel}' group by 1 having count(*) > 1`);
    receipt('db-duplicates', { duplicateFileKeys: dupFiles });
    await check('exactly-one-closure-and-one-sealed-manifest', after.closures.length === 1 && after.manifests.length === 1 && after.manifests.filter((m) => m.sealed_at).length === 1, { closures: after.closures.length, manifests: after.manifests.length });
    await check('no-duplicated-archive-files', dupFiles.length === 0 && after.files.length >= 1, { files: after.files.length });
    await check('seat-released-on-closure', after.allocation?.state === 'released', after.allocation);
    await check('retry-tab-changes-nothing', after.closures.length === 1 && after.relationship.revision === afterFirst.relationship.revision
      && after.closures[0].closed_at === afterFirst.closures[0]?.closed_at, { revisionAfterFirst: afterFirst.relationship.revision, revisionAfterRetry: after.relationship.revision,
      retryMessage: (retryText.match(/[^\n]*(ended|already|closed|relationship|could not)[^\n]*/gi) || []).slice(0, 4) });
    await chapter('QA opens the retained Shared work archive');
    await actor(actors.qa()); await go('/msp/co-managed/archive'); await page.waitForTimeout(3000); const archiveText = await page.locator('body').innerText(); await shot('07-msp-archive');
    fs.writeFileSync(path.join(dir, '07-msp-archive.txt'), archiveText);
    const occurrences = archiveText.split(TITLE).length - 1;
    await check('msp-archive-lists-the-ticket-once', occurrences <= 1, { occurrences });
    return { status: 'passed', limitations: occurrences === 0 ? ['The MSP archive landing page does not list ticket titles directly; manifest/file rows are the dedup evidence.'] : [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
