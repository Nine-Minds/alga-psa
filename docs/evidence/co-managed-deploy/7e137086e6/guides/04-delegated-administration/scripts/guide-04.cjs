// Guide 04 (Delegated administration) walkthrough on the active White Rabbit relationship.
// Main recorded page: the acting principal at each step. The customer's concurrent session in section 3
// runs in a second recorded browser context (customer-session/ video). sql() is read-only.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { scenario, assert } = require('../../scripts/runtime.cjs');
const L = require('../../03-access-policies/scripts/lib.cjs');
const { ids, qa, alice, sql, until, origin, esc, json } = L;

const SUFFIX = 'CM-REVIEW-20261026-04';
const BOARD = `${SUFFIX} Delegation board`, ORIGINAL_DESC = `${SUFFIX} original description`;
const PROFILE_EMAIL = 'cm-review-20261026-04-profile@whiterabbit.test', INVITEE_EMAIL = 'cm-review-20261026-04-invitee@whiterabbit.test';
const root = path.resolve(__dirname, '..');
const name = process.env.CM_SCENARIO || 'recording';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mails = async (to) => (await (await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result.filter((m) => (Array.isArray(m.to) ? m.to.join(',') : JSON.stringify(m.to)).includes(to));
const setupLink = (m) => { const x = m.text?.match(/(https?:\/\/\S*\/auth\/team\/setup\S*)/) || m.html?.match(/href="([^"]*\/auth\/team\/setup[^"]*)"/); return x ? x[1].replaceAll('&amp;', '&') : null; };

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const h = L.helpers(page, { mark, check, shot });
    const grants = () => json(`select grant_id, principal_id, operation, target_id, revoked_at from co_management_delegated_grants where tenant='${ids.customer}' and relationship_id='${ids.relationship}' order by created_at`);
    const boardRow = (id) => json(`select board_name, description, enable_live_ticket_timer from boards where tenant='${ids.customer}' and board_id='${id}'`)[0];
    const userRow = (email) => json(`select user_id, first_name, last_name, timezone from users where tenant='${ids.customer}' and email='${email}'`)[0];
    const inviteRow = (email) => json(`select invitation_id, email, first_name, last_name, role_id, token, expires_at, used_at, metadata from user_invitations where tenant='${ids.customer}' and email='${email}' order by created_at desc limit 1`)[0];
    const receipts = { baselineGrants: grants() };
    const saveReceipts = () => fs.writeFileSync(dir + '/db-receipts.json', JSON.stringify(receipts, null, 2));
    saveReceipts();

    async function approve(opLabel, kind, targetSearch, targetName) {
      await go('/msp/co-management/administration'); await page.locator('#co-delegation-operation').waitFor();
      await h.choose('#co-delegation-operation', opLabel); await page.waitForTimeout(600);
      await page.locator('#co-delegation-picker-principal-search').fill('QA'); await page.waitForTimeout(900);
      await h.choose('#co-delegation-picker-principal-choice', 'QA Tester');
      await page.locator(`#co-delegation-picker-${kind}-search`).fill(targetSearch); await page.waitForTimeout(900);
      await h.choose(`#co-delegation-picker-${kind}-choice`, targetName);
      const summary = await page.locator('body').innerText();
      const before = new Set(grants().map((g) => g.grant_id));
      await page.locator('#co-delegation-approve').click();
      const grant = await until(() => grants().find((g) => !before.has(g.grant_id) && !g.revoked_at), 'grant committed', 60000);
      await page.locator('#co-delegation-refresh').click(); await page.locator(`#co-delegation-${grant.grant_id}-apply`).waitFor();
      return { grant, summary };
    }
    async function revoke(grantId, p = page) {
      await p.goto(origin + '/msp/co-management/administration', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await p.locator(`#co-delegation-${grantId}-apply`).click();
      await until(() => grants().find((g) => g.grant_id === grantId)?.revoked_at, 'grant revoked', 60000);
    }
    const qaAdmin = async () => { await go('/msp/co-management/administration?operationId=' + ids.operation); await page.locator('#co-delegation-refresh').waitFor(); await page.waitForTimeout(1500); };

    // ---------------- Preparation ----------------
    await chapter('Preparation: disposable board, non-administrator user and invitation');
    await actor(alice);
    let boardId = sql(`select board_id from boards where tenant='${ids.customer}' and board_name='${esc(BOARD)}'`);
    if (!boardId) boardId = await h.createBoard(BOARD, ORIGINAL_DESC);
    await check('prep-disposable-board', boardRow(boardId)?.description === ORIGINAL_DESC, boardRow(boardId));
    async function createUser(first, last, email, password) {
      await go('/msp/settings/users'); await page.locator('#create-new-msp-user-btn').click();
      await page.locator('#first-name').fill(first); await page.locator('#last-name').fill(last); await page.locator('#email').fill(email);
      const role = page.locator('label', { hasText: 'Primary Role' }).locator('..').getByRole('combobox').first();
      await role.click(); await page.getByRole('option', { name: 'Technician', exact: true }).click();
      if (password) await page.locator('#password').fill(password);
      await shot('prep-user-' + last.toLowerCase()); await page.locator('#submit-new-msp-user-btn').click();
    }
    const seats = () => Number(sql(`select seats from co_managed_allocations where customer_tenant='${ids.customer}' and relationship_id='${ids.relationship}' and state='active'`));
    const seats0 = seats(); receipts.seats0 = seats0; saveReceipts();
    async function setSeats(n) {
      await actor(qa); await go('/msp/clients/' + ids.client + '?tab=co-managed');
      await page.locator('#client-details-co-managed-seats-seats-open').click(); await page.locator('#client-details-co-managed-seats-seats-input').fill(String(n));
      await shot('seats-' + n); await page.locator('#client-details-co-managed-seats-seats-save').click();
      await until(() => seats() === n, 'allocation ' + n, 60000);
    }
    if (!userRow(PROFILE_EMAIL)) {
      // White Rabbit's single seat is used by Alice; a non-administrator user needs one more allocated seat.
      if (seats0 < 2) { await setSeats(seats0 + 1); await check('prep-msp-allocates-one-more-seat', seats() === seats0 + 1, { before: seats0, after: seats() }); }
      await actor(alice);
      const password = L.newPassword('04');
      L.saveCredential('cm-review-20261026-04-profile.json', { email: PROFILE_EMAIL, password, tenant: ids.customer });
      await createUser('CMReview04', 'Profile', PROFILE_EMAIL, password);
      await until(() => userRow(PROFILE_EMAIL), 'profile user created', 60000);
    }
    const profile0 = userRow(PROFILE_EMAIL);
    await check('prep-nonadmin-user', Boolean(profile0), profile0);
    Object.assign(receipts, { board0: boardRow(boardId), profile0 }); saveReceipts();
    await actor(alice);

    // ---------------- 1. Approve one board operation ----------------
    await chapter('1. Approve one board operation');
    await go('/msp/co-management/administration'); await page.locator('#co-delegation-operation').waitFor(); await shot('1-approval-form');
    // Unassigned MSP staff are not offered as principals.
    await page.locator('#co-delegation-picker-principal-search').fill('Tin'); await page.waitForTimeout(900);
    await page.locator('#co-delegation-picker-principal-choice').click(); await page.waitForTimeout(500);
    await check('1-unassigned-staff-not-offered', await page.getByRole('option', { name: 'Tin Woodman' }).count() === 0); await page.keyboard.press('Escape');
    const b = await approve('Edit board display settings', 'board_settings', SUFFIX, BOARD);
    await check('1-approval-summary-names-principal-operation-target', /QA Tester/.test(b.summary) && b.summary.includes('Edit board display settings') && b.summary.includes(BOARD));
    const boardGrant = b.grant.grant_id;
    await check('1-grant-binds-principal-operation-and-board', b.grant.principal_id === ids.qaId && b.grant.operation === 'board_settings' && b.grant.target_id === boardId, b.grant);
    await check('1-refreshed-approval-listed', (await page.locator('body').innerText()).includes(BOARD)); await shot('1-approved-refreshed');

    // ---------------- 2. Perform only the approved change ----------------
    await chapter('2. Perform only the approved change');
    await actor(qa); await qaAdmin();
    const fieldIds = await page.locator(`[id^="co-delegation-${boardGrant}-"]`).evaluateAll((els) => els.map((e) => e.id));
    await check('2-only-board-display-fields-offered', fieldIds.filter((x) => !x.endsWith('-apply')).sort().join() === ['board_name', 'description', 'enable_live_ticket_timer'].map((f) => `co-delegation-${boardGrant}-${f}`).sort().join(), { fieldIds });
    const delegatedDesc = `${SUFFIX} delegated ${Date.now()}`;
    await page.locator(`#co-delegation-${boardGrant}-description`).fill(delegatedDesc); await shot('2-editor-filled');
    await page.locator(`#co-delegation-${boardGrant}-apply`).click();
    await until(() => boardRow(boardId).description === delegatedDesc, 'delegated description saved', 60000);
    await page.locator('#co-delegation-refresh').click(); await page.locator(`#co-delegation-${boardGrant}-description`).waitFor(); await page.waitForTimeout(1000);
    await check('2-delegated-change-persists-after-refresh', await page.locator(`#co-delegation-${boardGrant}-description`).inputValue() === delegatedDesc);
    await actor(alice); await go('/msp/settings?tab=ticketing&section=boards');
    await page.locator(`#board-actions-menu-${boardId}`).click(); await page.getByRole('menuitem', { name: /Edit/ }).first().click();
    await page.locator('#description').waitFor();
    await check('2-customer-board-settings-show-persisted-description', await page.locator('#description').inputValue() === delegatedDesc); await shot('2-customer-board-settings');
    await page.locator('#cancel-board-dialog').click().catch(() => {});
    await actor(qa); await qaAdmin();
    await page.locator(`#co-delegation-${boardGrant}-description`).fill(ORIGINAL_DESC); await page.locator(`#co-delegation-${boardGrant}-apply`).click();
    await until(() => boardRow(boardId).description === ORIGINAL_DESC, 'description restored', 60000);
    await page.reload(); await page.locator(`#co-delegation-${boardGrant}-description`).waitFor(); await page.waitForTimeout(800);
    await check('2-original-description-restored-through-approved-editor', await page.locator(`#co-delegation-${boardGrant}-description`).inputValue() === ORIGINAL_DESC);

    // ---------------- 3. Revocation closes an open editor ----------------
    await chapter('3. Prove revocation closes an open editor');
    await shot('3-msp-editor-open');
    const customerCtx = await ctx.browser().newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: dir + '/customer-session', size: { width: 1440, height: 1000 } } });
    try {
      const cp = await customerCtx.newPage();
      await cp.goto(origin + '/auth/msp/signin', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await cp.waitForFunction(() => { const b = document.querySelector('#msp-sign-in-button'); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, null, { timeout: 90000 });
      await cp.locator('#msp-email-field').fill(alice.email); await cp.waitForTimeout(800); await cp.locator('#msp-password-field').fill(alice.password); await cp.locator('#msp-sign-in-button').click();
      await until(async () => (await customerCtx.request.get(origin + '/api/auth/session').then((x) => x.json())).user?.email === alice.email, 'customer second session', 45000);
      await mark('customer second session signed in (customer-session video)');
      await revoke(boardGrant, cp); await cp.reload(); await cp.waitForTimeout(2000);
      await cp.screenshot({ path: dir + '/3-customer-revoked.png', fullPage: true });
      await check('3-customer-revoked-approval', Boolean(grants().find((g) => g.grant_id === boardGrant).revoked_at));
    } finally { await customerCtx.close(); }
    const staleDesc = `${SUFFIX} stale ${Date.now()}`;
    await page.locator(`#co-delegation-${boardGrant}-description`).fill(staleDesc); await page.locator(`#co-delegation-${boardGrant}-apply`).click();
    await page.waitForTimeout(4000); await shot('3-stale-editor-save-attempt');
    const staleText = await page.locator('body').innerText();
    await check('3-stale-editor-cannot-save', boardRow(boardId).description === ORIGINAL_DESC, { shownError: /could not be confirmed|Unavailable|no longer/i.test(staleText) });
    const retry = page.getByRole('button', { name: 'Retry same request', exact: true });
    if (await retry.count()) { await retry.click(); await page.waitForTimeout(3000); await mark('retried same request after revocation'); }
    await check('3-retry-does-not-revive-revoked-approval', boardRow(boardId).description === ORIGINAL_DESC && Boolean(grants().find((g) => g.grant_id === boardGrant).revoked_at), { retried: await retry.count() > 0 });
    await page.locator('#co-delegation-refresh').click(); await page.waitForTimeout(2000);
    await check('3-refreshed-editor-no-longer-offers-record', await page.locator(`#co-delegation-${boardGrant}-description`).count() === 0); await shot('3-refreshed-after-revocation');

    // ---------------- 4. Other bounded operations ----------------
    await chapter('4. Edit a non-administrator profile');
    await actor(alice); await go('/msp/co-management/administration'); await page.locator('#co-delegation-operation').waitFor();
    await h.choose('#co-delegation-operation', 'Edit a non-administrator profile'); await page.waitForTimeout(600);
    await page.locator('#co-delegation-picker-user_profile-search').fill('Alice'); await page.waitForTimeout(900);
    await page.locator('#co-delegation-picker-user_profile-choice').click(); await page.waitForTimeout(600);
    await check('4-administrator-profile-not-eligible', await page.getByRole('option', { name: 'Alice Liddell' }).count() === 0); await shot('4-admin-not-eligible'); await page.keyboard.press('Escape');
    const p = await approve('Edit a non-administrator profile', 'user_profile', 'CMReview04', 'CMReview04 Profile');
    const profileGrant = p.grant.grant_id;
    await check('4-profile-grant-binds-one-user', p.grant.target_id === profile0.user_id && p.grant.operation === 'user_profile', p.grant);
    await actor(qa); await qaAdmin();
    const pf = await page.locator(`[id^="co-delegation-${profileGrant}-"]`).evaluateAll((els) => els.map((e) => e.id));
    await check('4-profile-fields-limited-to-name-and-timezone', pf.filter((x) => !x.endsWith('-apply')).sort().join() === ['first_name', 'last_name', 'timezone'].map((f) => `co-delegation-${profileGrant}-${f}`).sort().join(), { pf });
    const newFirst = 'CMReview04Delegated';
    await page.locator(`#co-delegation-${profileGrant}-first_name`).fill(newFirst); await page.locator(`#co-delegation-${profileGrant}-apply`).click();
    await until(() => userRow(PROFILE_EMAIL).first_name === newFirst, 'profile saved', 60000); await shot('4-profile-saved');
    await actor(alice); await go('/msp/settings/users'); await page.getByText(newFirst, { exact: true }).first().waitFor({ timeout: 45000 });
    await check('4-customer-users-shows-delegated-profile-after-reload', true, userRow(PROFILE_EMAIL)); await shot('4-customer-users');
    await actor(qa); await qaAdmin();
    await page.locator(`#co-delegation-${profileGrant}-first_name`).fill(profile0.first_name); await page.locator(`#co-delegation-${profileGrant}-apply`).click();
    await until(() => userRow(PROFILE_EMAIL).first_name === profile0.first_name, 'profile restored', 60000);
    await check('4-profile-restored', JSON.stringify(userRow(PROFILE_EMAIL)) === JSON.stringify(profile0));

    await chapter('4. Resend a customer-created invitation');
    await actor(alice);
    // Free the review seat: deactivate the disposable profile user through its normal user settings.
    async function setActive(email, active) {
      const u = userRow(email); await go('/msp/settings/users');
      await page.locator(`#user-actions-menu-${u.user_id}`).click();
      await page.locator(`#edit-user-menu-item-${u.user_id}`).click(); await page.waitForTimeout(1500);
      const sw = page.getByRole('switch').filter({ visible: true }).first(); await sw.click(); await page.waitForTimeout(400);
      await shot('user-active-' + active); await page.getByRole('button', { name: /^Save/ }).filter({ visible: true }).first().click();
      await until(() => sql(`select is_inactive from users where tenant='${ids.customer}' and user_id='${u.user_id}'`) === (active ? 'f' : 't'), 'user active=' + active, 60000);
    }
    if (sql(`select is_inactive from users where tenant='${ids.customer}' and email='${PROFILE_EMAIL}'`) === 'f') await setActive(PROFILE_EMAIL, false);
    await check('4-profile-user-deactivated-to-free-seat', sql(`select is_inactive from users where tenant='${ids.customer}' and email='${PROFILE_EMAIL}'`) === 't');
    if (!inviteRow(INVITEE_EMAIL)) {
      await createUser('CMReview04', 'Invitee', INVITEE_EMAIL, null);
      await until(() => inviteRow(INVITEE_EMAIL), 'invitation created', 60000);
    }
    const originalMails = await until(async () => { const m = await mails(INVITEE_EMAIL); return m.length ? m : null; }, 'original invitation delivered', 90000);
    const invite0 = inviteRow(INVITEE_EMAIL);
    await check('4-customer-created-invitation-delivered', Boolean(invite0 && !invite0.used_at), { invitationId: invite0.invitation_id, expiresAt: invite0.expires_at, deliveredCount: originalMails.length });
    receipts.invitation0 = { ...invite0, token: sha(String(invite0.token)) }; saveReceipts();
    const iv = await approve('Resend a customer-created invitation', 'invitation_resend', INVITEE_EMAIL, INVITEE_EMAIL);
    const inviteGrant = iv.grant.grant_id;
    await check('4-invitation-grant-binds-one-invitation', iv.grant.target_id === invite0.invitation_id, iv.grant);
    await actor(qa); await qaAdmin();
    const terms = await page.locator('body').innerText();
    await check('4-msp-sees-recipient-role-expiry', terms.includes(INVITEE_EMAIL) && /Role: Technician/.test(terms) && /Expires:/.test(terms)); await shot('4-invitation-terms');
    const beforeMails = await mails(INVITEE_EMAIL); const beforeInvite = inviteRow(INVITEE_EMAIL);
    await page.locator(`#co-delegation-${inviteGrant}-apply`).click();
    const delivered = await until(async () => { const m = await mails(INVITEE_EMAIL); return m.length > beforeMails.length ? m : null; }, 'resend delivered', 90000);
    const afterInvite = inviteRow(INVITEE_EMAIL); const last = delivered.at(-1), firstLink = setupLink(originalMails[0]), lastLink = setupLink(last);
    await check('4-resend-preserves-invitation-record', JSON.stringify(afterInvite) === JSON.stringify(beforeInvite), { expiresAt: afterInvite.expires_at, roleId: afterInvite.role_id, email: afterInvite.email });
    await check('4-delivered-resend-keeps-setup-link', Boolean(lastLink) && lastLink === firstLink, { setupLinkSha256: lastLink && sha(lastLink), deliveredCount: delivered.length, subject: last.subject });
    fs.writeFileSync(dir + '/invitation-delivery.json', JSON.stringify({ invitationId: afterInvite.invitation_id, recipient: afterInvite.email, roleId: afterInvite.role_id, expiresAt: afterInvite.expires_at, tokenSha256: sha(String(afterInvite.token)),
      messages: delivered.map((m) => ({ id: m.id, receivedAt: m.receivedAt, subject: m.subject, setupLinkSha256: setupLink(m) && sha(setupLink(m)) })) }, null, 2));
    await page.reload(); await page.locator(`#co-delegation-${inviteGrant}-apply`).waitFor(); await shot('4-invitation-resent');

    // ---------------- Cleanup: revoke review approvals ----------------
    await chapter('Revoke review approvals and confirm retained state');
    await actor(alice); await revoke(profileGrant); await revoke(inviteGrant);
    await page.reload(); await page.waitForTimeout(1500); await shot('final-customer-approvals');
    await actor(qa); await qaAdmin();
    await check('final-no-review-approval-offered', await page.locator(`#co-delegation-${profileGrant}-apply, #co-delegation-${inviteGrant}-apply`).count() === 0);
    const finalGrants = grants().filter((g) => [boardGrant, profileGrant, inviteGrant].includes(g.grant_id));
    await check('final-review-approvals-revoked', finalGrants.length === 3 && finalGrants.every((g) => g.revoked_at), finalGrants);
    // Restore the seat allocation: revoke the review invitation through Users, then return the allocation.
    const finalInvite = inviteRow(INVITEE_EMAIL); receipts.invitationBeforeRevoke = { ...finalInvite, token: sha(String(finalInvite.token)) }; saveReceipts();
    await actor(alice); await go('/msp/settings/users'); await page.locator(`#revoke-invitation-${finalInvite.invitation_id}`).waitFor({ timeout: 45000 });
    await shot('final-pending-invitation'); await page.locator(`#revoke-invitation-${finalInvite.invitation_id}`).click();
    const confirm = page.getByRole('button', { name: /^(Revoke|Confirm)/ }).filter({ visible: true }); if (await confirm.count()) await confirm.last().click().catch(() => {});
    await until(() => { const x = inviteRow(INVITEE_EMAIL); return !x || x.used_at || new Date(x.expires_at) < new Date(); }, 'invitation revoked', 60000);
    if (seats() !== seats0) await setSeats(seats0);
    await check('final-seat-allocation-restored', seats() === seats0, { seats0, now: seats() });
    Object.assign(receipts, { finalGrants, board: boardRow(boardId), profile: userRow(PROFILE_EMAIL), invitationAfterRevoke: inviteRow(INVITEE_EMAIL) ? { ...inviteRow(INVITEE_EMAIL), token: sha(String(inviteRow(INVITEE_EMAIL).token)) } : null, seats: seats() }); saveReceipts();
    return { status: 'passed', limitations: ['Delivery is proven through the controlled SMTP sink, not a public mail provider.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
