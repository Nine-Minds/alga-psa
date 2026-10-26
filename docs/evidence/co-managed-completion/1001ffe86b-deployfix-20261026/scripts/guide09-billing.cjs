// Guide 09 billing on the admitted production build (deploy-fix task 2).
// The smoke could only invoice White Rabbit's MSP co-managed time after a phantom USD catalog price was
// stored for Basic Support; the draft (INV-000002, $210.02) ignored the contract's 15-minute minimum and
// rounding. This run removes the workaround price, reverses that draft through the product, restores the
// contract, regenerates through Automatic Invoices and checks exact amounts in the UI and the database,
// then proves a second generation bills nothing twice. Restore: the contract is terminated again; the new
// correct draft is kept; the workaround price stays removed (it was never product data).
const fs = require('fs'), path = require('path');
const { scenario, sql, until } = require('./runtime.cjs');
const { actors, json, A, OZ } = require('./common.cjs');
const root = process.env.CM_ROOT;
const S = '3105a420-8aab-434e-a872-abd01ad26926', CONTRACT = 'CM-REVIEW-20261026-09 hourly contract';
const LINE = '9e12f69d-62cb-4b76-b8a7-b27bf6f3f8db', OLD_DRAFT = '74d3c735-1184-4ec2-999b-49a1d07feb5c';
const typeDate = async (loc, v) => { await loc.click(); await loc.press('Control+A'); await loc.pressSequentially(v); await loc.press('Tab'); };
const contractState = () => json(`select cc.client_contract_id, cc.is_active, cc.status, cc.end_date, c.status as contract_status, c.currency_code
  from client_contracts cc join contracts c on c.tenant=cc.tenant and c.contract_id=cc.contract_id where cc.tenant='${OZ}' and c.contract_name='${CONTRACT}'`)[0];
const entries = () => json(`select entry_id, billable_duration, invoiced, approval_status, work_item_type from time_entries where tenant='${OZ}' and contract_line_id='${LINE}' order by start_time, entry_id`);
const prices = () => json(`select price_id, currency_code, rate, effective_date from service_prices where tenant='${OZ}' and service_id='${S}'`);
const invoicesForClient = () => json(`select invoice_id, invoice_number, status, subtotal, tax, total_amount, currency_code, created_at from invoices where tenant='${OZ}' and client_id='${A.clientId}' order by created_at`);
const sources = (invoiceId) => json(`select entry_id from invoice_time_entries where tenant='${OZ}' and invoice_id='${invoiceId}' order by entry_id`).map((x) => x.entry_id);
const charges = (invoiceId) => json(`select item_id, description, quantity, unit_price, net_amount, tax_amount, total_price, service_id from invoice_charges where tenant='${OZ}' and invoice_id='${invoiceId}' order by item_id`);
const usd = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

async function openReadyRow(page) {
  await page.waitForTimeout(2500);
  const table = page.locator('[data-automation-id="automatic-invoices-table"]'); await table.waitFor({ timeout: 60000 });
  const range = page.locator('#billing-period-date-range');
  if (!await range.isVisible()) await page.getByRole('button', { name: /^Filters/ }).first().click();
  await typeDate(range.getByRole('combobox').nth(1), '11/01/2026'); await page.locator('#apply-billing-period-date-filter').click(); await page.waitForTimeout(3000);
  const groups = table.locator('button[id^="toggle-group-"]');
  for (let i = 0; i < await groups.count(); i++) { const g = groups.nth(i); if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click().catch(() => {}); }
  await page.waitForTimeout(1500);
  return table.locator('tbody tr').filter({ hasText: CONTRACT }).filter({ hasText: 'Ready' });
}

