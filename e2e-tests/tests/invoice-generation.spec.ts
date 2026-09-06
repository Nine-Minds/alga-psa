import { randomUUID } from 'node:crypto';
import { test as authenticatedTest, expect, signIn } from '../fixtures/auth';
import { createUsageFixture } from '../fixtures/usage';
import { assertInvoiceDownload } from '../fixtures/invoice-document';

const test = authenticatedTest.extend<{ billing: Awaited<ReturnType<typeof createUsageFixture>> & { usageId: string } }>({
  billing: async ({ database, credentials }, use, testInfo) => {
    const billing = await createUsageFixture(database, credentials.email);
    await database('default_billing_settings').insert({ tenant: billing.tenant.tenantId,
      zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: false });
    await database('clients').where({ tenant: billing.tenant.tenantId, client_id: billing.client.id })
      .update({ billing_email: billing.tenant.portal.email, payment_terms: 'net_30' });
    const usageId = randomUUID();
    // Existing billable usage is setup for this invoice journey. Add Usage is
    // exercised independently through the real UI in usage-invoice-preview.
    await database('usage_tracking').insert({ tenant: billing.tenant.tenantId, usage_id: usageId,
      client_id: billing.client.id, service_id: billing.service.id, contract_line_id: billing.usageLine.id,
      usage_date: billing.period.start, quantity: billing.quantity, invoiced: false,
      comments: `Invoice source ${billing.actors.runId}`,
    });
    const fixture = { ...billing, usageId };
    await testInfo.attach('invoice-source-identities', { body: JSON.stringify(fixture), contentType: 'application/json' });
    await use(fixture);
  },
});

test('recurring usage generates one draft, finalizes and downloads the correct invoice without billing the same usage twice', async ({ page, billing, credentials, database, baseURL }, testInfo) => {
  test.setTimeout(300000);
  const { tenant, operator, client, service, usageId, expectedAmountCents, quantity, period } = billing;
  const scope = { tenant: tenant.tenantId };
  await signIn(page, { email: operator.email, password: credentials.password });
  await page.goto('/msp/billing?tab=invoicing&subtab=generate');
  await page.locator('#filter-clients-input').fill(client.name);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${period.start}T00:00:00Z`));
  const dueRow = page.locator('[data-automation-id="automatic-invoices-table"]').getByRole('row')
    .filter({ hasText: client.name }).filter({ hasText: monthLabel })
    .filter({ has: page.locator('input[type="checkbox"][id^="select-"]:not([id^="select-child-"])') });
  await expect(dueRow).toHaveCount(1);
  await dueRow.getByRole('checkbox').check();
  await page.locator('#preview-selected-button').click();
  const preview = page.getByRole('dialog', { name: 'Invoice Preview', exact: true });
  await expect(preview).toContainText('$40.00');
  expect(await database('invoices').where(scope)).toEqual([]);
  const [generateRequest] = await Promise.all([
    page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action'])
      && /"(?:targets|groupedTargets)"/.test(request.postData() || '')),
    page.locator('#generate-invoice-from-preview-button').click(),
  ]);
  await expect(preview).toBeHidden();
  await expect.poll(async () => (await database('invoices').where(scope)).length).toBe(1);
  const invoice = await database('invoices').where(scope).first();
  expect(invoice).toMatchObject({ client_id: client.id, status: 'draft', finalized_at: null, is_manual: false });
  expect(Number(invoice.total_amount)).toBe(expectedAmountCents);
  const charges = await database('invoice_charges').where({ ...scope, invoice_id: invoice.invoice_id });
  const charge = charges.find(line => line.service_id === service.id && Number(line.total_price) > 0);
  expect(charge).toBeDefined();
  expect(Number(charge.quantity)).toBe(quantity);
  expect(Number(charge.unit_price)).toBe(service.rateCents);
  expect(Number(charge.total_price)).toBe(expectedAmountCents);
  expect((await database('usage_tracking').where({ ...scope, usage_id: usageId }).first()).invoiced).toBe(true);

  await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${invoice.invoice_id}`);
  await expect(page.locator('#invoice-finalize')).toBeVisible();
  await page.locator('#invoice-finalize').click();
  await expect.poll(async () => (await database('invoices').where({ ...scope, invoice_id: invoice.invoice_id }).first())?.status).toBe('sent');
  const finalized = await database('invoices').where({ ...scope, invoice_id: invoice.invoice_id }).first();
  expect(finalized.finalized_at).not.toBeNull();
  expect(finalized.invoice_number).toBe(invoice.invoice_number);
  expect(Number(finalized.total_amount)).toBe(expectedAmountCents);
  const invoiceScope = { ...scope, invoice_id: invoice.invoice_id };
  const finalizedCharges = await database('invoice_charges').where(invoiceScope).orderBy('item_id');
  const transactions = await database('transactions').where(invoiceScope).orderBy('transaction_id');
  await page.goto(`/msp/billing?tab=invoicing&subtab=finalized&invoiceId=${invoice.invoice_id}`);
  await page.reload();
  await expect(page.locator('#invoice-download-pdf')).toBeVisible();
  await assertInvoiceDownload(page, testInfo, { number: invoice.invoice_number, clientName: client.name,
    serviceName: service.name, amountCents: expectedAmountCents });

  // Retry the exact generation request with the same authenticated browser
  // cookies. A hidden/disabled UI button alone would not prove idempotence.
  const retry = await page.request.post(generateRequest.url(), {
    headers: { 'next-action': generateRequest.headers()['next-action'],
      'content-type': generateRequest.headers()['content-type'], origin: new URL(baseURL!).origin },
    data: generateRequest.postData()!,
  });
  expect(retry.status()).toBe(200);
  expect(await database('invoices').where(scope)).toEqual([finalized]);
  expect(await database('invoice_charges').where(invoiceScope).orderBy('item_id')).toEqual(finalizedCharges);
  expect(await database('transactions').where(invoiceScope).orderBy('transaction_id')).toEqual(transactions);
  expect((await database('usage_tracking').where({ ...scope, usage_id: usageId }).first()).invoiced).toBe(true);
});

