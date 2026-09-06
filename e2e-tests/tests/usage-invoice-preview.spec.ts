import { test as authenticatedTest, expect, signIn } from '../fixtures/auth';
import { createUsageFixture } from '../fixtures/usage';

const test = authenticatedTest.extend<{ usage: Awaited<ReturnType<typeof createUsageFixture>> }>({
  usage: async ({ database, credentials }, use, testInfo) => {
    const fixture = await createUsageFixture(database, credentials.email);
    await testInfo.attach('usage-fixture-identities', { body: JSON.stringify(fixture), contentType: 'application/json' });
    await use(fixture);
  },
});

test('Add Usage selects the usage line over an overlapping bucket and previews the persisted amount', async ({ page, usage, credentials, database }) => {
  test.setTimeout(300000);
  const { tenant, client, service, usageLine, bucketLine, period, quantity, expectedAmountCents } = usage;
  const scope = { tenant: tenant.tenantId };
  expect(await database('user_roles as ur').join('roles as r', function () {
    this.on('ur.tenant', 'r.tenant').andOn('ur.role_id', 'r.role_id');
  }).where({ 'ur.tenant': tenant.tenantId, 'ur.user_id': usage.operator.userId }).select('r.role_name'))
    .toEqual([{ role_name: 'Finance' }]);
  await signIn(page, { email: usage.operator.email, password: credentials.password });
  const params = new URLSearchParams({ tab: 'usage-tracking', clientId: client.id,
    serviceId: service.id, periodStart: period.start, periodEnd: period.end });
  await page.goto(`/msp/billing?${params}`);
  await page.locator('#add-usage-button').click();
  const dialog = page.getByRole('dialog', { name: 'Add Usage Record', exact: true });
  await expect(dialog.locator('#client-select-trigger')).toContainText(client.name);
  await expect(dialog.locator('#service-select')).toContainText(service.name);
  await expect(dialog.getByText('This service appears in multiple contract lines. Please select which contract line to bill against.', { exact: true })).toBeVisible();
  await dialog.locator('#contract-line-select').click();
  await expect(page.getByRole('option').filter({ hasText: bucketLine.name })).toBeVisible();
  await page.getByRole('option').filter({ hasText: usageLine.name }).click();
  await dialog.locator('#quantity-input').fill(String(quantity));
  const comment = `Usage evidence ${usage.actors.runId}`;
  await dialog.locator('#comments-input').fill(comment);
  await dialog.locator('#submit-usage-button').click();
  await expect(dialog).toBeHidden();

  const records = () => database('usage_tracking').where({ ...scope, client_id: client.id, service_id: service.id });
  await expect.poll(async () => (await records()).length).toBe(1);
  const [record] = await records();
  expect(record.contract_line_id).toBe(usageLine.id);
  expect(Number(record.quantity)).toBe(quantity);
  expect(new Date(record.usage_date).toISOString().slice(0, 10)).toBe(period.start);
  expect(record.comments).toBe(comment);
  expect(record.invoiced).toBe(false);
  await page.reload();
  const usageRow = page.getByRole('row').filter({ has: page.locator(`#usage-actions-menu-${record.usage_id}`) });
  await expect(usageRow).toContainText(service.name);
  await expect(usageRow).toContainText(usageLine.id.slice(0, 8));
  await expect(usageRow.getByRole('cell', { name: String(quantity), exact: true })).toBeVisible();

  await page.goto('/msp/billing?tab=invoicing&subtab=generate');
  await page.locator('#filter-clients-input').fill(client.name);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period.start}T00:00:00Z`));
  const dueRow = page.locator('#automatic-invoices-table').getByRole('row')
    .filter({ hasText: client.name }).filter({ hasText: monthLabel })
    .filter({ has: page.locator('input[type="checkbox"][id^="select-"]:not([id^="select-child-"])') });
  await expect(dueRow).toHaveCount(1);
  await dueRow.getByRole('checkbox').check();
  await page.locator('#preview-selected-button').click();
  const preview = page.getByRole('dialog', { name: 'Invoice Preview', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('preview-invoice-count-summary')).toContainText('one combined invoice');
  const billedLine = preview.getByRole('row').filter({ hasText: service.name })
    .filter({ has: page.getByRole('cell', { name: String(quantity), exact: true }) });
  await expect(billedLine).toHaveCount(1);
  await expect(billedLine.getByRole('cell', { name: '$10.00', exact: true })).toBeVisible();
  const total = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(expectedAmountCents / 100);
  await expect(billedLine.getByRole('cell', { name: total, exact: true })).toBeVisible();
  await expect(preview.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Total', exact: true }) }))
    .toContainText(total);
  expect(await database('invoices').where(scope)).toEqual([]);
  expect(await database('invoice_charges').where(scope)).toEqual([]);
  expect((await records())[0].invoiced).toBe(false);
});