(async () => {
  const r = await scenario(root, '09-billing', async ({ page, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const receipt = (name, data) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2));
    const before = { prices: prices(), contract: contractState(), entries: entries(), invoices: invoicesForClient(), oldDraftCharges: charges(OLD_DRAFT), oldDraftSources: sources(OLD_DRAFT),
      line: json(`select contract_line_id, minimum_billable_time, round_up_to_nearest from contract_lines where contract_line_id='${LINE}'`)[0],
      serviceConfig: json(`select c.config_id, c.custom_rate, h.hourly_rate, h.minimum_billable_time, h.round_up_to_nearest from contract_line_service_configuration c left join contract_line_service_hourly_configs h on h.tenant=c.tenant and h.config_id=c.config_id where c.tenant='${OZ}' and c.contract_line_id='${LINE}'`) };
    receipt('db-before', before);
    await check('setup-17-co-managed-entries-on-the-line', before.entries.length === 17 && before.entries.every((e) => e.work_item_type === 'co_managed' && e.approval_status === 'APPROVED'), { count: before.entries.length });
    // Attempt 1 on this build (09-billing-attempt-1-no-billing-email, whose db-before.json holds the original state) already
    // removed the workaround price, reversed INV-000002 and restored the contract, then stopped at the missing billing email.
    const priorAttempt = before.prices.length === 0 && json(`select invoice_id from invoices where invoice_id='${OLD_DRAFT}'`).length === 0;
    await check('setup-contract-terms-15-15-and-100-per-hour', before.line.minimum_billable_time === 15 && before.line.round_up_to_nearest === 15 && Number(before.serviceConfig[0].hourly_rate) === 10000, { line: before.line, serviceConfig: before.serviceConfig });

    await chapter('Remove the catalog-price workaround (stored USD price for Basic Support)');
    if (!priorAttempt) {
      await check('workaround-price-present-before', before.prices.length === 1 && before.prices[0].rate === 10000, before.prices);
      sql(`delete from service_prices where tenant='${OZ}' and service_id='${S}' and price_id='${before.prices[0].price_id}'`);
    }
    await check('workaround-price-removed', prices().length === 0, { after: prices(), removedIn: priorAttempt ? 'attempt 1 on this build' : 'this run' });

    await actor(actors.qa());
    await chapter('Reverse the phantom-priced draft INV-000002 through the invoice page');
    if (!priorAttempt) {
      await go('/msp/invoices/' + OLD_DRAFT); await page.locator('#invoice-reverse-draft-button').waitFor({ timeout: 60000 });
      await shot('01-old-draft'); await page.locator('#invoice-reverse-draft-button').click(); await page.waitForTimeout(1000);
      const dialog = page.getByRole('dialog').last(); await dialog.waitFor(); await inspect('01b-reverse-dialog'); await shot('01b-reverse-dialog');
      await dialog.getByRole('button', { name: /reverse|confirm|yes/i }).last().click();
    }
    await until(() => entries().every((e) => e.invoiced === false), 'entries released by reversal', 90000);
    await check('old-draft-reversed-and-entries-released', entries().every((e) => e.invoiced === false) && sources(OLD_DRAFT).length === 0,
      { oldDraft: json(`select invoice_id, status from invoices where invoice_id='${OLD_DRAFT}'`) });

    await chapter('Restore the White Rabbit hourly contract');
    await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
    if (contractState().is_active !== true) {
      const crow = page.locator('tr').filter({ hasText: CONTRACT }).first();
      await crow.locator('#contract-actions-menu').click(); await page.locator('#restore-contract-menu-item').click(); await page.waitForTimeout(1000);
      const confirm = page.getByRole('dialog').last();
      if (await confirm.isVisible().catch(() => false)) { await inspect('02-restore-dialog'); await confirm.getByRole('button', { name: /restore|confirm|yes/i }).last().click(); }
    }
    await until(() => contractState().is_active === true, 'contract restored', 60000);
    await check('contract-restored', contractState().is_active === true, contractState());

    await chapter('Give White Rabbit a billing email (required to issue an invoice; cleared again at the end)');
    const billingEmail = () => sql(`select coalesce(billing_email,'') from clients where client_id='${A.clientId}'`);
    const emailBefore = billingEmail();
    await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    await page.locator('#client-billing-email-input').fill('billing@whiterabbit.test'); await page.locator('#save-billing-config-btn').click();
    await until(() => billingEmail() === 'billing@whiterabbit.test', 'billing email saved');
    await check('billing-email-set-for-generation', billingEmail() === 'billing@whiterabbit.test', { before: emailBefore });

    await chapter('Generate from Automatic Invoices with no catalog price: the contract rate and 15-minute terms price the time');
    await go('/msp/billing?tab=invoicing');
    const row = await openReadyRow(page); await row.first().waitFor({ timeout: 60000 });
    await row.first().scrollIntoViewIfNeeded(); await shot('03-ready'); await inspect('03-ready');
    await row.first().locator('input[id^="select-parent-group"]').check(); await page.locator('#preview-selected-button').click();
    const preview = page.getByRole('dialog'); await page.locator('#generate-invoice-from-preview-button').waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
    const previewText = await preview.innerText(); await shot('04-preview');
    await check('preview-shows-425-and-no-missing-pricing', previewText.includes(usd(42500)) && !/Missing pricing/i.test(previewText), { preview: previewText.slice(0, 1500) });
    await page.locator('#generate-invoice-from-preview-button').click();
    const newInvoice = () => invoicesForClient().find((i) => i.invoice_id !== OLD_DRAFT && i.status === 'draft' && sources(i.invoice_id).length > 0);
    const inv = await until(newInvoice, 'new draft invoice', 120000);
    const ch = charges(inv.invoice_id), src = sources(inv.invoice_id), ents = entries();
    receipt('db-new-invoice', { invoice: inv, charges: ch, sources: src, entries: ents, prices: prices() });
    await check('db-invoice-subtotal-and-total-exactly-425', inv.subtotal === 42500 && inv.total_amount === 42500 && inv.tax === 0 && inv.currency_code === 'USD', inv);
    await check('db-17-charges-each-15-minutes-at-100-is-25', ch.length === 17 && ch.every((c) => Number(c.quantity) === 0.25 && c.unit_price === 10000 && c.net_amount === 2500), { charges: ch.map((c) => [c.quantity, c.unit_price, c.net_amount]) });
    await check('db-every-entry-invoiced-once-on-this-draft', src.length === 17 && ents.every((e) => e.invoiced === true && src.includes(e.entry_id))
      && ents.every((e) => Number(sql(`select count(*) from invoice_time_entries where entry_id='${e.entry_id}'`)) === 1), { sources: src.length });
    await check('db-no-catalog-price-was-used', prices().length === 0, { prices: prices() });

    await chapter('Open the new draft: the UI shows $425.00, 0.25 h lines at $100.00, $25.00 each');
    await go('/msp/invoices/' + inv.invoice_id); await page.waitForTimeout(3500);
    const invText = await page.locator('main').innerText(); await shot('05-new-draft'); await inspect('05-new-draft');
    await check('ui-new-draft-shows-exact-amounts', invText.includes(inv.invoice_number) && invText.includes(usd(42500)) && invText.includes(usd(2500)) && invText.includes(usd(10000)), { number: inv.invoice_number });

    await chapter('Regenerate: Automatic Invoices offers nothing for the same time, so it is not billed twice');
    await go('/msp/billing?tab=invoicing');
    const again = await openReadyRow(page); await shot('06-after-generation'); await inspect('06-after-generation');
    await check('no-ready-row-for-the-invoiced-time', await again.count() === 0, { ready: await again.count() });
    const afterInvoices = invoicesForClient().filter((i) => i.status === 'draft' && sources(i.invoice_id).length > 0);
    await check('one-draft-carries-the-time', afterInvoices.length === 1 && afterInvoices[0].invoice_id === inv.invoice_id, afterInvoices);

    await chapter('Restore: terminate the disposable contract again; the corrected draft is kept');
    await go('/msp/billing?tab=client-contracts'); await page.getByText(CONTRACT).first().waitFor();
    const crow2 = page.locator('tr').filter({ hasText: CONTRACT }).first();
    await crow2.locator('#contract-actions-menu').click(); await page.locator('#terminate-contract-menu-item').click();
    await page.locator('#client-contracts-tab-terminate-confirmation-confirm').click();
    await until(() => contractState().is_active === false, 'contract terminated again', 60000);
    await go(`/msp/clients/${A.clientId}?tab=billing`); await page.locator('#client-billing-email-input').waitFor({ timeout: 60000 });
    await page.locator('#client-billing-email-input').fill(emailBefore); await page.locator('#save-billing-config-btn').click();
    await until(() => billingEmail() === emailBefore, 'billing email restored');
    const after = { prices: prices(), contract: contractState(), entries: entries(), invoices: invoicesForClient(), billingEmail: billingEmail() };
    receipt('db-after', after);
    await check('restore-contract-terminated-draft-kept-billing-email-restored', after.contract.is_active === false && after.invoices.some((i) => i.invoice_id === inv.invoice_id && i.status === 'draft') && after.billingEmail === emailBefore, { contract: after.contract, billingEmail: after.billingEmail });
    return { status: 'passed', limitations: ['The workaround price row was deleted directly in the database: the service editor has no remove control for a service\'s only price row and displays the legacy default rate even when no row is stored.', 'Draft only; nothing finalized or emailed.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
