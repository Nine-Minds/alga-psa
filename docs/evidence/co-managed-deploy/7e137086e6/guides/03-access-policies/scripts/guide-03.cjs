// Guide 03 (Access policies) walkthrough on the active White Rabbit relationship.
// All product actions go through the real UI; sql() is read-only (before/after receipts and waits).
const fs = require('fs'), path = require('path');
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('./lib.cjs');
const { ids, qa, alice, sql, until, origin, esc, json, policyReceipt } = L;

const SUFFIX = 'CM-REVIEW-20261026-03';
const BOARD = `${SUFFIX} Access board`;
const RUN = process.env.CM_RUN ? ` ${process.env.CM_RUN}` : '';
const T1 = `${SUFFIX}${RUN} escalated board ticket`, T2 = `${SUFFIX}${RUN} board-only ticket`;
const VIEWER_FILE = 'cm-review-20261026-03-viewer.json';
const viewerEmail = 'cm-review-20261026-03-viewer@emeraldcity.oz';
const root = path.resolve(__dirname, '..');
const name = process.env.CM_SCENARIO || 'recording';

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const h = L.helpers(page, { mark, check, shot });
    const receipts = {}; const receipt = (k) => { receipts[k] = { at: new Date().toISOString(), ...policyReceipt() }; fs.writeFileSync(dir + '/db-receipts.json', JSON.stringify(receipts, null, 2)); };
    const ticketId = (title) => sql(`select ticket_id from tickets where tenant='${ids.customer}' and title='${esc(title)}' limit 1`);
    const work = (t) => json(`select responsibility, grant_revoked_at, can_collaborate from co_management_ticket_work where tenant='${ids.customer}' and relationship_id='${ids.relationship}' and ticket_id='${t}'`)[0] || null;
    receipt('baseline');
    const baseline = receipts.baseline;
    await mark('baseline policy', baseline);

    // ---------------- Preparation (real UI) ----------------
    await chapter('Preparation: disposable board, tickets and viewer principal');
    await actor(alice);
    let boardId = sql(`select board_id from boards where tenant='${ids.customer}' and board_name='${esc(BOARD)}'`);
    if (!boardId) boardId = await h.createBoard(BOARD, 'Disposable board for access-policy review');
    await check('prep-disposable-board', Boolean(boardId), { boardId, name: BOARD });
    const tickets = {};
    for (const title of [T1, T2]) tickets[title] = ticketId(title) || await h.createTicket(title, BOARD);
    await check('prep-disposable-tickets', Object.values(tickets).every(Boolean), tickets);
    const t1 = tickets[T1], t2 = tickets[T2];
    for (const t of [t1, t2]) if (work(t)?.responsibility === 'msp') throw Error('disposable ticket unexpectedly escalated before the run: ' + t);

    let viewer;
    if (fs.existsSync(`${L.privateRoot}/${VIEWER_FILE}`)) viewer = { name: 'viewer', ...L.credential(VIEWER_FILE) };
    if (!sql(`select user_id from users where tenant='${ids.msp}' and email='${viewerEmail}'`)) {
      await actor(qa); await go('/msp/settings/users');
      await page.locator('#create-new-msp-user-btn').click(); await page.locator('#first-name').fill('CMReview03'); await page.locator('#last-name').fill('Viewer');
      await page.locator('#email').fill(viewerEmail);
      const role = page.locator('label', { hasText: 'Primary Role' }).locator('..').getByRole('combobox').first();
      await role.click(); await page.getByRole('option', { name: 'Technician', exact: true }).click();
      viewer = { name: 'viewer', email: viewerEmail, password: L.newPassword('03') };
      L.saveCredential(VIEWER_FILE, { email: viewer.email, password: viewer.password });
      await page.locator('#password').fill(viewer.password); await shot('prep-create-viewer');
      await page.locator('#submit-new-msp-user-btn').click();
      await until(() => sql(`select user_id from users where tenant='${ids.msp}' and email='${viewerEmail}'`), 'viewer user created', 60000);
    }
    const viewerId = sql(`select user_id from users where tenant='${ids.msp}' and email='${viewerEmail}'`);
    await check('prep-viewer-principal', Boolean(viewerId && viewer), { viewerId, email: viewerEmail, role: sql(`select string_agg(r.role_name, ',') from user_roles ur join roles r on r.tenant=ur.tenant and r.role_id=ur.role_id where ur.tenant='${ids.msp}' and ur.user_id='${viewerId}'`) });

    // ---------------- 1. Customer controls board and project scope ----------------
    await chapter('1. Customer controls board and project scope');
    await actor(alice); await go('/msp/co-management'); await page.locator('#co-policy-visibility').waitFor();
    await page.locator('#co-policy-visibility').click(); await page.waitForTimeout(500);
    const modes = (await page.getByRole('option').allInnerTexts()).map((s) => s.trim()); await shot('1-visibility-options'); await page.keyboard.press('Escape');
    await check('1-proposed-ticket-access-modes', modes.some((m) => /Escalated tickets only/.test(m)) && modes.some((m) => /Oversight/.test(m)), { modes });
    await check('1-projects-configured-separately', await page.locator('#co-policy-project-search').count() === 1 && await page.locator('#co-policy-board-search').count() === 1);
    await h.addEntry('board', boardId, BOARD, SUFFIX, 'View'); await shot('1-board-added-view'); await h.savePolicy();
    await page.reload(); await page.locator(`#co-policy-board-access-${boardId}`).waitFor();
    await check('1-board-view-persists-after-reload', (await page.locator(`#co-policy-board-access-${boardId}`).innerText()).includes('View') &&
      sql(`select can_collaborate from co_management_board_scopes where tenant='${ids.customer}' and relationship_id='${ids.relationship}' and board_id='${boardId}'`) === 'f');
    await shot('1-board-view-reloaded'); receipt('after-1-board-view');

    // ---------------- 2. MSP assigns its own people ----------------
    await chapter('2. MSP assigns its own people');
    await actor(viewer);
    await check('2-unassigned-principal-denied-by-url', !await h.openShared(t2, T2)); await shot('2-unassigned-viewer-denied');
    const qaAssigned = baseline.staff.some((s) => s.principal_id === ids.qaId);
    await actor(qa);
    if (!qaAssigned) { await check('2-unassigned-qa-denied-by-url', !await h.openShared(t2, T2)); }
    await go('/msp/clients/' + ids.client + '?tab=co-managed'); await page.locator('#co-policy-user-search').waitFor();
    await shot('2-staff-before');
    await h.addEntry('user', ids.qaId, 'QA Tester', 'QA', 'Collaborate');
    await h.addEntry('user', viewerId, 'CMReview03 Viewer', 'CMReview03', 'View');
    await shot('2-staff-chosen'); await h.savePolicy();
    await page.reload(); await page.locator(`#co-policy-user-access-${viewerId}`).waitFor();
    const staffNow = policyReceipt().staff;
    await check('2-staff-assignments-persist-after-reload', (await page.locator(`#co-policy-user-access-${ids.qaId}`).innerText()).includes('Collaborate') &&
      (await page.locator(`#co-policy-user-access-${viewerId}`).innerText()).includes('View') &&
      staffNow.find((s) => s.principal_id === ids.qaId)?.relationship_role === 'technician' && staffNow.find((s) => s.principal_id === viewerId)?.relationship_role === 'viewer', staffNow);
    await shot('2-staff-reloaded'); receipt('after-2-staff');
    // Intersection: technician assignment + customer View board = read-only.
    await check('2-assigned-technician-reads-approved-board', await h.openShared(t2, T2));
    await check('2-customer-view-scope-limits-technician-to-read-only', await page.locator('#ticket-details-info-save-changes-btn').count() === 0, { readOnlyBanner: await page.locator('#co-ticket-read-only').count() });
    await shot('2-technician-view-scope-readonly');
    // Customer-private note.
    await actor(alice); await go('/msp/tickets/' + t2); await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1200);
    const privateText = `${SUFFIX} customer-private note ${Date.now()}`;
    const show = page.locator('button[id$=-show-comment-editor-btn]'); if (await show.count()) await show.first().click();
    await page.locator('#ticket-details-conversation-audience-select').waitFor();
    await page.locator('#ticket-details-conversation-audience-select').click(); await page.getByRole('option', { name: /Private to/ }).first().click();
    await page.locator('[contenteditable=true]').last().fill(privateText); await page.locator('#ticket-details-conversation-add-comment-btn').click();
    await page.getByText(privateText, { exact: true }).first().waitFor(); await page.reload(); await page.getByText(privateText, { exact: true }).first().waitFor({ timeout: 45000 });
    await check('2-customer-private-note-saved', true, { privateText }); await shot('2-customer-private-note');
    await actor(qa); await h.openShared(t2, T2); await page.waitForTimeout(1500);
    await check('2-customer-private-note-hidden-from-assigned-technician', !(await page.locator('body').innerText()).includes(privateText)); await shot('2-technician-no-private-note');

    // ---------------- 1 (continued). Escalation-only vs board oversight ----------------
    await chapter('1. Escalated tickets only versus board oversight');
    const originalMode = baseline.relationship.visibility_mode;
    const modeLabel = modes.find((m) => /Oversight/.test(m));
    // Escalation needs an MSP SLA policy for the client and a mapping for the ticket's priority (Critical);
    // guide 08's existing disposable policy is assigned only for the escalation below, then restored.
    await actor(qa); const restorePrereqs = await h.applyEscalationPrerequisites('CM-REVIEW-20261026-08 final-b MSP policy', [L.PRIORITY.critical]);
    // Escalation-only removes every board grant (the editor clears boards in that mode), so this window is kept short
    // and the baseline boards plus the disposable board are re-added when oversight is restored.
    const boardsBeforeNarrow = policyReceipt().boards;
    await actor(alice); await go('/msp/co-management'); await page.locator('#co-policy-visibility').waitFor();
    await h.choose('#co-policy-visibility', 'Escalated tickets only'); await h.savePolicy(); const narrowedAt = new Date().toISOString();
    await page.reload(); await page.locator('#co-policy-visibility').waitFor();
    await check('1-escalation-only-persists', (await page.locator('#co-policy-visibility').innerText()).includes('Escalated tickets only') && policyReceipt().relationship.visibility_mode === 'escalation_only', { narrowedAt });
    receipt('escalation-only');
    await actor(qa);
    await check('1-escalation-only-hides-unescalated-board-ticket', !await h.openShared(t1, T1));
    await check('1-technician-assignment-cannot-expand-customer-scope', !await h.openShared(t2, T2)); await shot('1-escalation-only-denied');
    await actor(alice); await h.transition(t1, '#co-ticket-escalate', `${SUFFIX} escalate for explicit access`);
    await check('1-customer-escalates-through-native-ticket', work(t1)?.responsibility === 'msp', work(t1));
    await actor(qa);
    await check('1-escalated-ticket-now-available', await h.openShared(t1, T1)); await shot('1-escalated-readable');
    await check('1-unescalated-sibling-still-unavailable', !await h.openShared(t2, T2));
    await actor(alice); await go('/msp/co-management'); await page.locator('#co-policy-visibility').waitFor();
    await h.choose('#co-policy-visibility', modeLabel);
    for (const b of boardsBeforeNarrow) await h.addEntry('board', b.board_id, b.board_name, b.board_name, b.can_collaborate ? 'Collaborate' : 'View');
    await h.savePolicy(); const restoredAt = new Date().toISOString();
    await page.reload(); await page.locator('#co-policy-visibility').waitFor();
    const afterRestore = policyReceipt();
    await check('1-board-oversight-and-boards-restored', afterRestore.relationship.visibility_mode === originalMode && JSON.stringify(afterRestore.boards) === JSON.stringify(boardsBeforeNarrow), { originalMode, narrowedAt, restoredAt, boards: afterRestore.boards });
    receipt('mode-restored');
    await actor(qa); receipts.prereqRestore = await restorePrereqs();
    await check('1-escalation-prerequisites-restored', JSON.stringify(receipts.prereqRestore.after) === JSON.stringify(receipts.prereqRestore.before), receipts.prereqRestore);
    await actor(qa);
    await check('1-board-oversight-reopens-unescalated-ticket', await h.openShared(t2, T2)); await shot('1-board-oversight-readable');

    // ---------------- 3. Viewer vs technician ----------------
    await chapter('3. Compare a viewer with a technician');
    await actor(alice); await go('/msp/co-management'); await page.locator(`#co-policy-board-access-${boardId}`).waitFor();
    await h.choose(`#co-policy-board-access-${boardId}`, 'Collaborate'); await h.savePolicy();
    await check('3-board-collaborate-saved', sql(`select can_collaborate from co_management_board_scopes where tenant='${ids.customer}' and relationship_id='${ids.relationship}' and board_id='${boardId}'`) === 't');
    receipt('board-collaborate');
    const categoryBox = () => page.getByRole('heading', { name: 'Category', exact: true }).locator('..').getByRole('combobox').first();
    const statusBox = () => page.getByRole('heading', { name: 'Status', exact: true }).locator('..').getByRole('combobox').first();
    await actor(qa); await h.openShared(t2, T2);
    await check('3-technician-entry-category-enabled', !await categoryBox().isDisabled());
    await check('3-shared-ticket-has-no-tags', await page.locator('#tag-add-button').count() === 0);
    const statusBefore = (await statusBox().innerText()).trim();
    await statusBox().click(); await page.getByRole('option', { name: 'In Progress', exact: true }).first().click();
    await page.locator('#ticket-details-info-save-changes-btn').click();
    await until(() => sql(`select s.name from tickets t join statuses s on s.tenant=t.tenant and s.status_id=t.status_id where t.tenant='${ids.customer}' and t.ticket_id='${t2}'`) === 'In Progress', 'technician status edit persisted', 60000);
    await page.reload(); await page.getByRole('button', { name: 'Entry', exact: true }).click(); await page.waitForTimeout(1500);
    await check('3-technician-edit-persists-after-reload', (await statusBox().innerText()).includes('In Progress'), { statusBefore });
    await shot('3-technician-entry-edited');
    // Category picker: shared tickets must not offer category creation.
    await categoryBox().click(); await page.waitForTimeout(800); const catText = await page.locator('body').innerText(); await shot('3-technician-category-picker'); await page.keyboard.press('Escape');
    await check('3-shared-category-creation-absent', !/Add new category|Create category|\+ Add category/i.test(catText));
    const gridStatus = () => page.locator('#ticket-details-bento-hero-status-select');
    const gridCategory = () => page.locator('#ticket-details-bento-hero-category-select').locator('xpath=descendant-or-self::button').first();
    await page.getByRole('button', { name: 'Grid', exact: true }).click(); await gridStatus().waitFor(); await page.waitForTimeout(4000); await shot('3-technician-grid');
    const techGrid = { status: (await gridStatus().innerText()).trim(), statusDisabled: await gridStatus().isDisabled(), categoryDisabled: await gridCategory().isDisabled().catch(() => 'not found'), tags: await page.locator('[id*="tag-add"]').count() };
    await check('3-technician-grid-offers-edit-and-shows-persisted-status', !techGrid.statusDisabled && techGrid.status.includes('In Progress') && techGrid.tags === 0, techGrid);
    await actor(viewer); await h.openShared(t2, T2);
    await check('3-viewer-entry-category-disabled', await categoryBox().isDisabled());
    await check('3-viewer-entry-status-readable', (await page.locator('body').innerText()).includes('In Progress'));
    await check('3-viewer-entry-no-save-bar', await page.locator('#ticket-details-info-save-changes-btn').count() === 0); await shot('3-viewer-entry');
    await page.getByRole('button', { name: 'Grid', exact: true }).click(); await gridStatus().waitFor(); await page.waitForTimeout(4000);
    const viewerGrid = { status: (await gridStatus().innerText()).trim(), statusDisabled: await gridStatus().isDisabled(), categoryDisabled: await gridCategory().isDisabled().catch(() => 'not found') };
    await check('3-viewer-grid-status-readable-and-locked', viewerGrid.statusDisabled && viewerGrid.status.includes('In Progress') && viewerGrid.categoryDisabled === true, viewerGrid);
    await check('3-viewer-grid-no-save-bar', await page.locator('#ticket-details-info-save-changes-btn').count() === 0); await shot('3-viewer-grid');
    await mark('grid category parity observation', { technicianGridCategoryDisabled: techGrid.categoryDisabled, technicianEntryCategoryEnabled: true });
    // Attachment captured on T1 by the technician (shared audience) for the revocation check.
    await actor(qa); await h.openShared(t1, T1);
    const showQa = page.locator('button[id$=-show-comment-editor-btn]'); if (await showQa.count()) await showQa.first().click();
    await page.locator('#ticket-details-conversation-audience-select').click(); await page.getByRole('option', { name: 'Shared IT teams', exact: true }).click();
    const fileText = `${SUFFIX} shared attachment ${Date.now()}`, fileName = `cm-review-20261026-03-${Date.now()}.txt`, bytes = Buffer.from(fileText + '\n');
    await page.locator('[contenteditable=true]').last().fill(fileText);
    await page.locator('#co-shared-comment-files').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: bytes });
    await page.locator('#ticket-details-conversation-add-comment-btn').click(); await page.getByText(fileText, { exact: true }).first().waitFor({ timeout: 60000 });
    const link = page.getByRole('link', { name: fileName, exact: true }); await link.waitFor(); const href = await link.getAttribute('href');
    const before = await ctx.request.get(origin + href);
    await check('3-technician-attachment-downloadable-before-revocation', before.ok() && (await before.body()).equals(bytes), { status: before.status(), href });
    await shot('3-attachment-posted');

    // ---------------- 4. Revoke the right grant ----------------
    await chapter('4. Revoke the right grant');
    await actor(qa); await go('/msp/tickets/customer?queueView=oversight&workspace=all');
    await page.locator('#customer-tickets-search').fill(SUFFIX + RUN); await page.locator('#customer-tickets-search').press('Enter');
    await until(async () => await page.locator('tbody tr', { hasText: SUFFIX + RUN }).count() === 2, 'both disposable tickets in oversight', 45000);
    await check('4-oversight-lists-both-before-revocation', true); await shot('4-oversight-before');
    await actor(alice); await go('/msp/co-management/ticket-access');
    await page.locator(`#co-grant-revoke-${t1}`).waitFor(); await shot('4-ticket-access-before');
    await check('4-board-only-ticket-has-no-explicit-grant', await page.locator(`#co-grant-revoke-${t2}`).count() === 0);
    await page.locator(`#co-grant-revoke-${t1}`).click(); await page.locator('#co-handoff-note').fill(`${SUFFIX} revoke individual ticket access`);
    await page.locator('#co-handoff-submit').click();
    await until(() => work(t1)?.grant_revoked_at, 'explicit grant revoked', 60000);
    await page.reload(); await page.locator('#co-grants-next').waitFor(); await page.waitForTimeout(1500);
    await check('4-revoked-grant-gone-on-reopen', await page.locator(`#co-grant-revoke-${t1}`).count() === 0, work(t1)); await shot('4-ticket-access-after');
    await actor(qa);
    await check('4-independent-board-grant-still-allows-read', await h.openShared(t1, T1)); await shot('4-board-grant-still-reads');
    await actor(alice); await go('/msp/co-management'); await page.locator(`#co-policy-board-remove-${boardId}`).waitFor();
    await page.locator(`#co-policy-board-remove-${boardId}`).click(); await h.savePolicy(); await page.reload(); await page.locator('#co-policy-visibility').waitFor(); await page.waitForTimeout(1200);
    await check('4-disposable-board-scope-removed', await page.locator(`#co-policy-board-access-${boardId}`).count() === 0 && !policyReceipt().boards.some((b) => b.board_id === boardId));
    receipt('board-removed');
    await actor(qa);
    await check('4-old-url-denied-after-last-grant-removed', !await h.openShared(t1, T1)); await shot('4-old-url-denied');
    await check('4-board-only-ticket-denied', !await h.openShared(t2, T2));
    const after = await ctx.request.get(origin + href);
    await check('4-captured-attachment-link-denied', !after.ok(), { status: after.status() });
    await go('/msp/tickets/customer?queueView=oversight&workspace=all');
    await page.locator('#customer-tickets-search').fill(SUFFIX + RUN); await page.locator('#customer-tickets-search').press('Enter'); await page.waitForTimeout(3500);
    await check('4-fresh-list-excludes-revoked-work', await page.locator('tbody tr', { hasText: SUFFIX + RUN }).count() === 0); await shot('4-oversight-after');
    await page.locator('#customer-tickets-share').click(); const pending = page.waitForEvent('download'); await page.locator('#customer-tickets-export').click();
    await (await pending).saveAs(dir + '/oversight-after-revocation.csv'); await page.keyboard.press('Escape');
    const csv = fs.readFileSync(dir + '/oversight-after-revocation.csv', 'utf8');
    await check('4-fresh-export-excludes-revoked-work', !csv.includes(T1) && !csv.includes(T2), { csvBytes: csv.length });

    // ---------------- Restore ----------------
    await chapter('Restore reviewed access');
    await actor(qa); await go('/msp/clients/' + ids.client + '?tab=co-managed'); await page.locator(`#co-policy-user-remove-${viewerId}`).waitFor();
    await page.locator(`#co-policy-user-remove-${viewerId}`).click(); await h.savePolicy(); await page.reload(); await page.locator('#co-policy-user-search').waitFor();
    receipt('final');
    const fin = receipts.final;
    // Other reviewers change project scope and staff concurrently, so compare only what this run touched.
    const sd = (x) => JSON.stringify(x.boards.filter((b) => b.board_id !== boardId));
    await check('restore-customer-scope-matches-baseline', !fin.boards.some((b) => b.board_id === boardId) && sd(fin) === sd(baseline) && fin.relationship.visibility_mode === baseline.relationship.visibility_mode, { baseline: baseline.boards, final: fin.boards, mode: fin.relationship.visibility_mode });
    await check('restore-qa-assignment-unchanged-from-baseline', (fin.staff.find((s) => s.principal_id === ids.qaId)?.relationship_role || null) === (baseline.staff.find((s) => s.principal_id === ids.qaId)?.relationship_role || 'technician'), fin.staff);
    await check('restore-viewer-assignment-removed', !fin.staff.some((s) => s.principal_id === viewerId), fin.staff);
    await shot('restore-final-staff');
    return {
      status: 'partial',
      limitations: [
        'Field visibility limits: no operator-prepared restricted field policy exists in this environment, so shared field redaction was not exercised.',
        `QA's technician staff assignment was ${qaAssigned ? 'already present' : 'absent in the baseline (the brief describes it as a fixture)'}; it was ${qaAssigned ? 'kept' : 'added through section 2 and intentionally left in place as the documented fixture state'}.`,
        'The temporary viewer principal was created through Settings > Users because noassign@emeraldcity.oz does not exist in the rebuilt Oz tenant.',
      ],
    };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
