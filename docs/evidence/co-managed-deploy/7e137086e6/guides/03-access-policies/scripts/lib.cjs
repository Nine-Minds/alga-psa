// Shared UI helpers for guides 03-05 (real product UI only; sql() is used for read-only receipts).
const fs = require('fs'), crypto = require('crypto');
const { credential, sql, until, fixtures, privateRoot, origin } = require('../../scripts/runtime.cjs');

const fx = fixtures();
const PRIORITY = { critical: '6fdf4c04-6d0b-441b-a9bd-368c202f7e72', low: 'eb97b64f-1bf2-4677-9320-9b4865692b89' };
const ids = { msp: fx.oz, customer: fx.active.customer, relationship: fx.active.relationship, client: fx.active.clientId, operation: fx.active.operationId, qaId: fx.qaId };
const qa = { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password };
const alice = { name: 'alice', ...credential('reprovision-20261025-active-admin.json') };
const shared = (ticket) => `/msp/co-management/tickets/${ids.customer}/${ids.relationship}/${ticket}`;
const esc = (s) => String(s).replaceAll("'", "''");
const json = (q) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${q}) x`));

/** Policy/assignment receipt for the active White Rabbit relationship. */
function policyReceipt() {
  return {
    relationship: json(`select visibility_mode, revision, state from co_management_relationships where tenant='${ids.customer}' and relationship_id='${ids.relationship}'`)[0],
    boards: json(`select s.board_id, b.board_name, s.can_collaborate from co_management_board_scopes s join boards b on b.tenant=s.tenant and b.board_id=s.board_id where s.tenant='${ids.customer}' and s.relationship_id='${ids.relationship}' order by b.board_name`),
    projects: json(`select project_id, can_collaborate from co_management_project_scopes where tenant='${ids.customer}' and relationship_id='${ids.relationship}'`),
    staff: json(`select a.principal_type, a.principal_id, coalesce(u.email, t.team_name) as principal, a.relationship_role from co_management_staff_assignments a left join users u on u.tenant=a.tenant and u.user_id=a.principal_id left join teams t on t.tenant=a.tenant and t.team_id=a.principal_id where a.tenant='${ids.msp}' and a.customer_tenant='${ids.customer}' and a.relationship_id='${ids.relationship}' order by 3`),
  };
}

function helpers(page, { mark, check, shot }) {
  async function choose(trigger, name, exact = true) {
    const t = typeof trigger === 'string' ? page.locator(trigger.startsWith('#') ? trigger : '#' + trigger) : trigger;
    await t.click(); await page.getByRole('option', { name, exact }).first().click();
  }
  async function pickFirst(trigger) {
    await page.locator(trigger).click(); const opt = page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first();
    await opt.waitFor(); const label = (await opt.innerText()).trim(); await opt.click(); return label;
  }
  async function savePolicy() {
    await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor({ timeout: 30000 });
  }
  /** Adds a principal/board via the policy panel's search + select + Add, then sets its access level. */
  async function addEntry(kind, id, name, search, access) {
    if (!await page.locator(`#co-policy-${kind}-remove-${id}`).count()) {
      await page.locator(`#co-policy-${kind}-search`).fill(search); await page.waitForTimeout(1200);
      await choose(`#co-policy-${kind}-select`, name); await page.locator(`#co-policy-${kind}-add`).click();
    }
    await choose(`#co-policy-${kind}-access-${id}`, access);
  }
  /** Opens a shared ticket as the current actor and reports whether it rendered. */
  async function openShared(ticket, title) {
    await page.goto(origin + shared(ticket), { waitUntil: 'domcontentloaded', timeout: 120000 });
    const denied = page.getByRole('alert').filter({ hasText: 'This ticket or access list could not be loaded.' });
    const entry = page.getByRole('button', { name: 'Entry', exact: true });
    await denied.or(entry).first().waitFor({ timeout: 60000 });
    if (await denied.count() && await denied.first().isVisible()) { await mark('shared ticket denied', { ticket }); return false; }
    await entry.click(); await page.getByText(title, { exact: true }).filter({ visible: true }).first().waitFor();
    await page.waitForTimeout(1200); await mark('shared ticket readable', { ticket }); return true;
  }
  async function createTicket(title, boardName) {
    await page.goto(origin + '/msp/tickets', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).waitFor({ timeout: 90000 });
    for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 20000 }).catch(() => {}); }
    await page.locator('#ticket-quick-add-title').fill(title);
    await pickFirst('#ticket-quick-add-client-trigger');
    await page.locator('#ticket-quick-add-board-picker').click(); await page.locator('#ticket-quick-add-board-picker-search').fill(boardName); await page.waitForTimeout(600);
    await page.locator('[id^="ticket-quick-add-board-picker-board-picker-board-"]').filter({ hasText: boardName }).first().click(); await page.waitForTimeout(1000);
    if (/Select Status/i.test((await page.locator('#ticket-quick-add').innerText()).trim())) await pickFirst('#ticket-quick-add');
    await shot('quick-add-' + title.split(' ').at(-2)); await page.locator('#ticket-quick-add-create-open-btn').click();
    await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 }); return new URL(page.url()).pathname.split('/').at(-1);
  }
  /** Customer escalation/handback/revoke through the native ticket's co-managed card. */
  async function transition(ticket, button, note) {
    await page.goto(origin + '/msp/tickets/' + ticket, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator(button).waitFor({ timeout: 60000 }); await page.locator(button).click();
    await page.locator('#co-ticket-handoff-note').fill(note); await page.locator('#co-ticket-handoff-submit').click();
    await page.locator('#co-ticket-handoff-note').waitFor({ state: 'detached', timeout: 60000 });
  }
  async function createBoard(name, description) {
    await page.goto(origin + '/msp/settings?tab=ticketing&section=boards', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('#add-board-button').click(); await page.locator('#board_name').fill(name);
    if (description) await page.locator('#description').fill(description);
    await page.locator('#ticket-status-seed-mode-copy-existing').click(); await page.waitForTimeout(500);
    await choose('#copy-ticket-statuses-select', 'Service Desk'); await page.waitForTimeout(1000);
    await shot('board-editor-' + name.split(' ').at(-2)); await page.locator('#save-board-button').click();
    return until(() => sql(`select board_id from boards where tenant='${ids.customer}' and board_name='${esc(name)}'`), 'board created', 60000);
  }
  /** MSP-side priority mapping on the client's Co-managed IT view (prerequisite for customer escalation). */
  const mappingRow = (priorityId) => sql(`select msp_priority_id from co_managed_sla_priority_mappings where tenant='${ids.msp}' and customer_tenant='${ids.customer}' and customer_priority_id='${priorityId}'`);
  async function setSlaMapping(priorityId, label) {
    await page.goto(origin + '/msp/clients/' + ids.client + '?tab=co-managed', { waitUntil: 'domcontentloaded', timeout: 120000 });
    const sel = page.locator(`#co-sla-map-${priorityId}`); await sel.waitFor({ timeout: 60000 }); await sel.click();
    const opt = label ? page.getByRole('option', { name: label, exact: true }).first() : page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).filter({ hasNotText: 'Not mapped' }).first();
    const chosen = (await opt.innerText()).trim(); await opt.click(); await shot('sla-mapping-' + chosen.replace(/\W+/g, '-'));
    await page.locator('#co-sla-save').click(); await page.waitForTimeout(2500);
    return chosen;
  }
  const clientPolicy = () => sql(`select coalesce(sla_policy_id::text,'') from clients where tenant='${ids.msp}' and client_id='${ids.client}'`);
  /** Toggles the White Rabbit client on an existing MSP SLA policy through SLA settings (QA session). */
  async function toggleClientSlaPolicy(policyId) {
    await page.goto(origin + '/msp/co-management/sla?operationId=' + ids.operation, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('#co-sla-settings').click(); await page.waitForURL(/settings/, { timeout: 60000 }); await page.waitForTimeout(2500);
    if (!await page.locator('#add-sla-policy-button').isVisible().catch(() => false)) await page.getByRole('tab', { name: 'Policies' }).or(page.locator('#sla-settings-trigger-1')).first().click();
    await page.locator('#sla-policy-actions-menu-' + policyId).click(); await page.locator('#edit-sla-policy-' + policyId).click();
    await page.locator('#sla-policy-clients').click(); await page.locator('#sla-policy-clients-option-' + ids.client).click(); await page.keyboard.press('Escape');
    await shot('sla-policy-client-toggle'); await page.locator('#sla-policy-save').click();
  }
  /** Temporarily satisfies the MSP escalation prerequisites (client SLA policy + mapping of the given customer
   * priorities to Oz 'P1 - Critical'); returns a restore function that puts back the recorded baseline. */
  async function applyEscalationPrerequisites(policyName, priorities) {
    const before = { mappings: Object.fromEntries(priorities.map((p) => [p, mappingRow(p) || ''])), clientPolicy: clientPolicy() };
    const policyId = sql(`select sla_policy_id from sla_policies where tenant='${ids.msp}' and policy_name='${esc(policyName)}'`);
    await mark('escalation prerequisites before', { ...before, policyId });
    if (!before.clientPolicy) { await toggleClientSlaPolicy(policyId); await until(() => clientPolicy() === policyId, 'client SLA policy assigned', 60000); }
    for (const p of priorities) if (!before.mappings[p]) { await setSlaMapping(p, 'P1 - Critical'); await until(() => mappingRow(p), 'priority mapped', 30000); }
    await mark('escalation prerequisites applied', { mappings: priorities.map((p) => mappingRow(p)), clientPolicy: clientPolicy() });
    return async () => {
      for (const p of priorities) if (!before.mappings[p] && mappingRow(p)) { await setSlaMapping(p, 'Not mapped'); await until(() => !mappingRow(p), 'mapping restored', 30000); }
      if (!before.clientPolicy && clientPolicy()) { await toggleClientSlaPolicy(policyId); await until(() => clientPolicy() === '', 'client SLA policy unassigned', 60000); }
      const after = { mappings: Object.fromEntries(priorities.map((p) => [p, mappingRow(p) || ''])), clientPolicy: clientPolicy() };
      await mark('escalation prerequisites restored', { before, after }); return { before, after };
    };
  }
  return { choose, pickFirst, savePolicy, addEntry, openShared, createTicket, transition, createBoard, setSlaMapping, mappingRow, clientPolicy, toggleClientSlaPolicy, applyEscalationPrerequisites };
}

function saveCredential(file, value) {
  fs.writeFileSync(`${privateRoot}/${file}`, JSON.stringify(value), { mode: 0o600 });
}
const newPassword = (tag) => 'CmReview' + tag + '!' + crypto.randomBytes(9).toString('hex');

module.exports = { PRIORITY, ids, qa, alice, shared, esc, json, policyReceipt, helpers, saveCredential, newPassword, sql, until, origin, privateRoot, credential };
