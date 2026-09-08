import { randomUUID } from 'node:crypto';
import { test, expect, signIn } from '../fixtures/auth';
import { createTimeBillingFixture } from '../fixtures/time-billing';
import { addBrowserInvoiceTaskSources, createBrowserInvoiceTicketSourceFixture } from '../fixtures/invoice-ticket';
import { createBrowserApiKey } from '../fixtures/api-key';
import { addLongInvoiceSources } from '../../server/test-utils/invoiceTicketProductionFixtures';
import { readInvoiceDocument, readInvoiceDownload } from '../fixtures/invoice-document';

test('an administrator authors a billed-time date sort and reopens its persisted invoice layout', async ({ page, credentials, database }, testInfo) => {
  const { tenant } = await createTimeBillingFixture(database, credentials.email);
  const name = `Billed time sort ${randomUUID()}`;
  const outputBinding = 'billedTimeByDate';
  const choose = async (selector: string, label: string | RegExp) => {
    await page.locator(selector).click();
    await page.getByRole('option', { name: label, exact: typeof label === 'string' }).click();
  };

  const collectAstNodes = (value: any, type = 'dynamic-table'): any[] => {
    if (!value || typeof value !== 'object') return [];
    return [
      ...(value.type === type ? [value] : []),
      ...Object.values(value).flatMap(child => collectAstNodes(child, type)),
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
  await page.locator('#designer-palette-add-table').click();
  await page.locator('#designer-palette-add-dynamic-table').click();
  await choose('#designer-table-source-binding', `${outputBinding} (Transforms output)`);
  const removeColumns = page.locator('button[id^="designer-remove-column-"]');
  for (let remaining = await removeColumns.count(); remaining > 0; remaining--) {
    await removeColumns.first().click();
  }
  for (const preset of ['entry-date', 'entry-ticket', 'entry-title', 'entry-hours', 'entry-rate', 'entry-amount']) {
    await page.locator(`#designer-add-column-preset-${preset}`).click();
  }
  await page.locator('#designer-palette-add-totals').click();
  await page.getByRole('button', { name: 'PRESETS', exact: true }).click();
  await page.locator('#designer-palette-add-preset-billed-time-by-ticket').click();
  await page.getByRole('button', { name: 'OUTLINE', exact: true }).click();
  await page.getByText('Entries in this ticket group', { exact: true }).and(page.locator('span')).click();
  await expect(page.locator('#designer-table-source-binding')).toContainText('group.entries');
  await page.locator('#designer-add-column-preset-entry-title').click();
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
  const tables = collectAstNodes(saved.templateAst.layout);
  expect(tables).toHaveLength(3);
  const detailTable = tables.find(table => table.repeat.sourceBinding.bindingId.includes(outputBinding));
  expect(detailTable).toBeTruthy();
  const group = collectAstNodes(saved.templateAst.layout, 'stack').find(node => node.repeat?.itemBinding === 'group');
  expect(saved.templateAst.bindings.collections[group.repeat.sourceBinding.bindingId].path).toBe('ticketGroups');
  const nestedTable = collectAstNodes(group)[0];
  expect(saved.templateAst.bindings.collections[nestedTable.repeat.sourceBinding.bindingId].path).toBe('group.entries');
  expect(nestedTable.columns).toHaveLength(6);
  const primaryTable = tables.find(table => table.id !== detailTable.id && table.id !== nestedTable.id);
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

  // Seed approved source work only. The authenticated API generates the invoice;
  // the downloaded document must consume the layout authored above through UI.
  const ids = await createBrowserInvoiceTicketSourceFixture(database, { tenant: tenant.tenantId, userId: tenant.admin.userId });
  await database('clients').where({ tenant: tenant.tenantId, client_id: ids.clientId })
    .update({ invoice_template_id: saved.template_id });
  const key = await createBrowserApiKey(database, tenant.admin.userId, tenant.tenantId);
  try {
    const generate = async (ids: Awaited<ReturnType<typeof createBrowserInvoiceTicketSourceFixture>>) => {
      const period = await database('recurring_service_periods')
        .where({ tenant: tenant.tenantId, obligation_id: ids.lineId, invoice_window_start: '2026-09-01' }).first();
      expect(period).toBeTruthy();
      const selector = {
        clientId: ids.clientId, windowStart: '2026-09-01', windowEnd: '2026-10-01',
        executionWindow: {
          kind: 'client_cadence_window', cadenceOwner: 'client', clientId: ids.clientId,
          scheduleKey: period.schedule_key, periodKey: period.period_key,
          windowStart: '2026-09-01', windowEnd: '2026-10-01',
          identityKey: ['client_cadence_window', 'client', ids.clientId, period.schedule_key,
            period.period_key, '2026-09-01', '2026-10-01'].join(':'),
        },
      };
      const generated = await page.request.post('/api/v1/invoices/generate', {
        headers: { 'x-api-key': key.api_key, 'x-tenant-id': tenant.tenantId }, data: { selector_input: selector },
      });
      expect(generated.status(), await generated.text()).toBe(201);
      const generatedId = (await generated.json()).data.invoice_id;
      return await database('invoices').where({ tenant: tenant.tenantId, invoice_id: generatedId }).first();
    };
    const invoice = await generate(ids);
    const invoiceId = invoice.invoice_id;
    const readSnapshots = () => database('invoice_time_entries')
      .where({ tenant: tenant.tenantId, invoice_id: invoiceId }).orderBy('invoice_time_entry_id');
    const snapshots = await readSnapshots();
    const readCharges = () => database('invoice_charges')
      .where({ tenant: tenant.tenantId, invoice_id: invoiceId }).orderBy('item_id');
    const charges = await readCharges();
    expect(snapshots).toHaveLength(4);
    await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${invoiceId}`);
    const text = await readInvoiceDownload(page, testInfo, invoice.invoice_number);
    const compact = text.replace(/\s/g, '');
    for (const value of ['Date', 'Ticket', 'Description', 'Hours', 'Rate', 'Amount', 'Public ticket 0', 'Public ticket 1', 'Mixed rates', '$375.00', '$150.00']) {
      expect(compact).toContain(value.replace(/\s/g, ''));
    }
    expect(compact).toContain(`Total$${(Number(invoice.total_amount) / 100).toFixed(2)}`);
    const dates = text.match(/8\/\d+\/2026/g) ?? [];
    expect(dates).toHaveLength(8); // Four flat entries and four entries scoped to ticket groups.
    expect(dates.filter(date => date === '8/15/2026')).toHaveLength(4);
    expect(dates.filter(date => date === '8/16/2026')).toHaveLength(4);
    expect(dates.some((_, index) => dates.slice(index, index + 4).join(',') === '8/16/2026,8/16/2026,8/15/2026,8/15/2026')).toBe(true);
    expect(compact).not.toContain('PRIVATE');
    expect(await readSnapshots()).toEqual(snapshots);
    const client = await database('clients').where({ tenant: tenant.tenantId, client_id: ids.clientId }).first();
    try {
      // Historical fixtures deliberately alter only this generated invoice's
      // snapshots. They test rendering old data, not how new invoices are captured.
      for (const history of ['current', 'v1', 'partial', 'none'] as const) {
        for (const [index, snapshot] of snapshots.entries()) {
          const workItemSnapshot = history === 'none' || (history === 'partial' && index === 0)
            ? null : history === 'v1' ? { ...snapshot.work_item_snapshot, version: 1 } : snapshot.work_item_snapshot;
          await database('invoice_time_entries')
            .where({ tenant: tenant.tenantId, invoice_time_entry_id: snapshot.invoice_time_entry_id })
            .update({ work_item_snapshot: workItemSnapshot });
        }
        const expectedSnapshots = await readSnapshots();
        const locales = history === 'current' ? ['fr', 'zz-unavailable'] : ['en', 'fr', 'zz-unavailable'];
        for (const locale of locales) {
          await test.step(`${history} snapshots / ${locale} PDF`, async () => {
            await database('clients').where({ tenant: tenant.tenantId, client_id: ids.clientId })
              .update({ properties: { ...client.properties, defaultLocale: locale } });
            await page.reload();
            const pdfText = await readInvoiceDownload(page, testInfo, invoice.invoice_number,
              `${invoice.invoice_number}-${history}-${locale}`);
            const localized = pdfText.replace(/\s/g, '');
            const french = locale === 'fr';
            if (history === 'current') expect(localized).toContain(french ? 'Tarifsvariables' : 'Mixedrates');
            if (history === 'v1') expect(localized).toContain(french ? 'Tarifindisponible' : 'Rateunavailable');
            expect(localized).toContain(french ? '375,00' : '$375.00');
            expect(localized).toContain(new Intl.NumberFormat(french ? 'fr-FR' : 'en-US', {
              minimumFractionDigits: 2, maximumFractionDigits: 2,
            }).format(Number(invoice.total_amount) / 100).replace(/\s/g, ''));
            if (history === 'none') {
              expect(localized).not.toContain('Publicticket');
            } else {
              expect(localized).toContain('Publicticket0');
              expect(localized).toContain('Publicticket1');
            }
            if (history === 'partial' || history === 'none') {
              const note = history === 'partial'
                ? french ? 'Seules les écritures de temps facturé disponibles figurent dans ce détail.'
                  : 'Only available billed-time entries are included in this detail.'
                : french ? 'Le détail des écritures de temps facturé est indisponible pour cette facture.'
                  : 'Billed-time entry detail is unavailable for this invoice.';
              expect(localized).toContain(note.replace(/\s/g, ''));
            }
            // Each available snapshot appears in both the flat and nested table.
            // Missing historical detail must not be reconstructed from live work.
            expect(pdfText.match(french ? /\d+\/08\/2026/g : /8\/\d+\/2026/g) ?? [])
              .toHaveLength(history === 'none' ? 0 : history === 'partial' ? 6 : 8);
            expect(localized).not.toContain('PRIVATE');
            expect(await readSnapshots()).toEqual(expectedSnapshots);
            expect(await readCharges()).toEqual(charges);
          });
        }
      }
    } finally {
      await database('clients').where({ tenant: tenant.tenantId, client_id: ids.clientId })
        .update({ properties: client.properties });
      for (const snapshot of snapshots) {
        await database('invoice_time_entries')
          .where({ tenant: tenant.tenantId, invoice_time_entry_id: snapshot.invoice_time_entry_id })
          .update({ work_item_snapshot: snapshot.work_item_snapshot });
      }
    }
    await test.step('long invoice preserves all detail rows across pages and tax rates', async () => {
      const longIds = await createBrowserInvoiceTicketSourceFixture(database, { tenant: tenant.tenantId, userId: tenant.admin.userId });
      await addLongInvoiceSources(database, longIds);
      await database('clients').where({ tenant: tenant.tenantId, client_id: longIds.clientId })
        .update({ invoice_template_id: saved.template_id });
      const longInvoice = await generate(longIds);
      const longLinks = await database('invoice_time_entries')
        .where({ tenant: tenant.tenantId, invoice_id: longInvoice.invoice_id }).orderBy('invoice_time_entry_id');
      const longCharges = await database('invoice_charges')
        .where({ tenant: tenant.tenantId, invoice_id: longInvoice.invoice_id }).orderBy('item_id');
      expect(longLinks).toHaveLength(74);
      expect([...new Set(longCharges.map(charge => Number(charge.tax_rate)))].sort((a, b) => a - b)).toEqual([10, 20]);
      // 36 single-hour entries at 20%; remaining $5,925 of time at 10%.
      expect(Number(longInvoice.subtotal)).toBe(1_132_500);
      expect(Number(longInvoice.tax)).toBe(167_250);
      expect(Number(longInvoice.total_amount)).toBe(1_299_750);
      expect(Number(longInvoice.tax)).toBe(longCharges.reduce((sum, charge) => sum + Number(charge.tax_amount), 0));
      await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${longInvoice.invoice_id}`);
      for (const locale of ['en', 'fr', 'zz-unavailable']) {
        await database('clients').where({ tenant: tenant.tenantId, client_id: longIds.clientId })
          .update({ properties: { defaultLocale: locale } });
        await page.reload();
        const document = await readInvoiceDocument(page, testInfo, longInvoice.invoice_number, `${longInvoice.invoice_number}-long-${locale}`);
        expect(document.pages.length).toBeGreaterThan(1);
        await testInfo.attach(`long-invoice-pagination-${locale}`, {
          body: JSON.stringify({ pages: document.pages.length, invoiceId: longInvoice.invoice_id,
            sourceEntries: longLinks.length, expectedDetailRows: 148, subtotal: longInvoice.subtotal,
            tax: longInvoice.tax, total: longInvoice.total_amount }), contentType: 'application/json',
        });
        const datePattern = locale === 'fr' ? /\d+\/08\/2026/g : /8\/\d+\/2026/g;
        expect(document.text.match(datePattern) ?? []).toHaveLength(148);
        for (const pageText of document.pages.filter(text => text.match(datePattern))) {
          expect(pageText).toContain('Date');
          expect(pageText).toContain('Ticket');
        }
        const compact = document.text.replace(/\s/g, '');
        expect(compact).toContain(locale === 'fr' ? 'Tarifsvariables' : 'Mixedrates');
        expect(compact).toContain(new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
          minimumFractionDigits: 2, maximumFractionDigits: 2,
        }).format(Number(longInvoice.total_amount) / 100).replace(/\s/g, ''));
        expect(compact).not.toContain('PRIVATE');
        expect(await database('invoice_time_entries').where({ tenant: tenant.tenantId, invoice_id: longInvoice.invoice_id }).orderBy('invoice_time_entry_id')).toEqual(longLinks);
        expect(await database('invoice_charges').where({ tenant: tenant.tenantId, invoice_id: longInvoice.invoice_id }).orderBy('item_id')).toEqual(longCharges);
      }
    });
    await test.step('separate same-name project tasks and localize unnamed task fallback', async () => {
      const taskIds = await createBrowserInvoiceTicketSourceFixture(database, { tenant: tenant.tenantId, userId: tenant.admin.userId });
      const tasks = await addBrowserInvoiceTaskSources(database, taskIds);
      await database('clients').where({ tenant: tenant.tenantId, client_id: taskIds.clientId })
        .update({ invoice_template_id: saved.template_id });
      const taskInvoice = await generate(taskIds);
      const readTaskLinks = () => database('invoice_time_entries')
        .where({ tenant: tenant.tenantId, invoice_id: taskInvoice.invoice_id }).orderBy('invoice_time_entry_id');
      const links = await readTaskLinks();
      const readTaskCharges = () => database('invoice_charges')
        .where({ tenant: tenant.tenantId, invoice_id: taskInvoice.invoice_id }).orderBy('item_id');
      const chargesBefore = await readTaskCharges();
      expect(links).toHaveLength(8);
      const taskSnapshots = links.map(link => link.work_item_snapshot).filter(snapshot => snapshot.workItemType === 'project_task');
      expect(taskSnapshots).toHaveLength(4);
      expect(new Set(taskSnapshots.map(snapshot => snapshot.workItemId))).toEqual(new Set(tasks.taskIds));
      expect(taskSnapshots.filter(snapshot => snapshot.workItemId === tasks.taskIds[0])).toHaveLength(2);
      expect(Number(taskInvoice.subtotal)).toBe(145_500);
      expect(Number(taskInvoice.tax)).toBe(14_550);
      expect(Number(taskInvoice.total_amount)).toBe(160_050);
      await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${taskInvoice.invoice_id}`);
      const sourceTasks = await database('project_tasks').where({ tenant: tenant.tenantId }).whereIn('task_id', tasks.taskIds);
      try {
        // Deliberate owned fixture edits test historical rendering; this does
        // not claim editing invoiced work is a supported application workflow.
        await database('project_tasks').where({ tenant: tenant.tenantId }).whereIn('task_id', tasks.taskIds)
          .update({ task_name: 'EDITED AFTER BILLING', description: 'PRIVATE_EDITED_TASK' });
        for (const locale of ['en', 'fr', 'zz-unavailable']) {
          await database('clients').where({ tenant: tenant.tenantId, client_id: taskIds.clientId })
            .update({ properties: { defaultLocale: locale } });
          await page.reload();
          const text = await readInvoiceDownload(page, testInfo, taskInvoice.invoice_number, `${taskInvoice.invoice_number}-tasks-${locale}`);
          const compact = text.replace(/\s/g, '');
          // Three named entries appear in flat Description, nested Ticket and
          // nested Description, plus two separate group headings: 3*3 + 2.
          expect(compact.match(/Samepublictaskname/g) ?? []).toHaveLength(11);
          expect(compact).toContain(locale === 'fr' ? 'Tâchedeprojet' : 'Projecttask');
          expect(compact).toContain(locale === 'fr' ? '180,00' : '$180.00');
          expect(compact).toContain(locale === 'fr' ? '1600,50' : '1,600.50');
          expect(text.match(locale === 'fr' ? /\d+\/08\/2026/g : /8\/\d+\/2026/g) ?? []).toHaveLength(16);
          expect(compact).not.toMatch(/PRIVATE|EDITED/);
          expect(await readTaskLinks()).toEqual(links);
          expect(await readTaskCharges()).toEqual(chargesBefore);
        }
      } finally {
        for (const task of sourceTasks) {
          await database('project_tasks').where({ tenant: tenant.tenantId, task_id: task.task_id })
            .update({ task_name: task.task_name, description: task.description });
        }
      }
    });
  } finally {
    await database('api_keys').where({ tenant: tenant.tenantId, api_key_id: key.api_key_id }).delete();
  }
});
