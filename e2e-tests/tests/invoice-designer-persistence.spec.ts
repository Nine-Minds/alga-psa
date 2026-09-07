import { randomUUID } from 'node:crypto';
import { test, expect, signIn } from '../fixtures/auth';

test('an administrator authors a billed-time date sort and reopens its persisted invoice layout', async ({ page, actors, credentials, database }, testInfo) => {
  const tenant = actors.primary;
  const name = `Billed time sort ${randomUUID()}`;
  const outputBinding = 'billedTimeByDate';
  const choose = async (selector: string, label: string | RegExp) => {
    await page.locator(selector).click();
    await page.getByRole('option', { name: label, exact: typeof label === 'string' }).click();
  };

  const dynamicTables = (value: any): any[] => {
    if (!value || typeof value !== 'object') return [];
    return [
      ...(value.type === 'dynamic-table' ? [value] : []),
      ...Object.values(value).flatMap(dynamicTables),
    ];
  };
  const openTransforms = async () => {
    await page.locator('[data-automation-id="invoice-designer-transforms-tab"]').click();
    await choose('#invoice-designer-transforms-sample-select', 'Ticket Time Detail');
  };
  const assertDates = async () => {
    const output = page.locator('section').filter({ has: page.getByText('Output preview', { exact: true }) });
    await expect.poll(async () => output.locator('pre').evaluateAll(elements =>
      elements.map(element => JSON.parse(element.textContent || '{}').date)
    )).toEqual(['2026-01-25', '2026-01-23', '2026-01-22', '2026-01-19', '2026-01-18']);
  };

  await signIn(page, { email: tenant.admin.email, password: credentials.password });
  await page.goto('/msp/billing?tab=invoice-templates&templateId=new');
  await page.locator('#templateName').fill(name);
  await openTransforms();
  await choose('#invoice-designer-transforms-source-binding', /^Billed Time Entries(?: \(timeEntries\))?$/);
  await page.locator('#invoice-designer-transforms-output-binding').fill(outputBinding);
  await page.locator('#invoice-designer-transforms-output-binding').press('Tab');
  await page.getByRole('button', { name: '+ Sort', exact: true }).first().click();
  await choose('[role="combobox"][id^="transform-sort-field-"]', 'date');
  await choose('[role="combobox"][id^="transform-sort-direction-"]', 'Descending');
  await assertDates();
  await page.locator('[data-automation-id="invoice-designer-design-tab"]').click();
  // Keep a primary charges table, then author a separate informational detail
  // table so billed time does not replace the invoice's charge presentation.
  await page.locator('#designer-palette-add-dynamic-table').click();
  await page.locator('#designer-palette-add-dynamic-table').click();
  await choose('#designer-table-source-binding', `${outputBinding} (Transforms output)`);
  const removeColumns = page.locator('button[id^="designer-remove-column-"]');
  for (let remaining = await removeColumns.count(); remaining > 0; remaining--) {
    await removeColumns.first().click();
  }
  for (const preset of ['entry-date', 'entry-ticket', 'entry-title', 'entry-hours', 'entry-rate', 'entry-amount']) {
    await page.locator(`#designer-add-column-preset-${preset}`).click();
  }
  await page.locator('#save-template-button').click();
  await expect(page).not.toHaveURL(/templateId=/);

  // The operation under test saves through the application; SQL only verifies
  // its durable result. No template or completed layout is seeded by this test.
  const saved = await database('invoice_templates').where({ tenant: tenant.tenantId, name }).first();
  expect(saved).toBeTruthy();
  expect(saved.templateAst.transforms).toMatchObject({
    sourceBindingId: 'timeEntries', outputBindingId: outputBinding,
    operations: [{ type: 'sort', keys: [{ path: 'date', direction: 'desc' }] }],
  });
  const tables = dynamicTables(saved.templateAst.layout);
  expect(tables).toHaveLength(2);
  const detailTable = tables.find(table => table.repeat.sourceBinding.bindingId.includes(outputBinding));
  expect(detailTable).toBeTruthy();
  const primaryTable = tables.find(table => table.id !== detailTable.id);
  expect(primaryTable.repeat.sourceBinding.bindingId).toContain('items');
  expect(detailTable.columns.map((column: any) => column.value)).toEqual([
    'date', 'ticketNumber', 'title', 'hours', 'rateDisplay', 'amount',
  ].map(path => expect.objectContaining({ type: 'path', path })));
  const persistedAst = structuredClone(saved.templateAst);
  await testInfo.attach('saved-invoice-layout', { body: JSON.stringify({ templateId: saved.template_id, ast: persistedAst }, null, 2), contentType: 'application/json' });

  // Remove the editor's best-effort local cache so reopening must hydrate the
  // database template. This is storage cleanup, not application state injection.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('alga.invoiceDesigner.workspace.')) localStorage.removeItem(key);
    }
  });
  await page.goto(`/msp/billing?tab=invoice-templates&templateId=${saved.template_id}`);
  await page.reload();
  await expect(page.locator('#templateName')).toHaveValue(name);
  await openTransforms();
  await expect(page.locator('#invoice-designer-transforms-output-binding')).toHaveValue(outputBinding);
  await assertDates();
  await page.locator('[data-automation-id="invoice-designer-design-tab"]').click();
  await page.locator(`[data-automation-id="designer-canvas-node-${detailTable.id}"]`).click();
  await expect(page.locator('#designer-table-source-binding')).toContainText(outputBinding);
  await expect(page.locator('input[id^="column-header-"]')).toHaveCount(6);
  expect((await database('invoice_templates').where({ tenant: tenant.tenantId, template_id: saved.template_id }).first()).templateAst)
    .toEqual(persistedAst);
});
