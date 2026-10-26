// Stage C: QA provisions a customer workspace from Co-managed IT, the invited administrator sets a
// password from the delivered invitation and accepts, then creates a native ticket (and, for the
// customer that will depart, tags it through the ticket screen).
const fs = require('fs'), crypto = require('crypto');
const { scenario, credential, sql, until, fixtures, saveFixtures, privateRoot, origin, assert } = require('./runtime.cjs');
const root = process.env.CM_ROOT, key = process.env.CM_CUSTOMER;
const plans = {
  active: { client: 'White Rabbit', workspace: 'White Rabbit IT', first: 'Alice', last: 'Liddell', email: 'alice@whiterabbit.test', ticket: 'White Rabbit printer queue stalled', tag: null },
  departing: { client: 'Kansas Farms', workspace: 'Kansas Farms IT', first: 'Dorothy', last: 'Gale', email: 'admin@kansasfarms.test', ticket: 'Kansas Farms barn Wi-Fi drops', tag: 'Barn network' },
};
const plan = plans[key];
const operation = (w) => JSON.parse(sql(`select row_to_json(o) from (select operation_id,customer_tenant,relationship_id,allocation_id,state,invitation_sent_at from co_managed_provisioning_operations where request->>'workspaceName'='${w}' order by created_at desc limit 1)o`) || 'null');
(async () => {
  const r = await scenario(root, 'c-provision-' + key, async ({ page, ctx, actor, go, check, shot, mark }) => {
    const qa = { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password };
    const credFile = `reprovision-20261025-${key}-admin.json`;
    let op = operation(plan.workspace), cred = fs.existsSync(`${privateRoot}/${credFile}`) ? credential(credFile) : null;
    await actor(qa);
    if (!op) {
      const oz = fixtures().oz;
      let clientId = sql(`select client_id from clients where tenant='${oz}' and client_name='${plan.client}' limit 1`);
      if (clientId) await mark('client-exists', { clientId, note: 'seeded Oz client reused' });
      else {
        await go('/msp/clients'); await page.locator('#create-client-button').click(); await page.locator('#client-name').fill(plan.client);
        await page.locator('#create-view-client-btn').click(); await page.waitForURL(/\/msp\/clients\/[a-f0-9-]+/, { timeout: 90000 });
        clientId = new URL(page.url()).pathname.split('/').at(-1); await mark('client-created', { clientId });
      }
      await go('/msp/co-managed'); await page.locator('#co-managed-create-workspace').click();
      await page.locator('#co-managed-client-search').fill(plan.client); await page.waitForTimeout(800);
      await page.locator('#co-managed-client').click(); await page.getByRole('option', { name: plan.client, exact: true }).click();
      await page.locator('#co-managed-workspace-name').fill(plan.workspace);
      await page.locator('#co-managed-admin-firstName').fill(plan.first); await page.locator('#co-managed-admin-lastName').fill(plan.last);
      await page.locator('#co-managed-admin-email').fill(plan.email); await page.locator('#co-managed-workspace-seats').fill('1');
      await page.locator('#co-managed-escalation-board').click();
      const board = page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first(); await mark('escalation-board', (await board.innerText()).trim()); await board.click();
      await shot('c1-provision-form'); await page.locator('#co-managed-submit-workspace').click();
      op = await until(() => { const o = operation(plan.workspace); return o?.state === 'pending_acceptance' && o.invitation_sent_at ? o : null; }, 'invitation sent', 180000);
      saveFixtures({ [key]: { ...(fixtures()[key] || {}), clientId, operationId: op.operation_id, customer: op.customer_tenant, relationship: op.relationship_id, allocationId: op.allocation_id, workspace: plan.workspace, adminEmail: plan.email } });
      await check('workspace-provisioned-pending-acceptance', true, { operationId: op.operation_id, customer: op.customer_tenant });
    }
    const state = () => sql(`select state from co_management_relationships where tenant='${op.customer_tenant}' and relationship_id='${op.relationship_id}'`);
    if (state() !== 'active') {
      const mails = (await (await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result;
      const mail = mails.filter((m) => m.to?.includes(plan.email)).at(-1); assert.ok(mail, 'administrator invitation delivered');
      const link = mail.text?.match(/(https?:\/\/\S*\/auth\/team\/setup\S*)/) || mail.html?.match(/href="([^"]*\/auth\/team\/setup[^"]*)"/); assert.ok(link, 'setup link');
      const u = new URL(link[1].replaceAll('&amp;', '&')); await ctx.clearCookies(); await page.goto(origin + u.pathname + u.search, { timeout: 120000 });
      cred = { email: plan.email, password: 'CM' + key + '!' + crypto.randomBytes(10).toString('hex'), tenant: op.customer_tenant };
      fs.writeFileSync(`${privateRoot}/${credFile}`, JSON.stringify(cred), { mode: 0o600 });
      await page.locator('#password').fill(cred.password); await page.locator('#confirmPassword').fill(cred.password); await page.locator('#create-team-account-button').click();
      await page.locator('#co-managed-accept-relationship').waitFor({ timeout: 120000 }); await shot('c2-pending-acceptance');
      await page.locator('#co-managed-accept-relationship').click();
      await until(() => state() === 'active', 'relationship active', 90000);
      await check('customer-accepts-relationship', true, { relationship: op.relationship_id });
    }
    const admin = { name: key + '-admin', email: cred.email, password: cred.password };
    await actor(admin); await go('/msp/tickets');
    // A first sign-in is redirected to the workspace setup wizard; wait to see which screen settles.
    await page.locator('#companyAddressLine1').or(page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true })).first().waitFor({ timeout: 120000 });
    if (await page.locator('#companyAddressLine1').count()) {
      await page.locator('#companyAddressLine1').fill('1 Yellow Brick Road'); await page.locator('#companyCity').fill('Emerald City');
      await page.locator('#company-country-picker').click(); await page.getByText('United States', { exact: true }).click();
      await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.waitForTimeout(700);
      for (let i = 0; i < 6; i++) { const skip = page.getByRole('button', { name: 'Skip', exact: true }); if (await skip.count() && await skip.isEnabled()) { await skip.click(); await page.waitForTimeout(500); } else break; }
      const finish = page.getByRole('button', { name: 'Finish Setup', exact: true }); if (await finish.count() && await finish.isEnabled()) { await finish.click(); await page.waitForTimeout(800); }
      await go('/msp/tickets');
    }
    await page.getByRole('heading', { name: 'Ticketing Dashboard', exact: true }).waitFor({ timeout: 90000 });
    let ticket = sql(`select ticket_id from tickets where tenant='${op.customer_tenant}' and title='${plan.ticket}' limit 1`);
    if (!ticket) {
      // On a dev server the dialog chunk compiles on first open; reopen until its title field renders.
      for (let i = 0; i < 6 && !await page.locator('#ticket-quick-add-title').isVisible(); i++) { await page.locator('#add-ticket-button').click(); await page.locator('#ticket-quick-add-title').waitFor({ timeout: 20000 }).catch(() => {}); }
      await page.locator('#ticket-quick-add-title').fill(plan.ticket);
      const pickFirst = async (trigger) => { await page.locator(trigger).click(); const opt = page.locator('[role="option"]:not([aria-disabled="true"])').filter({ visible: true }).first(); await opt.waitFor(); const label = (await opt.innerText()).trim(); await opt.click(); return label; };
      await pickFirst('#ticket-quick-add-client-trigger'); await pickFirst('#ticket-quick-add-board-picker'); await page.waitForTimeout(800);
      if (/Select Status/i.test((await page.locator('#ticket-quick-add').innerText()).trim())) await pickFirst('#ticket-quick-add');
      await shot('c3-quick-add'); await page.locator('#ticket-quick-add-create-open-btn').click();
      await page.waitForURL(/\/msp\/tickets\/[a-f0-9-]{36}/, { timeout: 90000 }); ticket = new URL(page.url()).pathname.split('/').at(-1);
    }
    await check('customer-native-ticket', Boolean(ticket), { ticket, title: plan.ticket });
    if (plan.tag && sql(`select count(*) from tag_mappings m join tag_definitions d on d.tenant=m.tenant and d.tag_id=m.tag_id where m.tenant='${op.customer_tenant}' and m.tagged_id='${ticket}' and d.tag_text='${plan.tag}'`) === '0') {
      await go('/msp/tickets/' + ticket); await page.locator('#ticket-layout-toggle-entry').click(); await page.waitForTimeout(1500);
      await page.locator('#tag-add-button').first().click();
      await page.locator('#tag-save-button').locator('..').locator('input').fill(plan.tag); await page.locator('#tag-save-button').click();
      await until(() => sql(`select count(*) from tag_mappings m join tag_definitions d on d.tenant=m.tenant and d.tag_id=m.tag_id where m.tenant='${op.customer_tenant}' and m.tagged_id='${ticket}' and d.tag_text='${plan.tag}'`) === '1', 'tag on departing ticket');
      await page.reload(); await page.getByText(plan.tag).first().waitFor(); await shot('c4-tagged-ticket');
      await check('existing-tag-added-while-active', true, { tag: plan.tag });
    }
    saveFixtures({ [key]: { ...(fixtures()[key] || {}), ticket, ticketTitle: plan.ticket, tag: plan.tag, credentialFile: credFile, adminEmail: plan.email } });
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
