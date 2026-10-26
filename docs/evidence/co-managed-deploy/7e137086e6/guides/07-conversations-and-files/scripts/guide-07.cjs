// Guide 07 — Conversations and files. White Rabbit IT (Alice) + Oz MSP (QA) + a White Rabbit
// client-portal requester created through the customer's native Users screen.
// Disposable records use CM-REVIEW-20261026-07. sql() is read-only (receipts/waits only).
const L = require('../../06-projects-and-tasks/scripts/lib.cjs'), path = require('path'), crypto = require('crypto');
const { sql, until, origin, ids, json, esc, fs, privateRoot, build } = L;
const guideDir = path.dirname(__dirname);
const root = process.env.CM_ATTEMPT ? path.join(guideDir, 'attempts') : guideDir;
const name = process.env.CM_SCENARIO || 'recording';
const SFX = 'CM-REVIEW-20261026-07';
const C = ids.customer, R = ids.relationship;
const credFile = privateRoot + '/cm-review-20261026-07-requester.json';
const fixFile = path.join(guideDir, 'fixtures.json');
const fixture = fs.existsSync(fixFile) ? JSON.parse(fs.readFileSync(fixFile, 'utf8')) : {};
const saveFix = (u) => { Object.assign(fixture, u); fs.writeFileSync(fixFile, JSON.stringify(fixture, null, 2)); };
const receipts = {};
const receipt = (k, v) => { receipts[k] = v; fs.writeFileSync(path.join(guideDir, 'db-receipts.json'), JSON.stringify(receipts, null, 2)); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ONLY = process.env.CM_ONLY ? process.env.CM_ONLY.split(',') : null;
const want = (s) => !ONLY || ONLY.includes(s);

(async () => {
  const r = await L.scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, states, dir }) => {
    const opt = (n) => page.getByRole('option', { name: n, exact: true });
    const stamp = Date.now();
    const vis = (t) => page.getByText(t, { exact: true }).filter({ visible: true }).first();
    let who = null;
    async function as(w) {
      who = w;
      if (w === 'requester') {
        const c = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        await page.goto('about:blank'); await ctx.clearCookies();
        await page.goto(`${origin}/auth/client-portal/signin?tenant=${L.portalSlug(C)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => { const b = document.querySelector('#client-sign-in-button'); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, null, { timeout: 90000 });
        await page.locator('#client-email-field').fill(c.email); await page.waitForTimeout(800);
        await page.locator('#client-password-field').fill(c.password); await page.locator('#client-sign-in-button').click();
        const s = await until(async () => { const s = await ctx.request.get(origin + '/api/auth/session').then((r) => r.json()); return s.user?.email === c.email ? s : null; }, 'requester portal login');
        states.requester = { email: c.email, tenant: s.user.tenant }; await mark('Fresh client-portal form login', states.requester);
      } else await actor(w === 'qa' ? L.qa() : L.alice());
    }
    const sharedRoute = (t) => `/msp/co-management/tickets/${C}/${R}/${t}`;
    async function openTicket(w, t) {
      if (who !== w) await as(w);
      await go(w === 'alice' ? '/msp/tickets/' + t : w === 'qa' ? sharedRoute(t) : '/client-portal/tickets/' + t);
      if (w !== 'requester') {
        const entry = page.getByRole('button', { name: 'Entry', exact: true });
        await entry.waitFor({ timeout: 60000 }).catch(() => {}); if (await entry.count()) await entry.click();
      }
    }
    async function openComposer() {
      const show = page.locator('#ticket-details-conversation-show-comment-editor-btn');
      if (await show.isVisible().catch(() => false)) await show.click();
      await page.locator('#ticket-details-conversation-add-comment-btn').waitFor();
    }
    async function compose(audience, text, file) {
      await openComposer();
      await page.locator('#ticket-details-conversation-audience-select').click();
      await page.getByRole('option', { name: audience }).first().click();
      const ed = page.locator('[contenteditable=true]').last(); await ed.click(); await page.keyboard.type(text, { delay: 3 });
      if (file) { await page.locator('#co-shared-comment-files').setInputFiles({ name: file.name, mimeType: 'text/plain', buffer: file.bytes }); await page.getByText(file.name).first().waitFor(); }
    }
    const count = (t) => Number(sql(`select (select count(*) from comments where tenant='${C}' and ticket_id='${fixture.ticketId}' and note::text like '%${esc(t)}%' and deleted_at is null) + (select count(*) from co_management_private_comments where tenant='${ids.oz}' and note like '%${esc(t)}%' and deleted_at is null)`));
    const files = {}, msgs = {};
    async function post(w, key, audience, withFile = true) {
      await openTicket(w, fixture.ticketId);
      const text = `${SFX} ${key} ${stamp}`;
      const file = withFile ? { name: `cm-review-20261026-07-${key}-${stamp}.txt`, bytes: Buffer.from(`${SFX} distinct file contents for ${key} ${stamp}\n`) } : null;
      await compose(audience, text, file); await shot(`compose-${key}`);
      await page.locator('#ticket-details-conversation-add-comment-btn').click();
      await until(() => count(text) === 1, 'message stored ' + key);
      await vis(text).waitFor();
      msgs[key] = text;
      if (file) {
        const link = page.getByRole('link', { name: file.name, exact: true }); await link.waitFor();
        const href = await link.getAttribute('href'); const resp = await ctx.request.get(origin + href);
        await check(`${w}-${key}-published-file-bytes-match`, resp.ok() && (await resp.body()).equals(file.bytes), { sha256: sha(file.bytes) });
        files[key] = { ...file, href };
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(text).waitFor({ timeout: 60000 });
      await check(`${w}-${key}-message-persists-after-reload`, count(text) === 1);
    }

    // ------------------------------------------------------------ Before you start
    await chapter('Before you start: requester and disposable shared ticket (customer native screens)');
    await as('alice');
    if (!fs.existsSync(credFile)) {
      await go('/msp/settings/users'); await page.locator('#client-view-btn').click(); await page.waitForTimeout(2200);
      await page.locator('#create-new-client-user-btn').click();
      await page.locator('#first-name').fill('CM Review'); await page.locator('#last-name').fill('Requester 07');
      const email = 'cm-review-20261026-07.requester@whiterabbit.test', password = 'CMr07!' + crypto.randomBytes(12).toString('hex');
      await page.locator('#email').fill(email); await page.locator('#email').press('Tab'); await page.waitForTimeout(800);
      await page.locator('#new-user-client-picker-trigger').click(); await page.waitForTimeout(300);
      if (!await page.locator('#new-user-client-picker-listbox').count()) await page.locator('#new-user-client-picker-trigger').click();
      await page.locator('#new-user-client-picker-listbox').getByRole('option', { name: /White Rabbit IT/ }).click();
      const role = page.getByRole('combobox').filter({ hasText: /^(Select Role|Admin|User)$/ });
      if (await role.count()) { await role.first().click(); await opt('User').click(); }
      await page.locator('#password').fill(password); await shot('prep-requester-form');
      await page.locator('#submit-new-client-user-btn').click();
      const userId = await until(() => sql(`select user_id from users where tenant='${C}' and email='${email}' and user_type='client'`), 'requester created');
      const contactId = sql(`select contact_id from users where tenant='${C}' and user_id='${userId}'`);
      fs.writeFileSync(credFile, JSON.stringify({ email, password, tenant: C, userId, contactId }, null, 2), { mode: 0o600 });
      saveFix({ requester: { email, userId, contactId } });
    }
    const reqCred = JSON.parse(fs.readFileSync(credFile, 'utf8'));
    await check('prep-requester-exists-in-customer-tenant', Boolean(sql(`select user_id from users where tenant='${C}' and email='${reqCred.email}' and user_type='client'`)), { email: reqCred.email });
    const title = SFX + (process.env.CM_RUN ? ' ' + process.env.CM_RUN : '') + ' conversation ticket';
    let ticketId = sql(`select ticket_id from tickets where tenant='${C}' and title='${esc(title)}' limit 1`);
    if (!ticketId) {
      await go('/msp/tickets');
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 20000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(title);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).first().click(); await page.waitForTimeout(1000);
      await page.locator('#ticket-quick-add-contact-trigger, #ticket-quick-add-contact').first().click();
      await page.getByRole('option', { name: /Requester 07/ }).first().click();
      await page.locator('#ticket-quick-add-board-picker').click(); await page.getByRole('option', { name: /Service Desk/ }).first().click(); await page.waitForTimeout(800);
      const pickFirst = async (trigger) => { await page.locator(trigger).click(); const o = page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first(); await o.waitFor(); await o.click(); };
      if (/Select Status/i.test(await page.locator('#quick-add-ticket-dialog, [role=dialog]').first().innerText())) await pickFirst('#ticket-quick-add');
      if (/Select Priority/i.test(await page.locator('#quick-add-ticket-dialog, [role=dialog]').first().innerText())) await pickFirst('#ticket-quick-add-priority');
      await shot('prep-ticket-quick-add');
      await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 }); ticketId = new URL(page.url()).pathname.split('/').at(-1);
    }
    saveFix({ ticketId, title, links: { customer: origin + '/msp/tickets/' + ticketId, msp: origin + sharedRoute(ticketId), portal: origin + '/client-portal/tickets/' + ticketId } });
    await check('prep-disposable-ticket-with-requester-contact', sql(`select contact_name_id from tickets where tenant='${C}' and ticket_id='${ticketId}'`) === reqCred.contactId, { ticketId });

    // ------------------------------------------------------------ 1 + 2
    if (want('1')) {
      await chapter('1. Shared IT teams message with an attached file (QA)');
      await post('qa', 'shared', 'Shared IT teams');
      await chapter('1. Customer reads the shared message and file');
      await openTicket('alice', ticketId); await vis(msgs.shared).waitFor();
      const dl = await ctx.request.get(origin + files.shared.href);
      await check('alice-reads-shared-message-and-file-bytes', dl.ok() && (await dl.body()).equals(files.shared.bytes));
      const body = await page.locator('body').innerText();
      await check('alice-sees-organization-qualified-msp-author', /QA Tester/.test(body), {});
      await shot('s1-customer-shared');
      await chapter('1. Organization-private messages from each side, then requester audience');
      await post('alice', 'customer-private', /Private to|My organization only/);
      await post('qa', 'msp-private', 'My organization only');
      await post('qa', 'requester', 'Requester and IT teams');
      for (const w of ['qa', 'alice']) {
        await openTicket(w, ticketId); await vis(msgs.shared).waitFor();
        const own = w === 'qa' ? 'msp-private' : 'customer-private', other = w === 'qa' ? 'customer-private' : 'msp-private';
        await vis(msgs[own]).waitFor(); await vis(msgs.requester).waitFor();
        const text = await page.locator('body').innerText();
        await check(`s1-${w}-cannot-see-other-organization-private-message`, !text.includes(msgs[other]));
        const mine = await ctx.request.get(origin + files[own].href);
        await check(`s2-${w}-downloads-own-private-file`, mine.ok() && (await mine.body()).equals(files[own].bytes));
        const denied = await ctx.request.get(origin + files[other].href);
        await check(`s2-${w}-copied-other-private-file-link-denied`, !denied.ok(), { status: denied.status() });
        await shot(`s1-${w}-audiences`);
      }
      await chapter('1. Requester sees only requester-audience content in the portal');
      await openTicket('requester', ticketId); await vis(msgs.requester).waitFor({ timeout: 60000 });
      const pt = await page.locator('body').innerText();
      await check('s1-requester-sees-only-requester-audience', ['shared', 'msp-private', 'customer-private'].every((k) => !pt.includes(msgs[k])));
      const pub = await ctx.request.get(origin + files.requester.href);
      const portalLink = page.getByRole('link', { name: files.requester.name, exact: true });
      const portalHref = await portalLink.count() ? await portalLink.getAttribute('href') : files.requester.href;
      const pub2 = await ctx.request.get(origin + portalHref);
      await check('s2-requester-downloads-requester-file-bytes', pub2.ok() && (await pub2.body()).equals(files.requester.bytes), { viaPortalLink: portalHref !== files.requester.href, staffHrefStatus: pub.status() });
      for (const k of ['shared', 'msp-private', 'customer-private']) { const d = await ctx.request.get(origin + files[k].href); await check(`s2-requester-denied-${k}-file-link`, !d.ok(), { status: d.status() }); }
      await shot('s1-requester-portal');
      saveFix({ messages: msgs, files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, { name: f.name, href: f.href, sha256: sha(f.bytes) }])) });
      receipt('commentsAfterSection1', json(`select comment_id,author_type,is_internal,publish_state,left(note::text,0) as n, created_at from comments where tenant='${C}' and ticket_id='${ticketId}' order by created_at`));
    }

    // ------------------------------------------------------------ 2 removal + unknown-outcome recheck
    if (want('2')) {
      await chapter('2. Author removes a disposable attachment; old link stops downloading');
      await post('qa', 'removable', 'Shared IT teams');
      const remCid = sql(`select comment_id from comments where tenant='${C}' and ticket_id='${ticketId}' and note::text like '%${esc(msgs.removable)}%'`);
      const remove = page.locator(`button[id^="co-attachments-"][id*="-${remCid}-"][id$="-remove"]`);
      await remove.waitFor(); await check('s2-remove-offered-to-author', await remove.count() === 1);
      await remove.click(); await shot('s2-remove-confirm');
      const dlg = page.getByRole('dialog'); await dlg.getByRole('button', { name: 'Remove', exact: true }).click();
      await dlg.waitFor({ state: 'hidden' }); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(msgs.removable).waitFor();
      await page.locator(`button[id^="co-attachments-"][id*="-${remCid}-"][id$="-add"]`).waitFor({ timeout: 60000 });
      const gone = await ctx.request.get(origin + files.removable.href);
      await check('s2-removed-file-absent-after-reload-and-link-denied', !gone.ok() && await page.getByRole('link', { name: files.removable.name, exact: true }).count() === 0, { status: gone.status() });
      await shot('s2-attachment-removed');

      await chapter('2. Uncertain send: server saved the message but the response was lost');
      await openTicket('qa', ticketId);
      const text = `${SFX} uncertain-response ${stamp}`, file = { name: `cm-review-20261026-07-uncertain-${stamp}.txt`, bytes: Buffer.from(`${SFX} uncertain ${stamp}\n`) };
      await compose('Shared IT teams', text, file); await shot('s2-uncertain-composed');
      const manifest = JSON.parse(fs.readFileSync(`${L.worktree}/server/${build.dist}/server/server-reference-manifest.json`, 'utf8'));
      const action = Object.entries(manifest.node).find(([, v]) => v.exportedName === 'publishCoManagedConversationDraftAction')?.[0];
      if (!action) throw Error('publish action id not found in served manifest');
      const ops = []; let dropped = false;
      page.on('request', (q) => { if (q.method() === 'POST' && q.headers()['next-action'] === action) { try { ops.push(JSON.parse(q.postData())[1]?.operationId); } catch { ops.push('unparsed'); } } });
      await page.route('**/*', async (rt) => { const q = rt.request(); if (q.method() === 'POST' && q.headers()['next-action'] === action) { if (!dropped) { const resp = await rt.fetch(); await resp.body(); dropped = true; await rt.abort('connectionreset'); return; } } await rt.continue(); });
      await page.locator('#ticket-details-conversation-add-comment-btn').click();
      await until(() => dropped, 'server-executed publish response dropped');
      await until(() => count(text) === 1, 'server persisted exactly one message');
      await page.waitForTimeout(2500);
      const send = page.locator('#ticket-details-conversation-add-comment-btn');
      const composerOpen = await send.isVisible().catch(() => false);
      const editorText = composerOpen ? await page.locator('[contenteditable=true]').last().innerText() : '';
      const fileStaged = composerOpen && await page.locator('button[id^=co-shared-comment-file-remove-]').count() > 0;
      const toast = (await page.locator('body').innerText()).match(/could not confirm[^\n]*/i)?.[0] || null;
      const observation = { persistedMessages: count(text), composerOpenAfterUnknown: composerOpen, draftTextRetained: editorText.includes(text), stagedFileRetained: fileStaged, toast, operationId: ops[0] };
      await mark('s2-unknown-outcome-observed', observation); await shot('s2-unknown-outcome-state'); await inspect('s2-unknown-outcome-dom');
      receipt('unknownOutcome', observation);
      await page.unrouteAll({ behavior: 'wait' });
      if (composerOpen && editorText.includes(text)) {
        await shot('s2-before-retry'); await send.click();
        await until(async () => !(await send.isVisible().catch(() => false)), 'retry confirmation closes composer');
        await vis(text).waitFor(); await shot('s2-after-retry');
        await check('s2-retry-reuses-operation-no-duplicate', count(text) === 1 && ops.length >= 2 && ops.every((o) => o === ops[0]), { ops, persisted: count(text) });
      } else {
        await mark('s2-DEFECT-composer-lost-draft-after-unknown-outcome', { ...observation, note: 'Server persisted the message; the native composer did not keep the draft, so same-operation retry is not offered.' });
        fs.writeFileSync(path.join(guideDir, 'defect-unknown-outcome.json'), JSON.stringify({ id: 'native-comment-unknown-response-clears-composer', build, ticketId, message: text, fileName: file.name, ...observation,
          reproduction: ['QA opens the shared ticket (Entry layout) and opens the composer', 'Choose Shared IT teams, type text, attach a .txt file', 'Send while the publishCoManagedConversationDraftAction response is dropped after the server executed it (Playwright route: fetch then abort connectionreset)', 'Observe: unknown-outcome toast; composer state as recorded here; database has exactly one published comment'],
          expected: 'Composer keeps the draft and staged file and offers Retry with the same operationId (no duplicate).' }, null, 2));
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(text).waitFor();
      const lk = page.getByRole('link', { name: file.name, exact: true }); await lk.waitFor();
      const b = await ctx.request.get(origin + await lk.getAttribute('href'));
      await check('s2-uncertain-publication-complete-once-after-reload', b.ok() && (await b.body()).equals(file.bytes) && count(text) === 1, { persisted: count(text) });
      saveFix({ unknownOutcome: observation });
    }

    // ------------------------------------------------------------ 3
    if (want('3')) {
      await chapter('3. Reply from the other organization, edit, and delete the root');
      await post('qa', 'root', 'Shared IT teams', false);
      const rootId = sql(`select comment_id from comments where tenant='${C}' and ticket_id='${ticketId}' and note::text like '%${esc(msgs.root)}%'`);
      await openTicket('alice', ticketId); await vis(msgs.root).waitFor();
      await check('s3-customer-cannot-edit-or-delete-msp-message', await page.locator('#edit-comment-' + rootId + '-button').count() === 0 && await page.locator('#delete-comment-' + rootId + '-button').count() === 0);
      const reply = `${SFX} customer reply ${stamp}`;
      await page.locator('#reply-comment-' + rootId + '-button').click();
      const ed = page.locator('.inline-reply-composer [contenteditable=true]'); await ed.waitFor();
      await until(() => ed.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), 'reply editor focused');
      await page.waitForTimeout(500); await ed.pressSequentially(reply, { delay: 6 }); await shot('s3-reply-typed');
      await page.locator('button[id$="-reply-' + rootId + '-submit"]').click();
      await until(() => count(reply) === 1, 'reply stored');
      await vis(reply).waitFor(); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(reply).waitFor();
      await check('s3-customer-reply-persists', true); await shot('s3-customer-reply');
      await openTicket('qa', ticketId); await vis(reply).waitFor();
      const qtext = await page.locator('body').innerText();
      await check('s3-msp-sees-reply-with-customer-author', qtext.includes('Alice Liddell'));
      await page.locator('#edit-comment-' + rootId + '-button').click();
      const edited = msgs.root + ' edited';
      const editInput = page.locator('[id="' + rootId + '-save-btn"]').locator('..').locator('..').locator('[contenteditable=true]');
      await editInput.click(); await page.keyboard.press('End'); await page.keyboard.type(' edited', { delay: 5 }); await shot('s3-editing');
      await page.waitForTimeout(800); await page.locator('[id="' + rootId + '-save-btn"]').click();
      await until(() => count(edited) === 1, 'edit stored');
      await vis(edited).waitFor(); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(edited).waitFor();
      await openTicket('alice', ticketId); await vis(edited).waitFor(); await vis(reply).waitFor();
      await check('s3-edit-visible-to-customer-reply-retained', true); await shot('s3-edited-customer-view');
      await openTicket('qa', ticketId);
      await page.locator('#delete-comment-' + rootId + '-button').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(reply).waitFor();
      const after = await page.locator('body').innerText();
      await check('s3-root-tombstoned-reply-survives', !after.includes(edited) && /deleted/i.test(after));
      await openTicket('alice', ticketId); await vis(reply).waitFor();
      await check('s3-customer-sees-tombstone-and-own-reply', !(await page.locator('body').innerText()).includes(edited));
      await shot('s3-tombstone');
    }

    // ------------------------------------------------------------ 4
    async function reply(w, rootId, text) {
      await openTicket(w, ticketId);
      await page.locator('#reply-comment-' + rootId + '-button').click();
      const ed = page.locator('.inline-reply-composer [contenteditable=true]'); await ed.waitFor();
      await until(() => ed.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), 'reply editor focused');
      await page.waitForTimeout(500); await ed.pressSequentially(text, { delay: 6 });
      await page.locator('button[id$="-reply-' + rootId + '-submit"]').click();
      await until(() => count(text) === 1, 'reply stored');
      await vis(text).waitFor(); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(text).waitFor({ timeout: 60000 });
    }
    if (want('4')) {
      await chapter('4. Whole-thread audience change: MSP-private thread with reply and file');
      await post('qa', 'thread', 'My organization only');
      const tRoot = sql(`select comment_id from co_management_private_comments where tenant='${ids.oz}' and note like '%${esc(msgs.thread)}%' and parent_comment_id is null`);
      const tThread = sql(`select thread_id from co_management_private_comments where tenant='${ids.oz}' and comment_id='${tRoot}'`);
      const tReply = `${SFX} MSP private reply ${stamp}`;
      await reply('qa', tRoot, tReply);
      await check('s4-private-thread-has-reply', count(tReply) === 1, { tRoot, tThread });
      await page.locator('[id="' + tRoot + '-audience-select"]').click();
      await opt('Requester and IT teams').click();
      const dialog = page.getByRole('dialog', { name: 'Change thread audience', exact: true }); await dialog.waitFor();
      const preview = await until(async () => { const t = await dialog.innerText(); return /Loading/i.test(t) ? null : t; }, 'disclosure preview', 30000);
      await check('s4-preview-counts-root-reply-and-attachment', /2 messages/.test(preview) && /1 attachment/.test(preview), { preview: preview.slice(0, 500) });
      const aud = page.locator('[id="co-thread-' + tThread + '-disclosure-audience"]');
      if (await aud.count()) { await aud.click(); await opt('Requester and IT teams').click(); }
      await shot('s4-disclosure-preview');
      await page.locator('[id="co-thread-' + tThread + '-disclosure-confirm"]').click(); await dialog.waitFor({ state: 'hidden' });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await vis(tReply).waitFor({ timeout: 60000 });
      await check('s4-msp-private-original-read-only', await page.locator('#edit-comment-' + tRoot + '-button').count() === 0 && await page.locator('#delete-comment-' + tRoot + '-button').count() === 0);
      await shot('s4-msp-after-disclosure');
      await openTicket('alice', ticketId); await vis(msgs.thread).waitFor(); await vis(tReply).waitFor();
      const dl = page.getByRole('link', { name: files.thread.name, exact: true }); await dl.waitFor();
      const dHref = await dl.getAttribute('href'), dRes = await ctx.request.get(origin + dHref);
      await check('s4-customer-receives-thread-reply-and-matching-file', dRes.ok() && sha(await dRes.body()) === sha(files.thread.bytes), { newHref: dHref !== files.thread.href });
      const old = await ctx.request.get(origin + files.thread.href);
      await check('s4-customer-cannot-use-msp-private-original-file-link', !old.ok(), { status: old.status() });
      await shot('s4-customer-disclosed-thread');
      await openTicket('requester', ticketId); await vis(tReply).waitFor({ timeout: 60000 });
      const pl = page.getByRole('link', { name: files.thread.name, exact: true }); await pl.waitFor();
      const pHref = await pl.getAttribute('href'), pRes = await ctx.request.get(origin + pHref);
      await check('s4-requester-receives-disclosed-thread-and-file', pRes.ok() && sha(await pRes.body()) === sha(files.thread.bytes));
      await shot('s4-requester-disclosed');
      await chapter('4. Restrict the disclosed thread back to Shared IT teams');
      const dRoot = sql(`select comment_id from comments where tenant='${C}' and ticket_id='${ticketId}' and note::text like '%${esc(msgs.thread)}%' and parent_comment_id is null`);
      await openTicket('qa', ticketId); await vis(msgs.thread).waitFor();
      await page.locator('[id="' + dRoot + '-audience-select"]').click(); await opt('Shared IT teams').click();
      const d2 = page.getByRole('dialog', { name: 'Change thread audience', exact: true }); await d2.waitFor();
      await until(async () => !/Loading/i.test(await d2.innerText()), 'preview 2');
      const aud2 = d2.locator('[id$="-disclosure-audience"]'); if (await aud2.count()) { await aud2.click(); await opt('Shared IT teams').click(); }
      await shot('s4-restrict-preview');
      await d2.locator('[id$="-disclosure-confirm"]').click(); await d2.waitFor({ state: 'hidden' });
      await openTicket('requester', ticketId); await page.waitForTimeout(2500);
      await until(async () => !(await page.locator('body').innerText()).includes(tReply), 'requester loses thread');
      const gone = await ctx.request.get(origin + pHref);
      await check('s4-restriction-removes-thread-and-copied-file-from-requester', !gone.ok() && !(await page.locator('body').innerText()).includes(msgs.thread), { status: gone.status() });
      await shot('s4-requester-after-restriction');
      await openTicket('alice', ticketId); await vis(tReply).waitFor();
      await check('s4-customer-still-reads-thread-at-shared-it-audience', true);
      saveFix({ disclosure: { sourceRoot: tRoot, sourceThread: tThread, destinationRoot: dRoot, reply: tReply } });
    }

    // ------------------------------------------------------------ 5
    if (want('5')) {
      await chapter('5. Requester task conversation (portal) on a requester-visible shared task');
      await as('alice');
      const RUNS = process.env.CM_RUN ? ' ' + process.env.CM_RUN : ''; const PN = SFX + RUNS + ' requester project', TN = SFX + RUNS + ' requester task';
      let pid = sql(`select project_id from projects where tenant='${C}' and project_name='${esc(PN)}'`);
      if (!pid) {
        await go('/msp/projects'); await page.locator('#add-project-button').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByPlaceholder('Project Name *', { exact: true }).fill(PN);
        await dialog.getByRole('combobox').filter({ hasText: 'Select Status' }).click(); await opt('Not Started').click();
        await dialog.locator('#client-picker-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).click();
        await dialog.locator('#create-button').click();
        pid = await until(() => sql(`select project_id from projects where tenant='${C}' and project_name='${esc(PN)}'`), 'project');
      }
      await go('/msp/projects/' + pid);
      let phase = sql(`select phase_id from project_phases where tenant='${C}' and project_id='${pid}' limit 1`);
      if (!phase) { await page.locator('#add-phase-button').click(); await page.getByPlaceholder('Phase name... *', { exact: true }).fill(SFX + ' Phase'); await page.locator('#save-phase-button').click(); phase = await until(() => sql(`select phase_id from project_phases where tenant='${C}' and project_id='${pid}' limit 1`), 'phase'); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); }
      let tid = sql(`select task_id from project_tasks where tenant='${C}' and phase_id='${phase}' and task_name='${esc(TN)}'`);
      if (!tid) { await page.getByText(SFX + ' Phase', { exact: true }).first().click(); await page.locator('#add-task-button').click(); await page.getByPlaceholder('Enter task name...', { exact: true }).fill(TN); await page.locator('#save-button').click(); tid = await until(() => sql(`select task_id from project_tasks where tenant='${C}' and phase_id='${phase}' and task_name='${esc(TN)}'`), 'task'); }
      const cfg = () => JSON.parse(sql(`select coalesce(client_portal_config::text,'{}') from projects where tenant='${C}' and project_id='${pid}'`));
      if (!cfg().show_tasks) {
        await go('/msp/projects/' + pid); await page.locator('#edit-project-button').click();
        await page.getByRole('button', { name: 'Client Portal Visibility', exact: true }).click();
        for (const sw of ['#show-phases', '#show-tasks']) if (await page.locator(sw).getAttribute('aria-checked') !== 'true') await page.locator(sw).click();
        await shot('s5-portal-visibility'); await page.locator('#save-button').click();
        if (await page.locator('#save-and-close-button').count()) await page.locator('#save-and-close-button').click();
        await until(() => cfg().show_tasks === true, 'portal task visibility saved');
      }
      await go('/msp/co-management');
      const access = page.locator('#co-policy-project-access-' + pid);
      if (!await access.count()) {
        await page.locator('#co-policy-project-search').fill(PN); await page.waitForTimeout(900);
        await page.locator('#co-policy-project-select').click(); await opt(PN).click(); await page.locator('#co-policy-project-add').click();
        await access.click(); await opt('Collaborate').click(); await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
      }
      await check('s5-prep-requester-visible-shared-task', cfg().show_tasks === true && Boolean(sql(`select project_id from co_management_project_scopes where tenant='${C}' and project_id='${pid}'`)), { pid, tid });
      saveFix({ requesterProject: { pid, tid, links: { msp: origin + `/msp/co-management/tasks/${C}/${R}/${tid}`, portal: origin + `/client-portal/projects/${pid}?taskId=${tid}` } } });
      await as('qa'); await go(`/msp/co-management/tasks/${C}/${R}/${tid}`);
      async function taskMsg(audience, text) {
        await page.locator('#co-task-conversation-new').click();
        await page.locator('#co-task-conversation-audience').click(); await opt(audience).click();
        await page.locator('#co-task-conversation-message [contenteditable=true], #co-task-conversation-message').first().click(); await page.keyboard.type(text);
        await page.locator('#co-task-conversation-submit').click();
        await page.locator('li[id^=co-task-comment-]').filter({ hasText: text }).waitFor();
      }
      const pubText = `${SFX} task requester message ${stamp}`, privText = `${SFX} task MSP private ${stamp}`, reqReply = `${SFX} requester task reply ${stamp}`;
      await taskMsg('Requester and IT teams', pubText);
      const item = page.locator('li[id^=co-task-comment-]').filter({ hasText: pubText });
      await item.locator('button[id$=-add]').click();
      const tf = { name: `cm-review-20261026-07-task-${stamp}.txt`, bytes: Buffer.from(`${SFX} requester task file ${stamp}\n`) };
      await item.locator('input[type=file]').setInputFiles({ name: tf.name, mimeType: 'text/plain', buffer: tf.bytes });
      await item.locator('button[id$=-upload]').click(); await item.getByRole('link', { name: tf.name, exact: true }).waitFor();
      await taskMsg('My organization only', privText);
      await shot('s5-staff-task-audiences');
      await as('requester'); await go(`/client-portal/projects/${pid}?taskId=${tid}`);
      const conv = page.locator('#requester-task-' + tid + '-conversation');
      await until(async () => await page.locator('#requester-task-' + tid + '-message').count() || await conv.count(), 'portal task conversation control', 60000);
      if (!await page.locator('#requester-task-' + tid + '-message').count()) await conv.click();
      await vis(pubText).waitFor({ timeout: 60000 });
      const portalBody = await page.locator('body').innerText();
      await check('s5-requester-sees-public-task-message-with-staff-attribution', /QA Tester/.test(portalBody), {});
      await check('s5-requester-does-not-see-msp-private-task-message', !portalBody.includes(privText));
      const fl = page.getByRole('link', { name: tf.name, exact: true }); await fl.waitFor();
      const fr = await ctx.request.get(origin + await fl.getAttribute('href'));
      await check('s5-requester-downloads-task-file-bytes', fr.ok() && (await fr.body()).equals(tf.bytes));
      await page.locator('#requester-task-' + tid + '-message').fill(reqReply); await page.locator('#requester-task-' + tid + '-send').click();
      await vis(reqReply).waitFor(); await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      if (!await page.locator('#requester-task-' + tid + '-message').count() && await conv.count()) await conv.click();
      await vis(reqReply).waitFor({ timeout: 60000 });
      await check('s5-requester-reply-persists-after-reload', true); await shot('s5-requester-task-conversation');
      await as('qa'); await go(`/msp/co-management/tasks/${C}/${R}/${tid}`); await vis(reqReply).waitFor({ timeout: 60000 });
      await check('s5-staff-sees-requester-reply-with-author', (await page.locator('body').innerText()).includes('Requester 07'));
      await shot('s5-staff-readback');
      await chapter('5. Cleanup: customer removes the requester project grant');
      await as('alice'); await go('/msp/co-management');
      await page.locator('#co-policy-project-remove-' + pid).click(); await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
      await check('s5-requester-project-grant-removed', !sql(`select project_id from co_management_project_scopes where tenant='${C}' and project_id='${pid}'`));
      saveFix({ requesterTask: { pubText, privText, reqReply, file: tf.name } });
    }
    return { status: 'passed', limitations: [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
