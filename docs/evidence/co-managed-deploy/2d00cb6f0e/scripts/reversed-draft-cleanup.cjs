// Finishes scenario 02's cleanup after its entry-deletion step (both entries were already removed):
// terminate the disposable contract, delete the approver team, clear the disposable client's billing email.
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, OZ } = require('./common.cjs');
const CLIENT = 'a67a50b5-6689-479b-9ef8-9072e993c175', CONTRACT = 'LATE-2D00 reopen contract (disposable)', TEAM = 'LATE-2D00 reopen approvers (disposable)';
const contract = () => json(`select cc.is_active from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
const team = () => json(`select team_id from teams where tenant='${OZ}' and team_name='${TEAM}'`)[0];
const billingEmail = () => sql(`select coalesce(billing_email,'') from clients where client_id='${CLIENT}'`);
(async () => {
  const r = await scenario(process.env.CM_ROOT, '02b-reversed-draft-cleanup', async ({ page, actor, go, check, chapter, dir }) => {
    await actor(actors.qa()); await chapter('Terminate the disposable contract, delete the team, clear the billing email');
    if (contract().is_active) {
      await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
      const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
      await crow.locator('#contract-actions-menu').click(); await page.locator('#terminate-contract-menu-item').click();
      await page.locator('#client-contracts-tab-terminate-confirmation-confirm').click(); await until(() => contract().is_active === false, 'terminated', 60000);
    }
    if (team()) { await go('/msp/settings?tab=teams'); await page.locator(`#delete-team-${team().team_id}-btn`).click(); await page.waitForTimeout(800);
      const d = page.locator('[role=alertdialog],[role=dialog]').last(); await d.getByRole('button', { name: /delete|confirm|yes/i }).last().click(); await until(() => !team(), 'team deleted', 30000); }
    if (billingEmail()) { await go(`/msp/clients/${CLIENT}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
      await page.locator('#client-billing-email-input').fill(''); await page.locator('#save-billing-config-btn').click(); await until(() => billingEmail() === '', 'email cleared', 30000).catch(() => {}); }
    const after = { contract: contract(), team: team() || null, billingEmail: billingEmail(),
      entries: json(`select entry_id from time_entries where tenant='${OZ}' and notes like 'LATE-2D00-REOPEN%'`), invoices: json(`select invoice_id from invoices where tenant='${OZ}' and client_id='${CLIENT}'`) };
    fs.writeFileSync(path.join(dir, 'db-after.json'), JSON.stringify(after, null, 2));
    await check('cleanup-complete', after.contract.is_active === false && !after.team && after.entries.length === 0 && after.invoices.length === 0, after);
    return { status: 'passed', limitations: after.billingEmail ? ['billing email not cleared'] : [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
