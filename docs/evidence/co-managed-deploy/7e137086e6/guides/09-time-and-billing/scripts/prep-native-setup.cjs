// Guide 09 preparation through the native UI only (recorded): the briefed QA co-managed technician
// assignment (absent in the reprovisioned data), a current Oz time period, and a White Rabbit hourly contract.
// Idempotent: each step is skipped when its record already exists. Read-only SELECTs are receipts only.
const fs = require('fs');
const { scenario, sql, until } = require('../../scripts/runtime.cjs');
const { actors, A, OZ, WR, fx } = require('./common.cjs');
const SUFFIX = 'CM-REVIEW-20261026-09';
const CONTRACT = SUFFIX + ' hourly contract';
const typeDate = async (page, sel, value) => { const box = page.locator(sel).getByRole('combobox').first().or(page.locator(sel)).first(); await box.click(); await box.press('Control+A'); await box.pressSequentially(value); await box.press('Tab'); };
(async () => {
  const r = await scenario(__dirname + '/..', process.env.CM_SCENARIO || 'prep-native-setup', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const receipts = { before: {}, after: {} };
    const assignments = () => JSON.parse(sql(`select coalesce(json_agg(a),'[]') from (select principal_type,principal_id,relationship_role from co_management_staff_assignments where tenant='${OZ}' and customer_tenant='${WR}') a`));
    const periods = () => JSON.parse(sql(`select coalesce(json_agg(p order by start_date),'[]') from (select period_id,start_date,end_date from time_periods where tenant='${OZ}') p`));
    const contract = () => JSON.parse(sql(`select coalesce(json_agg(c),'[]') from (select c.contract_id,c.contract_name,c.status,cc.client_contract_id,cc.client_id,cc.is_active,cc.start_date from contracts c left join client_contracts cc on cc.tenant=c.tenant and cc.contract_id=c.contract_id where c.tenant='${OZ}' and c.contract_name='${CONTRACT}') c`));
    receipts.before = { assignments: assignments(), periods: periods(), contract: contract() };
    await mark('before', receipts.before);
    await actor(actors.qa());

    await chapter('Prep 1: MSP assigns QA as a co-managed technician (client Co-managed IT view)');
    await go(`/msp/clients/${A.clientId}?tab=co-managed`);
    await page.locator('#co-policy-user-search').waitFor();
    await shot('01-staff-before');
    if (!assignments().some((a) => a.principal_id === fx.qaId)) {
      await page.locator('#co-policy-user-search').fill('QA');
      await page.waitForTimeout(800);
      await page.locator('#co-policy-user-select').click();
      await page.getByRole('option', { name: /QA Tester/ }).first().click();
      await page.locator('#co-policy-user-add').click();
      await page.locator('#co-policy-user-access-' + fx.qaId).click();
      await page.getByRole('option', { name: 'Collaborate', exact: true }).click();
      await shot('02-staff-selected');
      await page.locator('#co-policy-save').click();
      await until(() => assignments().some((a) => a.principal_id === fx.qaId), 'QA assignment saved');
    }
    await page.reload(); await page.locator('#co-policy-user-access-' + fx.qaId).waitFor();
    await check('qa-collaborate-assignment-persists-after-reload', (await page.locator('#co-policy-user-access-' + fx.qaId).innerText()).includes('Collaborate'), { assignments: assignments() });
    await shot('03-staff-after-reload');

    await chapter('Prep 2: current Oz time period (Settings > Time Entry > Time Periods)');
    await go('/msp/settings/time-entry'); await page.getByRole('tab', { name: 'Time Periods' }).click(); await page.waitForTimeout(1500);
    const covering = () => periods().find((p) => p.start_date <= '2026-10-26' && p.end_date > '2026-10-26');
    if (!covering()) {
      await page.locator('#create-time-period-button').click();
      { const cb = page.getByRole('dialog').getByRole('checkbox').first(); await cb.click(); await until(async () => await page.locator('#time-period-start-date-picker').isEnabled(), 'override enabled', 10000); }
      await typeDate(page, '#time-period-start-date-picker', '10/19/2026');
      await typeDate(page, '#time-period-end-date-picker', '11/01/2026');
      await shot('04-period-form');
      await page.getByRole('dialog').locator('#submit-button').click();
      await until(() => covering(), 'period saved');
    }
    await page.reload(); await page.getByRole('tab', { name: 'Time Periods' }).click(); await page.waitForTimeout(1500);
    await check('current-time-period-listed-after-reload', (await page.locator('main').innerText()).includes('2026-10-19'), { period: covering() });
    await shot('05-period-after-reload');

    await chapter('Prep 3: White Rabbit hourly contract through the contract wizard');
    if (!contract().length) {
      await go('/msp/billing?tab=client-contracts'); await page.locator('#client-wizard-button').click();
      await page.locator('#contract-basics-client-picker-trigger').click();
      await page.getByRole('option', { name: /White Rabbit/ }).first().click().catch(async () => { await page.getByText('White Rabbit', { exact: true }).last().click(); });
      await page.locator('#contract_name').fill(CONTRACT);
      await typeDate(page, '#start-date', '10/01/2026');
      await shot('06-contract-basics'); await inspect('06-contract-basics');
      await page.locator('#wizard-next').click(); await page.waitForTimeout(1200); // fixed fee
      await page.locator('#wizard-skip').click().catch(() => page.locator('#wizard-next').click()); await page.waitForTimeout(1200); // products
      await page.locator('#wizard-skip').click().catch(() => page.locator('#wizard-next').click()); await page.waitForTimeout(1200); // hourly
      await page.locator('#add-hourly-service-button').click();
      await page.locator('button#hourly-service-0').click(); await page.waitForTimeout(1000);
      await page.getByRole('option', { name: /Basic Support/ }).first().click().catch(async () => { await page.getByText('Basic Support', { exact: true }).last().click(); });
      await page.waitForTimeout(800);
      if (!(await page.locator('#hourly-rate-0').inputValue())) { await page.locator('#hourly-rate-0').fill('100'); await page.locator('#hourly-rate-0').blur(); }
      await shot('07-contract-hourly'); await inspect('07-contract-hourly');
      await page.locator('#wizard-next').click(); await page.waitForTimeout(1200); // usage
      await page.locator('#wizard-skip').click().catch(() => page.locator('#wizard-next').click()); await page.waitForTimeout(1500); // review
      await shot('08-contract-review'); await inspect('08-contract-review');
      await page.locator('#wizard-finish').click();
      await until(() => contract().length && contract()[0].client_contract_id, 'contract saved', 60000);
      await page.locator('#contract-wizard-created-done').click().catch(() => {});
    }
    await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
    await check('white-rabbit-contract-listed-after-reload', true, { contract: contract() });
    await shot('09-contract-listed');
    receipts.after = { assignments: assignments(), periods: periods(), contract: contract(),
      lines: JSON.parse(sql(`select coalesce(json_agg(l),'[]') from (select l.contract_line_id,l.contract_line_name,l.contract_line_type,s.service_id,s.custom_rate from contract_lines l left join contract_line_services s on s.tenant=l.tenant and s.contract_line_id=l.contract_line_id where l.tenant='${OZ}' and l.contract_id in (select contract_id from contracts where tenant='${OZ}' and contract_name='${CONTRACT}')) l`)) };
    fs.writeFileSync(dir + '/prep-receipt.json', JSON.stringify(receipts, null, 2));
    return { status: 'passed', limitations: ['Preparation only (native UI). QA staff assignment was absent in the reprovisioned data although the brief lists it; it was added through the documented sponsor flow and is removed at the end of guide 09/main recordings.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
