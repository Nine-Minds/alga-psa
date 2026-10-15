import type { Page } from '@playwright/test';
import { test as authenticatedTest, expect, signIn } from '../fixtures/auth';
import { createTimeBillingFixture } from '../fixtures/time-billing';

const test = authenticatedTest.extend<{ billing: Awaited<ReturnType<typeof createTimeBillingFixture>> }>({
  billing: async ({ database, credentials }, use, testInfo) => {
    const fixture = await createTimeBillingFixture(database, credentials.email);
    await testInfo.attach('time-billing-identities', { body: JSON.stringify(fixture), contentType: 'application/json' });
    await use(fixture);
  },
});

async function selectDuePeriod(page: Page, billing: Awaited<ReturnType<typeof createTimeBillingFixture>>) {
  await page.goto('/msp/billing?tab=invoicing&subtab=generate');
  await page.locator('#filter-clients-input').fill(billing.client.name);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${billing.period.start}T00:00:00Z`));
  const row = page.locator('[data-automation-id="automatic-invoices-table"]').getByRole('row')
    .filter({ hasText: billing.client.name }).filter({ hasText: month })
    .filter({ has: page.locator('input[type="checkbox"][id^="select-"]:not([id^="select-child-"])') });
  await expect(row).toHaveCount(1);
  await row.getByRole('checkbox').check();
}

test('ticket time requires submission and approval before invoicing and cannot be billed twice', async ({ page, sessions, baseURL, billing, credentials, database }) => {
  test.setTimeout(300000);
  const { tenant, operator, service, sheet, ticket, line, expectedAmountCents } = billing;
  const scope = { tenant: tenant.tenantId };
  const sheetScope = { ...scope, id: sheet.id };
  const timeScope = { ...scope, time_sheet_id: sheet.id };
  const financeContext = await sessions.create('finance');
  const managerContext = await sessions.create('manager');
  const finance = await financeContext.newPage();
  await signIn(finance, { email: operator.email, password: credentials.password });
  // Keep a previously eligible selection open while another user submits time.
  // This exercises the server guard even when the browser has stale eligibility.
  await selectDuePeriod(finance, billing);
  await signIn(page, { email: tenant.technician.email, password: credentials.password });
  await page.goto(`/msp/time-entry/timesheet/${sheet.id}`);
  await page.locator('#add-work-item-button').click();
  const picker = page.getByRole('dialog', { name: 'Add Work Item', exact: true });
  await picker.getByPlaceholder('Search work items...').fill(ticket.title);
  await picker.getByRole('listitem').filter({ hasText: ticket.title }).click();
  const editor = page.getByRole('dialog', { name: /Time Entry/ });
  await editor.getByRole('combobox').filter({ hasText: 'Select a service' }).click();
  await page.getByRole('option', { name: service.name, exact: true }).click();
  await page.locator('#time-entry-dialog-duration-hours-0').fill('2');
  await page.locator('#time-entry-dialog-duration-minutes-0').fill('0');
  await page.locator('#time-entry-dialog-notes-0').fill(`Approved billing evidence ${billing.actors.runId}`);
  await page.locator('#time-entry-dialog-save-dialog-btn').click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await database('time_entries').where(timeScope)).length).toBe(1);
  let entry = await database('time_entries').where(timeScope).first();
  expect(entry).toMatchObject({ user_id: tenant.technician.userId, work_item_id: ticket.id,
    work_item_type: 'ticket', service_id: service.id, approval_status: 'DRAFT', invoiced: false });
  expect(Number(entry.billable_duration)).toBe(120);
  expect(new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()).toBe(2 * 60 * 60 * 1000);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: ticket.title })
    .getByRole('button', { name: '02:00', exact: true })).toBeVisible();
  await page.locator('#submit-timesheet-button').click();
  await expect.poll(async () => (await database('time_sheets').where(sheetScope).first())?.approval_status).toBe('SUBMITTED');
  expect((await database('time_entries').where(timeScope).first()).approval_status).toBe('SUBMITTED');

  // Exercise generation while the time is submitted but still unapproved.
  const [unapprovedResponse] = await Promise.all([
    finance.waitForResponse(response => response.request().method() === 'POST'
      && Boolean(response.request().headers()['next-action'])
      && /"(?:targets|groupedTargets)"/.test(response.request().postData() || '')),
    finance.locator('#generate-invoices-button').click(),
  ]);
  expect(unapprovedResponse.status()).toBe(200);
  // Observe rendered completion instead of waiting for the entire streamed RSC
  // response. An unrelated permission/setup failure must not satisfy this guard.
  await expect(finance.getByRole('alert').getByRole('listitem').filter({ hasText: billing.client.name }))
    .toContainText('Blocked until approval: 1 unapproved entry.');
  expect(await database('invoices').where(scope)).toEqual([]);
  expect(await database('invoice_charges').where(scope)).toEqual([]);
  expect((await database('time_entries').where(timeScope).first()).invoiced).toBe(false);

  const manager = await managerContext.newPage();
  await signIn(manager, { email: tenant.admin.email, password: credentials.password });
  await manager.goto('/msp/time-sheet-approvals');
  await manager.locator(`#view-timesheet-${sheet.id}-btn`).click();
  await manager.locator('#timesheet-approve-btn').click();
  await expect.poll(async () => (await database('time_sheets').where(sheetScope).first())?.approval_status).toBe('APPROVED');
  expect((await database('time_sheets').where(sheetScope).first()).approved_by).toBe(tenant.admin.userId);
  expect((await database('time_entries').where(timeScope).first()).approval_status).toBe('APPROVED');

  await selectDuePeriod(finance, billing);
  await finance.locator('#preview-selected-button').click();
  const preview = finance.getByRole('dialog', { name: 'Invoice Preview', exact: true });
  await expect(preview).toContainText('$250.00');
  const [generationRequest] = await Promise.all([
    finance.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action'])
      && /"(?:targets|groupedTargets)"/.test(request.postData() || '')),
    finance.locator('#generate-invoice-from-preview-button').click(),
  ]);
  await expect(preview).toBeHidden();
  await expect.poll(async () => (await database('invoices').where(scope)).length).toBe(1);
  const invoice = await database('invoices').where(scope).first();
  expect(Number(invoice.total_amount)).toBe(expectedAmountCents);
  const invoiceScope = { ...scope, invoice_id: invoice.invoice_id };
  const charges = await database('invoice_charges').where(invoiceScope).orderBy('item_id');
  const transactions = await database('transactions').where(invoiceScope).orderBy('transaction_id');
  expect(charges).toHaveLength(1);
  expect(charges[0]).toMatchObject({ service_id: service.id });
  expect(Number(charges[0].quantity)).toBe(2);
  expect(Number(charges[0].unit_price)).toBe(service.rateCents);
  expect(Number(charges[0].total_price)).toBe(expectedAmountCents);
  entry = await database('time_entries').where(timeScope).first();
  expect(entry).toMatchObject({ invoiced: true, approval_status: 'APPROVED', contract_line_id: line.id });
  await finance.reload();
  await page.reload();
  await expect(page.locator('#submit-timesheet-button')).toHaveCount(0);

  const retry = await finance.request.post(generationRequest.url(), {
    headers: { 'next-action': generationRequest.headers()['next-action'],
      'content-type': generationRequest.headers()['content-type'], origin: new URL(baseURL!).origin },
    data: generationRequest.postData()!,
  });
  expect(retry.status()).toBe(200);
  expect(await database('invoices').where(scope)).toEqual([invoice]);
  expect(await database('invoice_charges').where(invoiceScope).orderBy('item_id')).toEqual(charges);
  expect(await database('time_entries').where(timeScope)).toEqual([entry]);
  expect(await database('transactions').where(invoiceScope).orderBy('transaction_id')).toEqual(transactions);
});
