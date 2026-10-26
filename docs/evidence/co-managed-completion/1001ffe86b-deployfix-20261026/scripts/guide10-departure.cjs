// Guide 10 departure on the admitted production build (deploy-fix task 3).
// QA (sponsor Oz): Kansas Farms' Co-managed IT tab and summary show the ended relationship with its end date
// and the Shared work archive, never "not enabled" or setup; White Rabbit stays active (control).
// Kansas Farms admin (ended workspace): access and SLA pages show the ended state, not a load error; Entry and
// Grid offer no write actions; each write the hidden controls would make is refused by the server when posted
// directly, and the workspace's tables are unchanged. Alice's active ticket still offers them (control).
const fs = require('fs'), path = require('path');
const { scenario, sql, build, worktree } = require('./runtime.cjs');
const { actors, json, A, D, KS, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const READ_ONLY = 'This co-managed workspace is read-only. Sign-in, reading, export, and license recovery remain available.';
const KANSAS_CLIENT = D.clientId, WR_CLIENT = A.clientId;
const WRITE_CONTROLS = ['ticket-details-duplicate-ticket-button', 'ticket-details-delete-ticket-button', 'create-task-from-ticket-button',
  'link-ticket-to-task-button', 'ticket-details-quick-invoice-button', 'add-asset-button', 'ticket-details-bento-materials-add-btn',
  'ticket-details-bento-scheduled-work-tile-schedule', 'ticket-details-bento-scheduled-work-tile-schedule-link',
  'ticket-details-bento-calls-emails-tile-log-interaction', 'ticket-details-bento-timeline-tile-add-comment-btn',
  'ticket-details-bento-documents-section-manage-btn', 'ticket-details-bento-documents-section-add-link',
  'ticket-credentials-section-manage-btn', 'ticket-credentials-section-attach-link', 'ticket-details-bento-external-links-section-add-button',
  'ticket-details-bento-contact-add', 'ticket-details-bento-hero-title-edit', 'ticket-details-bento-client-edit', 'tag-manager-input-button',
  'ticket-details-documents-section-documents-new-document-btn', 'ticket-details-documents-section-documents-upload-btn',
  'ticket-details-documents-section-documents-link-documents-btn', 'credentials-screen-link', 'ticket-details-conversation-show-comment-editor-btn'];
const present = (page) => page.evaluate((ids) => ids.filter((id) => { const e = document.getElementById(id); return e && !e.disabled; }), WRITE_CONTROLS);
const layout = async (page, name) => { await page.locator(`#ticket-layout-toggle-${name}`).click(); await page.waitForTimeout(2500); };
const snapshot = () => ({
  tickets: Number(sql(`select count(*) from tickets where tenant='${KS}'`)),
  comments: Number(sql(`select count(*) from comments where tenant='${KS}'`)),
  checklist: Number(sql(`select count(*) from ticket_checklist_items where tenant='${KS}'`)),
  materials: Number(sql(`select count(*) from ticket_materials where tenant='${KS}'`)),
  externalLinks: Number(sql(`select count(*) from external_entity_links where tenant='${KS}'`)),
  invoices: Number(sql(`select count(*) from invoices where tenant='${KS}'`)),
  assetAssociations: Number(sql(`select count(*) from asset_associations where tenant='${KS}'`)),
  interactions: Number(sql(`select count(*) from interactions where tenant='${KS}'`)),
  ticket: json(`select ticket_id, title, status_id, updated_at from tickets where tenant='${KS}' and ticket_id='${D.ticket}'`)[0],
});
function actionIds(names) {
  const manifest = JSON.parse(fs.readFileSync(`${worktree}/server/${build.dist}/server/server-reference-manifest.json`, 'utf8')).node;
  const ids = {};
  for (const [id, v] of Object.entries(manifest)) {
    if (!names.includes(v.exportedName) || ids[v.exportedName]) continue;
    if (Object.keys(v.workers).some((w) => w.startsWith('app/msp/tickets/[id]/page'))) ids[v.exportedName] = id;
  }
  return ids;
}

async function sponsorView() {
  return scenario(root, '10-departure-sponsor', async ({ page, actor, go, check, shot, inspect, chapter }) => {
    const rel = json(`select state, ended_at from co_management_relationships where tenant='${KS}' and relationship_id='${D.relationship}'`)[0];
    await check('kansas-relationship-terminated', rel.state === 'terminated' && Boolean(rel.ended_at), rel);
    await actor(actors.qa());
    await chapter('QA opens Kansas Farms: the Co-managed IT tab shows the ended relationship, not "not enabled"');
    await go(`/msp/clients/${KANSAS_CLIENT}?tab=co-managed`); await page.locator('[id$="-co-managed-ended-on"]').first().waitFor({ timeout: 60000 });
    const tab = await page.evaluate(() => document.body.innerText); await shot('01-kansas-tab'); await inspect('01-kansas-tab');
    await check('kansas-tab-ended-with-date', /Relationship ended/.test(tab) && /Ended \w+ \d+, 2026/.test(await page.locator('[id$="-co-managed-ended-on"]').first().innerText()), { endedOn: await page.locator('[id$="-co-managed-ended-on"]').first().innerText() });
    await check('kansas-tab-not-enabled-and-setup-absent', !tab.includes('Co-managed IT not enabled') && await page.locator('[id$="-co-managed-setup"]').count() === 0);
    await check('kansas-tab-reads-no-live-seat-usage', tab.includes('Seats released') && !/\d+ of \d+ technician seats/.test(tab));
    const archive = page.locator('[id$="-co-managed-history-link"]').first();
    await check('kansas-tab-links-shared-work-archive', (await archive.innerText()).includes('Shared work archive') && await archive.locator('a').getAttribute('href').catch(() => archive.getAttribute('href')) === '/msp/co-managed/archive');
    const summary = await page.locator('[id$="-co-managed-summary"]').first().innerText().catch(() => '');
    await check('kansas-summary-ended-not-enable', /Relationship ended/.test(summary) && /Ended/.test(summary) && !/Enable co-managed IT/.test(summary), { summary });
    await chapter('The Shared work archive opens from the ended relationship');
    await page.getByText('Open Shared work archive').first().click(); await page.waitForURL('**/msp/co-managed/archive', { timeout: 60000 }); await page.waitForTimeout(3000);
    await shot('02-archive'); await check('archive-page-opens', /Shared work archive/i.test(await page.locator('main').innerText()));
    await chapter('Control: White Rabbit IT stays an active relationship');
    await go(`/msp/clients/${WR_CLIENT}?tab=co-managed`); await page.waitForTimeout(4000);
    const wr = await page.evaluate(() => document.body.innerText); await shot('03-white-rabbit-tab');
    await check('white-rabbit-tab-active', /Active/.test(wr) && !/Relationship ended/.test(wr.split('Relationship history')[0]) && await page.locator('[id$="-co-managed-ended-on"]').count() === 0);
    const wrSummary = await page.locator('[id$="-co-managed-summary"]').first().innerText().catch(() => '');
    await check('white-rabbit-summary-active-with-seats-and-manage', /Active/.test(wrSummary) && /\d+ of \d+ technician seats?/.test(wrSummary) && /Manage/.test(wrSummary), { summary: wrSummary });
    await check('white-rabbit-tab-exposes-departure', /End co-management/.test(wr));
    await chapter('Control: a client with no relationship offers Enable and setup');
    await go('/msp/clients/f2334ed4-1c31-4b4d-b771-80edb684b551?tab=co-managed'); await page.locator('[id$="-co-managed-setup"]').first().waitFor({ timeout: 60000 });
    const none = await page.locator('[id$="-co-managed-summary"]').first().innerText().catch(() => ''); await shot('04-no-relationship');
    await check('absent-relationship-offers-enable-and-setup', /not enabled/i.test(none) && /Enable co-managed IT/i.test(none), { summary: none });
  });
}

async function customerView() {
  return scenario(root, '10-departure-ended-workspace', async ({ page, actor, go, check, shot, inspect, chapter, dir, mark }) => {
    await actor(actors.kansas());
    await chapter('Kansas admin: access and SLA pages show the ended state instead of "Could not load access settings"');
    await go('/msp/co-management'); await page.locator('#co-policy-ended').waitFor({ timeout: 60000 });
    const access = await page.locator('main').innerText(); await shot('01-access'); await inspect('01-access');
    await check('access-page-ended-not-load-error', /Co-managed IT ended/.test(access) && !/Could not load access settings/.test(access) && await page.locator('#co-policy-ended-archive').getAttribute('href') === '/msp/co-managed/archive', { text: access.slice(0, 400) });
    await go('/msp/co-management/sla'); await page.locator('#co-sla-ended').waitFor({ timeout: 60000 });
    const sla = await page.locator('main').innerText(); await shot('02-sla');
    await check('sla-page-ended-not-load-error', /Co-managed IT ended/.test(sla) && !/Could not load/.test(sla));

    await chapter('Kansas ticket in Entry and Grid: no Duplicate, Delete, Create Task, Quick invoice or add actions');
    const before = snapshot();
    await go('/msp/tickets/' + D.ticket);
    for (const name of ['entry', 'grid']) {
      await layout(page, name); await shot(`03-${name}`); await inspect(`03-${name}`);
      const found = await present(page); await check(`${name}-offers-no-write-control`, found.length === 0, { found });
    }

    await chapter('Direct writes behind the hidden controls are refused by the server; nothing changes');
    const ids = actionIds(['deleteTicket', 'generateTicketInvoice', 'addChecklistItem', 'addExternalLink', 'addTicketCommentWithCache', 'createComment', 'addTicketMaterial', 'createAssetAssociation', 'addTicket']);
    await mark('server-action-ids', ids);
    const t = before.ticket;
    const attempts = [
      ['generateTicketInvoice', 'Quick invoice', [{ ticketId: D.ticket, timeEntryIds: [], materialIds: [] }]],
      ['addChecklistItem', 'Checklist add', [D.ticket, { item_name: 'Direct write after departure' }]],
      ['addExternalLink', 'External link add', [{ ticket_id: D.ticket, system: 'jira', external_id: 'AFTER-DEPARTURE-1', url: 'https://example.test/after-departure' }]],
      ['addTicketCommentWithCache', 'Comment add', [D.ticket, 'Direct comment after departure', true, false, false, null, null, null, { audienceId: 'organization_private' }]],
      ['createComment', 'Reply/comment create', [{ ticket_id: D.ticket, note: 'Direct note after departure', is_internal: true, is_resolution: false, audienceId: 'organization_private' }]],
      ['addTicketMaterial', 'Material add', [{ ticket_id: D.ticket, client_id: t ? json(`select client_id from tickets where ticket_id='${D.ticket}'`)[0].client_id : null, service_id: '00000000-0000-4000-8000-000000000000', quantity: 1, rate: 100, currency_code: 'USD' }]],
      ['createAssetAssociation', 'Asset add', [{ asset_id: '00000000-0000-4000-8000-000000000000', entity_id: D.ticket, entity_type: 'ticket', relationship_type: 'affected' }]],
    ];
    const results = [];
    for (const [name, control, args] of attempts) {
      if (!ids[name]) { results.push({ action: name, control, skipped: 'no compiled action id on the ticket page' }); continue; }
      const res = await page.evaluate(async ({ id, args }) => {
        const r = await fetch(location.pathname, { method: 'POST', headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' }, body: JSON.stringify(args) });
        return { status: r.status, body: (await r.text()).slice(0, 1500) };
      }, { id: ids[name], args });
      results.push({ action: name, control, actionId: ids[name], ...res, readOnlyMessage: res.body.includes(READ_ONLY) });
    }
    if (ids.addTicket) {
      const fd = { title: 'Duplicate after departure', board_id: t ? json(`select board_id from tickets where ticket_id='${D.ticket}'`)[0].board_id : '', client_id: json(`select client_id from tickets where ticket_id='${D.ticket}'`)[0].client_id,
        status_id: json(`select status_id from tickets where ticket_id='${D.ticket}'`)[0].status_id, priority_id: json(`select priority_id from tickets where ticket_id='${D.ticket}'`)[0].priority_id };
      const res = await page.evaluate(async ({ id, fd }) => {
        const body = new FormData(); body.append('0', JSON.stringify(['$K1']));
        for (const [k, v] of Object.entries(fd)) body.append('1_' + k, v);
        const r = await fetch(location.pathname, { method: 'POST', headers: { 'Next-Action': id, Accept: 'text/x-component' }, body });
        return { status: r.status, body: (await r.text()).slice(0, 1500) };
      }, { id: ids.addTicket, fd });
      results.push({ action: 'addTicket', control: 'Duplicate (creates a ticket)', actionId: ids.addTicket, ...res, readOnlyMessage: res.body.includes(READ_ONLY) });
    }
    // Delete runs last: on the previous build it was not refused and removed the fixture ticket.
    if (ids.deleteTicket) {
      const res = await page.evaluate(async ({ id, args }) => {
        const r = await fetch(location.pathname, { method: 'POST', headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' }, body: JSON.stringify(args) });
        return { status: r.status, body: (await r.text()).slice(0, 1500) };
      }, { id: ids.deleteTicket, args: [D.ticket] });
      results.push({ action: 'deleteTicket', control: 'Delete', actionId: ids.deleteTicket, ...res, readOnlyMessage: res.body.includes(READ_ONLY) });
    }
    fs.writeFileSync(path.join(dir, 'direct-server-action-writes.json'), JSON.stringify(results, null, 2));
    const after = snapshot();
    fs.writeFileSync(path.join(dir, 'db-receipt.json'), JSON.stringify({ build, tenant: KS, ticket: D.ticket, before, after }, null, 2));
    for (const r of results.filter((x) => !x.skipped)) await check(`direct-${r.action}-refused`, r.readOnlyMessage || r.status >= 400 || /actionError|permissionError|error/i.test(r.body), { status: r.status, readOnly: r.readOnlyMessage, body: r.body.slice(0, 240) });
    await check('kansas-tables-unchanged', JSON.stringify(after) === JSON.stringify(before), { before, after });
    await check('read-only-refusals-named', results.filter((r) => r.readOnlyMessage).length >= 4, results.map((r) => [r.action, r.status, r.readOnlyMessage]));

    await chapter('Control: Alice\'s active White Rabbit ticket still offers the same actions');
    await actor(actors.alice()); await go('/msp/tickets/' + A.ticket); await layout(page, 'grid');
    const active = await present(page); await shot('04-active-grid');
    await check('active-grid-offers-write-controls', ['ticket-details-duplicate-ticket-button', 'ticket-details-delete-ticket-button', 'create-task-from-ticket-button', 'ticket-details-quick-invoice-button', 'ticket-details-bento-timeline-tile-add-comment-btn'].every((id) => active.includes(id)), { active });
    return { status: 'passed', limitations: ['Material and asset adds use placeholder ids: Kansas has no services/assets, so those refusals may come from validation before lifecycle admission; the DB snapshot proves nothing was written.'] };
  });
}

(async () => {
  const results = [await sponsorView(), await customerView()];
  fs.writeFileSync(path.join(root, '10-summary.json'), JSON.stringify(results.map((r) => ({ scenario: r.scenario, status: r.scenarioStatus, error: r.error, build: r.build })), null, 2));
  if (results.some((r) => r.scenarioStatus === 'failed')) process.exitCode = 1;
})();