test('a manual invoice preserves its entered number, finalizes and downloads without duplicate financial effects on retry', async ({ page, billing, credentials, database, baseURL }, testInfo) => {
  test.setTimeout(300000);
  const { tenant, operator, client, service, usageId } = billing;
  const scope = { tenant: tenant.tenantId };
  const invoiceNumber = `MAN-${billing.actors.runId.slice(0, 8)}`;
  const amountCents = 3750;
  await signIn(page, { email: operator.email, password: credentials.password });
  await page.goto('/msp/billing?tab=invoicing&subtab=generate');
  await page.getByRole('combobox').filter({ hasText: 'Automatic Invoice' }).click();
  await page.getByRole('option', { name: 'Manual Invoice', exact: true }).click();
  await page.locator('#client-picker-trigger').click();
  await page.getByRole('option', { name: client.name, exact: true }).click();
  await page.locator('#new-invoice-number-input').fill(invoiceNumber);
  await page.getByText('Select Service', { exact: true }).click();
  await page.locator('#service-select').click();
  await page.getByRole('option', { name: service.name, exact: true }).click();
  await page.locator('#quantity-input').fill('3');
  await page.locator('#rate-input').fill('12.50');
  await page.locator('#collapse-line-item-button').click();
  const [generateRequest] = await Promise.all([
    page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action'])
      && Boolean(request.postData()?.includes('"items"')) && Boolean(request.postData()?.includes(client.id))),
    page.locator('#save-changes-button').click(),
  ]);
  await expect.poll(async () => (await database('invoices').where(scope)).length).toBe(1);
  const invoice = await database('invoices').where(scope).first();
  expect(invoice).toMatchObject({ invoice_number: invoiceNumber, client_id: client.id, is_manual: true,
    status: 'draft', finalized_at: null });
  expect(Number(invoice.total_amount)).toBe(amountCents);
  const invoiceScope = { ...scope, invoice_id: invoice.invoice_id };
  const [line] = await database('invoice_charges').where(invoiceScope);
  expect(line.service_id).toBe(service.id);
  expect(Number(line.quantity)).toBe(3);
  expect(Number(line.unit_price)).toBe(1250);
  expect(Number(line.total_price)).toBe(amountCents);
  expect((await database('usage_tracking').where({ ...scope, usage_id: usageId }).first()).invoiced).toBe(false);

  await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${invoice.invoice_id}`);
  await page.locator('#invoice-finalize').click();
  await expect.poll(async () => (await database('invoices').where(invoiceScope).first())?.status).toBe('sent');
  const finalized = await database('invoices').where(invoiceScope).first();
  expect(finalized.finalized_at).not.toBeNull();
  const charges = await database('invoice_charges').where(invoiceScope).orderBy('item_id');
  const transactions = await database('transactions').where(invoiceScope).orderBy('transaction_id');
  await page.goto(`/msp/billing?tab=invoicing&subtab=finalized&invoiceId=${invoice.invoice_id}`);
  await page.reload();
  await assertInvoiceDownload(page, testInfo, { number: invoiceNumber, clientName: client.name,
    serviceName: service.name, amountCents });

  const retry = await page.request.post(generateRequest.url(), {
    headers: { 'next-action': generateRequest.headers()['next-action'],
      'content-type': generateRequest.headers()['content-type'], origin: new URL(baseURL!).origin },
    data: generateRequest.postData()!,
  });
  expect(retry.status()).toBe(200);
  expect(await retry.text()).toContain('INVOICE_NUMBER_CONFLICT');
  expect(await database('invoices').where(scope)).toEqual([finalized]);
  expect(await database('invoice_charges').where(invoiceScope).orderBy('item_id')).toEqual(charges);
  expect(await database('transactions').where(invoiceScope).orderBy('transaction_id')).toEqual(transactions);
  expect((await database('usage_tracking').where({ ...scope, usage_id: usageId }).first()).invoiced).toBe(false);
});
