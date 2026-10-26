// Main ticket-screen walkthrough (index.html) — round 7e137086e6, served build 54e75edfab.
// Native Oz ticket control vs the co-managed shared ticket as QA (MSP) and Alice (customer): layouts,
// field/privacy boundaries, native edit/assignment/category, and the read-only (ended) Kansas workspace.
// Real UI only; sql() is read-only. Uses a disposable shared ticket (CM-REVIEW-20261026-00) so concurrent
// guides on fixture ticket 000001 are not disturbed.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, A, OZ, WR, fx, sharedRoute } = require('../../09-time-and-billing/scripts/common.cjs');
const RUN = process.env.CM_RUN || '';
const SFX = 'CM-REVIEW-20261026-00' + (RUN ? '-' + RUN : '');
const TICKET = SFX + ' shared walkthrough ticket', CATEGORY = SFX + ' printers';
const PRIVATE = SFX + ' customer-private note';
const guideDir = path.dirname(__dirname);
const json = (q) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));
const esc = (s) => String(s).replace(/'/g, "''");
const receipts = {};
const receipt = (k, v) => { receipts[k] = v; fs.writeFileSync(path.join(guideDir, 'db-receipts' + (RUN ? '-' + RUN : '') + '.json'), JSON.stringify(receipts, null, 2)); };

(async () => {
  const r = await scenario(guideDir, process.env.CM_SCENARIO || 'recording', async ({ page, actor: login, go: rawGo, mark, check, shot, inspect, chapter }) => {
    // Sign-in can still be redirecting to the dashboard; settle before the first navigation and retry an interrupted one.
    const actor = async (who) => { await login(who); await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500); };
    const go = async (route) => { try { await rawGo(route); } catch (e) { if (!/interrupted/.test(e.message)) throw e; await page.waitForTimeout(2000); await rawGo(route); } };
    const combo = (label) => page.getByRole('combobox').filter({ hasText: new RegExp('^\\s*' + label + '\\s*$') }).filter({ visible: true }).first();
    const pick = async (current, next) => { await until(async () => await combo(current).isEnabled().catch(() => false), current + ' picker ready', 30000); await combo(current).click(); await page.getByRole('option', { name: next, exact: true }).click(); };
    const categoryBox = () => page.locator('[data-automation-id$="-category-picker"], [data-automation-id$="-category-select"]').filter({ visible: true }).getByRole('combobox').first();
    const enabled = async (id) => { const l = page.locator('#' + id).filter({ visible: true }).first(); return (await l.count()) > 0 && await l.isEnabled(); };
    const disabled = async (id) => { const l = page.locator('#' + id).filter({ visible: true }).first(); return (await l.count()) > 0 && await l.isDisabled(); };
    const entry = async () => { await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(900); await page.locator('#ticket-details-info-save-changes-btn').or(page.locator('#ticket-details-conversation-show-comment-editor-btn')).filter({ visible: true }).first().waitFor({ timeout: 60000 }); };
    const grid = async () => { await page.locator('#ticket-layout-toggle-grid').click(); await page.waitForTimeout(900); await page.locator('#ticket-details-bento-hero-status-select').waitFor({ timeout: 60000 }); };
    const row = (id) => json(`select title,status_id,priority_id,category_id,assigned_to,board_id from tickets where tenant='${WR}' and ticket_id='${id}'`)[0];
    const nm = (table, col, idcol, id) => (id ? sql(`select ${col} from ${table} where tenant='${WR}' and ${idcol}='${id}'`) : null);
    const customerOnly = ['ticket-details-delete-ticket-button', 'ticket-details-duplicate-ticket-button', 'ticket-details-quick-invoice-button', 'tag-add-button', 'tag-manager-input-button', 'create-task-from-ticket-button', 'ticket-materials-card-toggle', 'ticket-details-documents-section-documents-upload-btn', 'credentials-screen-new', 'ticket-details-properties-watch-list-toggle', 'ticket-details-checklist-section-toggle', 'co-ticket-revoke'];

    // ------------------------------------------------------------- native control
    await chapter('Native Oz ticket TIC001011 (control): full native MSP controls in Entry and Grid');
    await actor(actors.qa());
    await go('/msp/tickets/' + fx.native.ticket); await entry();
    const nativeEntry = {};
    for (const id of ['ticket-details-delete-ticket-button', 'ticket-details-duplicate-ticket-button', 'ticket-details-quick-invoice-button', 'tag-add-button', 'user-and-team-picker-trigger', 'ticket-details-properties-toggle-contact-picker-btn', 'ticket-details-properties-show-client-picker-btn', 'ticket-details-properties-add-time-entry-btn', 'ticket-details-info-save-changes-btn']) nativeEntry[id] = await enabled(id);
    await check('native-entry-offers-full-native-controls', Object.values(nativeEntry).every(Boolean), nativeEntry);
    await check('native-entry-has-no-co-managed-section', await page.locator('#co-ticket-assignment-change').count() === 0);
    await shot('01-native-entry');
    await grid();
    const nativeGrid = {};
    for (const id of ['ticket-details-bento-hero-status-select', 'ticket-details-bento-hero-priority-select', 'ticket-details-bento-hero-board-select', 'ticket-details-bento-hero-assignee-picker', 'tag-manager-input-button', 'ticket-details-quick-invoice-button']) nativeGrid[id] = await enabled(id);
    await check('native-grid-offers-same-native-controls', Object.values(nativeGrid).every(Boolean), nativeGrid);
    await shot('02-native-grid');
    await entry();

    // ------------------------------------------------------------- customer prep
    await chapter('Customer (Alice) creates a board category and a disposable ticket on the shared Service Desk board');
    await actor(actors.alice());
    const board = sql(`select board_id from boards where tenant='${WR}' and board_name='Service Desk'`);
    let categoryId = sql(`select category_id from categories where tenant='${WR}' and category_name='${esc(CATEGORY)}'`);
    if (!categoryId) {
      await go('/msp/settings?tab=ticketing&section=categories'); await page.locator('#add-category-button').click();
      await page.locator('#quick-add-category-name').fill(CATEGORY);
      const boardSelect = page.getByRole('dialog').getByRole('combobox').filter({ hasText: /Select a board/ }).first();
      await boardSelect.click(); await page.getByRole('option', { name: 'Service Desk', exact: true }).click();
      await shot('03-customer-category'); await page.locator('#quick-add-category-submit').click();
      categoryId = await until(() => sql(`select category_id from categories where tenant='${WR}' and category_name='${esc(CATEGORY)}'`), 'category saved');
    }
    await check('customer-admin-creates-board-category-natively', sql(`select board_id from categories where category_id='${categoryId}'`) === board, { categoryId });
    let ticketId = sql(`select ticket_id from tickets where tenant='${WR}' and title='${esc(TICKET)}'`);
    if (!ticketId) {
      await go('/msp/tickets');
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 15000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(TICKET);
      await page.locator('#ticket-quick-add-client-trigger').click(); await page.getByRole('option', { name: /White Rabbit IT/ }).first().click();
      await page.locator('#ticket-quick-add-board-picker').click(); await page.getByRole('option', { name: /Service Desk/ }).first().click();
      await page.waitForTimeout(800);
      await page.locator('#ticket-quick-add').click(); await page.getByRole('option', { name: 'Open', exact: true }).first().click();
      await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 });
      ticketId = await until(() => sql(`select ticket_id from tickets where tenant='${WR}' and title='${esc(TICKET)}'`), 'ticket saved');
    }
    const before = row(ticketId);
    const baseline = { ...before, status: nm('statuses', 'name', 'status_id', before.status_id), priority: nm('priorities', 'priority_name', 'priority_id', before.priority_id) };
    receipt('baseline', { ticketId, categoryId, baseline });
    await mark('disposable-shared-ticket', { ticketId, baseline, msp: sharedRoute(ticketId), customer: '/msp/tickets/' + ticketId });
    await shot('04-customer-ticket-created');

    // ------------------------------------------------------------- MSP layouts
    await chapter('MSP opens the same authoritative ticket in Entry and Grid');
    await actor(actors.qa());
    await go(sharedRoute(ticketId)); await entry();
    await check('qa-entry-uses-qualified-shared-route', new URL(page.url()).pathname === sharedRoute(ticketId) && (await page.locator('main').innerText()).includes(TICKET));
    await shot('05-qa-shared-entry'); await inspect('05-qa-shared-entry');
    await grid();
    await check('qa-grid-same-ticket-same-values', new URL(page.url()).pathname === sharedRoute(ticketId) && (await page.locator('#ticket-details-bento-hero-status-select').innerText()).includes(baseline.status) && (await page.locator('#ticket-details-bento-hero-priority-select').innerText()).includes(baseline.priority));
    await shot('06-qa-shared-grid');

    // ------------------------------------------------------------- MSP native edit
    await chapter('MSP edits status, priority and category natively; persisted to the customer ticket');
    await entry();
    await pick(baseline.status, 'In Progress'); await pick(baseline.priority, 'Medium');
    await categoryBox().click(); await page.getByText(CATEGORY, { exact: true }).filter({ visible: true }).last().click(); await page.keyboard.press('Escape').catch(() => {});
    await shot('07-qa-edits-before-save');
    await page.locator('#ticket-details-info-save-changes-btn').click();
    await until(() => { const x = row(ticketId); return x.category_id === categoryId && nm('statuses', 'name', 'status_id', x.status_id) === 'In Progress' && nm('priorities', 'priority_name', 'priority_id', x.priority_id) === 'Medium'; }, 'MSP edits persisted', 45000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await entry();
    await check('msp-edits-render-after-reload', await combo('In Progress').count() === 1 && await combo('Medium').count() === 1 && (await categoryBox().innerText()).includes(CATEGORY), { after: row(ticketId) });
    await shot('08-qa-edits-after-reload');

    // ------------------------------------------------------------- MSP assignment
    await chapter('MSP assigns its own technician in the Co-managed section');
    await page.locator('#co-ticket-assignment-change').click(); await page.locator('#co-ticket-assignment-cancel').waitFor();
    await page.locator('#co-ticket-assignment-person').click(); await page.getByRole('option', { name: /^QA Tester/ }).first().click();
    await page.locator('#co-ticket-assignment-save').click(); await page.locator('#co-ticket-assignment-cancel').waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-ticket-assignment-value').waitFor({ timeout: 60000 });
    const mspAssign = json(`select assigned_to,assigned_team_id from co_managed_ticket_references where tenant='${OZ}' and ticket_id='${ticketId}'`);
    await check('msp-assignment-persists-after-reload', (await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester') && mspAssign[0]?.assigned_to === fx.qaId && row(ticketId).assigned_to === before.assigned_to, { mspAssign, customerAssignee: row(ticketId).assigned_to });
    await shot('09-qa-assignment');

    // ------------------------------------------------------------- MSP boundaries
    await chapter('Field and privacy boundaries for the MSP in Entry and Grid');
    await entry();
    const ro = { assignee: await disabled('user-and-team-picker-trigger'), board: await combo('Service Desk').isDisabled(), contact: await disabled('ticket-details-properties-toggle-contact-picker-btn'), client: await disabled('ticket-details-properties-show-client-picker-btn') };
    await check('customer-owned-assignee-board-contact-client-read-only-for-msp', Object.values(ro).every(Boolean), ro);
    const present = []; for (const id of customerOnly) if (await page.locator('#' + id).count()) present.push(id);
    await check('customer-only-actions-and-sections-absent-for-msp', present.length === 0, { checked: customerOnly, present });
    await shot('10-qa-entry-boundaries');
    await grid();
    const gro = { assignee: await disabled('ticket-details-bento-hero-assignee-picker'), board: await disabled('ticket-details-bento-hero-board-select'), status: await enabled('ticket-details-bento-hero-status-select'), priority: await enabled('ticket-details-bento-hero-priority-select') };
    const gtext = await page.locator('main').innerText();
    const gpresent = []; for (const id of customerOnly) if (await page.locator('#' + id).count()) gpresent.push(id);
    await check('grid-enforces-same-authority-and-shows-edited-values', gro.assignee && gro.board && gro.status && gro.priority && gpresent.length === 0 && gtext.includes('In Progress') && gtext.includes('Medium') && gtext.includes(CATEGORY), { ...gro, present: gpresent });
    await shot('11-qa-grid-boundaries');

    // ------------------------------------------------------------- customer view
    await chapter('Customer sees MSP edits and assignment, assigns natively and writes privately');
    await actor(actors.alice());
    await go('/msp/tickets/' + ticketId); await entry();
    const alice = sql(`select user_id from users where tenant='${WR}' and email='alice@whiterabbit.test'`);
    const aliceText = await page.locator('main').innerText();
    await check('customer-native-ticket-shows-msp-edits-and-assignment', aliceText.includes('In Progress') && aliceText.includes('Medium') && aliceText.includes(CATEGORY) && (await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'));
    const custControls = { delete: await enabled('ticket-details-delete-ticket-button'), tags: await enabled('tag-add-button'), assignee: await enabled('user-and-team-picker-trigger'), board: await combo('Service Desk').isEnabled() };
    await check('customer-keeps-native-customer-controls', Object.values(custControls).every(Boolean), custControls);
    await shot('12-customer-sees-msp-edits');
    await page.locator('#user-and-team-picker-trigger').click(); await page.locator('[data-automation-id$="-option-' + alice + '"]').filter({ visible: true }).first().click(); await page.keyboard.press('Escape').catch(() => {});
    await page.locator('#ticket-details-info-save-changes-btn').click();
    await until(() => row(ticketId).assigned_to === alice, 'customer assignee saved');
    await check('customer-assigns-own-technician-natively', row(ticketId).assigned_to === alice);
    if (!Number(sql(`select count(*) from comments where ticket_id='${ticketId}' and note like '%${esc(PRIVATE)}%'`))) {
      await page.locator('#ticket-details-conversation-show-comment-editor-btn').click();
      await page.locator('#ticket-details-conversation-audience-select').click(); await page.getByRole('option', { name: /Private to/ }).click();
      await page.locator('[contenteditable=true]').last().fill(PRIVATE); await page.locator('#ticket-details-conversation-add-comment-btn').click();
    }
    await page.getByText(PRIVATE, { exact: false }).first().waitFor({ timeout: 30000 });
    await shot('13-customer-assigns-and-writes-privately');

    // ------------------------------------------------------------- MSP sees result
    await chapter('MSP sees the customer assignee but not the customer-private note');
    await actor(actors.qa());
    await go(sharedRoute(ticketId)); await entry(); await page.waitForTimeout(1500);
    const qaText = await page.locator('main').innerText();
    await check('msp-sees-customer-assignee-name', (await page.locator('#user-and-team-picker-trigger').innerText()).includes('Alice'));
    await check('msp-cannot-see-customer-private-note', !qaText.includes(PRIVATE));
    await grid(); await page.waitForTimeout(1000);
    await check('msp-grid-also-hides-private-note', !(await page.locator('main').innerText()).includes(PRIVATE));
    await shot('14-msp-after-customer-changes');
    await entry();

    // ------------------------------------------------------------- Kansas read-only
    await chapter('Ended Kansas Farms workspace: read-only check (no mutation attempted)');
    await actor(actors.kansas());
    await go('/msp/co-management'); await page.waitForTimeout(2000);
    const ksCo = await page.locator('main').innerText();
    await mark('kansas-co-management-page', { excerpt: ksCo.slice(0, 600) });
    await shot('15-kansas-co-management');
    await go('/msp/tickets/' + fx.departing.ticket); await page.waitForTimeout(2500);
    if (await page.locator('#ticket-layout-toggle-grid').count()) await grid();
    const ksFields = { status: await disabled('ticket-details-bento-hero-status-select'), priority: await disabled('ticket-details-bento-hero-priority-select'), board: await disabled('ticket-details-bento-hero-board-select'), assignee: await disabled('ticket-details-bento-hero-assignee-picker'), due: await disabled('ticket-details-bento-hero-due-date-picker'), resolve: await disabled('ticket-details-bento-hero-resolve-and-close-button') };
    await check('kansas-ticket-fields-read-only', Object.values(ksFields).every(Boolean), ksFields);
    const ksStillEnabled = {}; for (const id of ['ticket-details-duplicate-ticket-button', 'ticket-details-delete-ticket-button', 'create-task-from-ticket-button', 'ticket-details-quick-invoice-button', 'ticket-details-bento-contact-add', 'ticket-details-bento-materials-add-btn', 'ticket-details-bento-documents-section-add-link', 'ticket-details-bento-external-links-section-add-button', 'add-asset-button', 'ticket-details-bento-hero-title-edit', 'ticket-details-bento-timeline-tile-add-comment-btn']) ksStillEnabled[id] = await enabled(id);
    await mark('kansas-actions-still-offered-not-exercised', ksStillEnabled);
    await shot('16-kansas-grid'); await inspect('16-kansas-grid');
    await entry().catch(() => {}); await shot('17-kansas-entry'); await inspect('17-kansas-entry');
    const ksEntry = { save: await enabled('ticket-details-info-save-changes-btn'), addComment: await enabled('ticket-details-conversation-show-comment-editor-btn') };
    await mark('kansas-entry-controls', ksEntry);
    receipt('kansas', { fields: ksFields, stillEnabled: ksStillEnabled, entry: ksEntry, ticket: json(`select title,status_id,updated_at from tickets where ticket_id='${fx.departing.ticket}'`)[0] });

    // ------------------------------------------------------------- restore
    await chapter('Restore: MSP clears its assignment on the disposable ticket');
    await actor(actors.qa());
    await go(sharedRoute(ticketId)); await entry(); await page.locator('#co-ticket-assignment-value').waitFor();
    await page.locator('#co-ticket-assignment-change').click(); await until(async () => await page.locator('#co-ticket-assignment-clear').isEnabled().catch(() => false), 'clear enabled');
    await page.locator('#co-ticket-assignment-clear').click(); await page.locator('#co-ticket-assignment-cancel').waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); await page.locator('#co-ticket-assignment-value').waitFor();
    await check('msp-assignment-cleared-after-reload', !(await page.locator('#co-ticket-assignment-value').innerText()).includes('QA Tester'));
    await shot('18-restored');
    receipt('final', { ticket: row(ticketId), mspAssignment: json(`select assigned_to from co_managed_ticket_references where tenant='${OZ}' and ticket_id='${ticketId}'`) });
    return { status: 'passed', limitations: ['Uses a disposable shared ticket on the shared Service Desk board instead of fixture 000001 (concurrent guides).', 'No MSP viewer account exists in the reprovisioned data; the read-only comparison uses the ended Kansas Farms workspace.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
