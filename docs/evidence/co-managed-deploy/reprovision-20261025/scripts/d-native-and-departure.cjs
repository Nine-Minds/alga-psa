// Stage D: QA creates a native Oz ticket, then ends the Kansas Farms relationship through the
// sponsor's departure screen (End co-management).
const { scenario, credential, sql, until, fixtures, saveFixtures } = require('./runtime.cjs');
const root = process.env.CM_ROOT;
(async () => {
  const r = await scenario(root, 'd-native-and-departure', async ({ page, actor, go, check, shot, mark }) => {
    const fx = fixtures(), oz = fx.oz, dep = fx.departing;
    await actor({ name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password });
    const title = 'Oz native switch closet audit';
    let ticket = sql(`select ticket_id from tickets where tenant='${oz}' and title='${title}' limit 1`);
    if (!ticket) {
      await go('/msp/tickets');
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 20000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(title);
      const pickFirst = async (trigger) => { await page.locator(trigger).click(); const opt = page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first(); await opt.waitFor(); const label = (await opt.innerText()).trim(); await opt.click(); return label; };
      const client = await pickFirst('#ticket-quick-add-client-trigger'); const board = await pickFirst('#ticket-quick-add-board-picker'); await page.waitForTimeout(800);
      if (/Select Status/i.test((await page.locator('#ticket-quick-add').innerText()).trim())) await pickFirst('#ticket-quick-add');
      await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 }); ticket = new URL(page.url()).pathname.split('/').at(-1);
      await mark('native-ticket-created', { client, board });
    }
    saveFixtures({ native: { tenant: oz, ticket, ticketTitle: title } });
    await check('native-oz-ticket', Boolean(ticket), { ticket });
    const state = () => sql(`select state from co_management_relationships where tenant='${dep.customer}' and relationship_id='${dep.relationship}'`);
    if (state() !== 'terminated') {
      await go('/msp/co-management/departure?operationId=' + dep.operationId);
      await page.locator('#co-departure-review').click(); await shot('d1-review-departure');
      await page.locator('#co-departure-confirm-confirm').click();
      await until(() => state() === 'terminated', 'relationship closed', 120000);
      await page.locator('#co-departure-refresh').click(); await page.getByText('This co-management relationship has ended.', { exact: false }).waitFor(); await shot('d2-ended');
    }
    const rel = JSON.parse(sql(`select row_to_json(r) from (select relationship_id, state, ended_at from co_management_relationships where tenant='${dep.customer}' and relationship_id='${dep.relationship}') r`));
    saveFixtures({ departing: { ...dep, endedAt: rel.ended_at } });
    await check('departing-relationship-terminated', rel.state === 'terminated' && Boolean(rel.ended_at), rel);
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
