import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createInvoiceTicketSourceFixture } from '../../../test-utils/invoiceTicketProductionFixtures';

// Generate synthetic approved work through real billing actions, persistence,
// PDF rendering and accounting export. Authentication is mocked with the seeded
// user's identity; native browser tests separately verify real sign-in and HTTP.
// Completed invoice snapshots are produced by generation, not fixture inserts.
const evidenceDir = process.env.INVOICE_TICKET_EVIDENCE_DIR ?? '/tmp/invoice-ticket-evidence';
const state = vi.hoisted(() => ({ user: null as any, tenant: '' }));
vi.mock('@alga-psa/auth', async (original) => {
  const actual = await original<any>();
  return { ...actual, getSession: async () => ({ user: { ...state.user, id: state.user.user_id } }), withAuth: (fn: any) => async (...args: any[]) => {
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(state.tenant, () => fn(state.user, { tenant: state.tenant }, ...args));
  } };
});
vi.mock('@alga-psa/auth/getCurrentUser', () => ({ getCurrentUser: async () => state.user }));

async function createSourceFixture(db: ReturnType<typeof knex>, customize?: (ids: any) => Promise<void>) {
  return createInvoiceTicketSourceFixture(db, { tenant: state.tenant, userId: state.user.user_id }, customize);
}

it('generates immutable ticket presentation from approved source records', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const db = await createTestDbConnection();
  try {
    if (process.env.TEST_DB_BACKEND === 'citus') {
      const { rows } = await db.raw(`SELECT c.relname AS name, p.partmethod
        FROM pg_class c LEFT JOIN pg_dist_partition p ON p.logicalrelid = c.oid
        WHERE c.oid IN ('invoices'::regclass, 'invoice_charges'::regclass,
          'invoice_time_entries'::regclass, 'tickets'::regclass, 'time_entries'::regclass)`);
      // The current combined migration chain leaves time-entry tables local.
      // Record that topology; require the core invoice/ticket tables to exercise
      // distributed billing without claiming all related tables are sharded.
      fs.writeFileSync(`${evidenceDir}/citus-topology.json`, JSON.stringify(rows, null, 2));
      for (const name of ['invoice_charges', 'invoices', 'tickets']) {
        expect(rows.find((row: { name: string }) => row.name === name)).toMatchObject({ partmethod: 'h' });
      }
    }
    state.user = await db('users as u')
      .join('user_roles as ur', function () { this.on('ur.user_id', 'u.user_id').andOn('ur.tenant', 'u.tenant'); })
      .join('roles as r', function () { this.on('r.role_id', 'ur.role_id').andOn('r.tenant', 'ur.tenant'); })
      .where({ 'u.user_type': 'internal', 'r.role_name': 'Admin', 'r.msp': true })
      .select('u.*').orderBy('u.user_id').first();
    if (!state.user) throw new Error('Migrated test database must seed an internal fixture user');
    state.tenant = state.user.tenant;
    const { tenant, userId, clientId, lineId, serviceId, cycleId, profileId, usageServiceId } = await createSourceFixture(db);
    fs.writeFileSync(`${evidenceDir}/source.json`, JSON.stringify({ tenant, clientId, lineId, cycleId, userId }, null, 2));
    const { generateInvoice, previewInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
    const preview = await previewInvoice(cycleId) as any;
    expect(preview.success, JSON.stringify(preview)).toBe(true);
    expect(preview.data.ticketPresentationRows.filter((r: any) => r.id.startsWith('ticket:'))).toHaveLength(2);
    expect(preview.data.ticketPresentationRows.reduce((sum: number, r: any) => sum + r.amount, 0)).toBe(preview.data.subtotal);
    fs.writeFileSync(`${evidenceDir}/recurring-preview.json`, JSON.stringify(preview.data, null, 2));
    const result = await generateInvoice(cycleId) as any;
    if (result?.actionError || result?.permissionError) throw new Error(JSON.stringify(result));
    expect(result?.invoice_id).toBeTruthy();
    const links = await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id });
    expect(links).toHaveLength(4);
    expect(links.some((l) => l.work_item_snapshot.rateKind === 'mixed' && l.work_item_snapshot.netAmount === 37500)).toBe(true);
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const { QuickBooksCSVAdapter } = await import('@alga-psa/billing/adapters/accounting/quickBooksCSVAdapter');
    const { runWithTenant } = await import('@alga-psa/db');
    const canonicalCharges = await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id });
    for (const service of [serviceId, usageServiceId]) {
      await db('tenant_external_entity_mappings').insert({ id: randomUUID(), tenant, integration_type: 'quickbooks_csv',
        alga_entity_type: 'service', alga_entity_id: service, external_entity_id: `Acceptance ${service}`, external_realm_id: null });
    }
    // Fixture export envelope only: transform loads the real invoice, charges,
    // and persisted mappings. No delivery or accounting-system write is performed.
    const exportContext = { batch: { tenant, batch_id: randomUUID(), adapter_type: 'quickbooks_csv' },
      lines: canonicalCharges.map((charge) => ({ line_id: charge.item_id, document_id: result.invoice_id, document_line_id: charge.item_id, client_id: clientId })) } as any;
    const exportPayload = () => runWithTenant(tenant, () => new QuickBooksCSVAdapter().transform(exportContext));
    const exportBefore = await exportPayload();
    const csvRows = exportBefore.documents[0].payload.csvRows as any[];
    expect(csvRows.map((row) => row.ItemDescription)).toEqual(canonicalCharges.map((charge) => charge.description));
    expect(csvRows.map((row) => row['*Item'])).toEqual(canonicalCharges.map((charge) => `Acceptance ${charge.service_id}`));
    const invoice = await Invoice.getFullInvoiceById(db, tenant, result.invoice_id);
    const vm = mapDbInvoiceToWasmViewModel(invoice)!;
    expect(vm.ticketPresentationRows).toHaveLength(3);
    expect(vm.ticketPresentationRows!.filter((r) => r.id.startsWith('ticket:'))).toHaveLength(2);
    const persistedCharges = await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id });
    for (const charge of persistedCharges) {
      const contributions = vm.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id);
      expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
      if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
    }
    expect(vm.subtotal).toBe(87500);
    expect(vm.tax).toBe(8750);
    expect(vm.total).toBe(vm.subtotal + vm.tax);
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const { execFileSync } = await import('node:child_process');
    const template = await db('standard_invoice_templates').where({ standard_invoice_template_code: 'standard-invoice-by-ticket' }).first();
    const pdfBefore = new PDFGenerationService(tenant);
    const beforeHtml = await pdfBefore.renderInvoicePreview({ invoiceId: result.invoice_id, templateId: template.template_id });
    fs.writeFileSync(`${evidenceDir}/before-source-edit.html`, beforeHtml.html);
    fs.writeFileSync(`${evidenceDir}/before-source-edit.pdf`, await pdfBefore.generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
    const beforeText = execFileSync('pdftotext', ['-layout', `${evidenceDir}/before-source-edit.pdf`, '-'], { encoding: 'utf8' });
    // Historical foreign ownership must not leak through either standard or
    // transformed detail rendering, even when legacy link FKs permit the IDs.
    const foreignLinkId = randomUUID(), foreignTenant = randomUUID();
    try {
      await db('invoice_time_entries').insert({ ...links[0], invoice_time_entry_id: foreignLinkId, tenant: foreignTenant,
        work_item_snapshot: { ...links[0].work_item_snapshot, title: 'FOREIGN_PRIVATE_SENTINEL' } });
      expect(mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenant, result.invoice_id))).toEqual(vm);
      expect((await pdfBefore.renderInvoicePreview({ invoiceId: result.invoice_id, templateId: template.template_id })).html).toBe(beforeHtml.html);
      const { getStandardTemplateAstByCode } = await import('@alga-psa/billing/lib/invoice-template-ast/standardTemplates');
      const detail = structuredClone(getStandardTemplateAstByCode('standard-invoice-by-ticket'))!;
      detail.transforms = { sourceBindingId: 'timeEntries', outputBindingId: 'private-check-detail', operations: [
        { id: 'sort-detail', type: 'sort', keys: [{ path: 'amount', direction: 'desc' }] },
      ] };
      detail.layout.children!.push({ id: 'private-check-table', type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'private-check-detail' }, itemBinding: 'entry' },
        columns: [{ id: 'description', header: 'Public detail', value: { type: 'path', path: 'entry.description' } }],
      } as any);
      const detailPreview = await pdfBefore.renderInvoicePreview({ invoiceId: result.invoice_id, templateAst: detail });
      expect(detailPreview.html).toContain('Public work');
      expect(detailPreview.html).not.toContain('PRIVATE');
      fs.writeFileSync(`${evidenceDir}/foreign-detail-preview.html`, detailPreview.html);
      const { saveInvoiceTemplate } = await import('@alga-psa/billing/actions/invoiceTemplates');
      const savedDetail = await saveInvoiceTemplate({ template_id: randomUUID(), name: 'Synthetic ownership detail', version: 1, is_default: false, templateAst: detail } as any);
      expect(savedDetail.success, savedDetail.error).toBe(true);
      fs.writeFileSync(`${evidenceDir}/foreign-detail.pdf`, await pdfBefore.generatePDF({ invoiceId: result.invoice_id, userId, templateId: savedDetail.template!.template_id }));
      const detailText = execFileSync('pdftotext', ['-layout', `${evidenceDir}/foreign-detail.pdf`, '-'], { encoding: 'utf8' });
      expect(detailText).toContain('Public work');
      expect(detailText).not.toContain('PRIVATE');
    } finally {
      await db('invoice_time_entries').where({ tenant: foreignTenant, invoice_time_entry_id: foreignLinkId }).delete();
    }

    // Run historical locale rendering without relying on another test's files
    // or a manually authored template. Designer authoring still requires separate coverage.
    const clientBeforeLocales = await db('clients').where({ tenant, client_id: clientId }).first();
    try {
      for (const history of ['v1', 'partial', 'none']) {
        for (const [index, link] of links.entries()) {
          const workItemSnapshot = history === 'none' || (history === 'partial' && index === 0)
            ? null : history === 'v1' ? { ...link.work_item_snapshot, version: 1 } : link.work_item_snapshot;
          await db('invoice_time_entries').where({ tenant, invoice_time_entry_id: link.invoice_time_entry_id }).update({ work_item_snapshot: workItemSnapshot });
        }
        const historicalVm = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenant, result.invoice_id))!;
        const frozenHistorical = JSON.stringify(historicalVm);
        const persistedHistory = await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id }).orderBy('invoice_time_entry_id');
        for (const locale of ['en', 'fr', 'zz-unavailable']) {
          const effectiveLocale = locale === 'fr' ? 'fr' : 'en';
          await db('clients').where({ tenant, client_id: clientId }).update({ properties: { ...clientBeforeLocales.properties, defaultLocale: locale } });
          const localizedPdf = new PDFGenerationService(tenant);
          expect(await localizedPdf.resolveRenderLocale({ invoiceId: result.invoice_id })).toBe(effectiveLocale);
          const localizedPreview = await localizedPdf.renderInvoicePreview({ invoiceId: result.invoice_id, templateId: template.template_id });
          const prefix = `${evidenceDir}/history-${history}-${locale}`;
          fs.writeFileSync(`${prefix}.html`, localizedPreview.html);
          fs.writeFileSync(`${prefix}.pdf`, await localizedPdf.generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
          // Content order keeps wrapped table-cell labels together; geometric
          // reading order can insert the adjacent amount between label words.
          const text = execFileSync('pdftotext', ['-raw', `${prefix}.pdf`, '-'], { encoding: 'utf8' });
          fs.writeFileSync(`${prefix}.txt`, text);
          const compact = (value: string) => value.replace(/\s/g, '');
          // Labels are asserted against the actual locale dictionary below;
          // this also keeps fallback locales tied to the English document.
          const { localizeTemplateAstForLocale } = await import('@alga-psa/billing/lib/invoice-template-ast/i18nLabels');
          const { getStandardTemplateAstByCode } = await import('@alga-psa/billing/lib/invoice-template-ast/standardTemplates');
          const { localizeTimePresentation } = await import('@alga-psa/billing/lib/invoice-template-ast/timePresentationLocalization');
          const { formatBoundValue } = await import('@alga-psa/billing/components/invoice-designer/preview/previewBindings');
          const localized = await localizeTemplateAstForLocale(getStandardTemplateAstByCode('standard-invoice-by-ticket')!, locale);
          const display = localizeTimePresentation(historicalVm, localized.t);
          const expected = history === 'v1' ? (locale === 'fr' ? 'Tarif indisponible' : 'Rate unavailable') : display.ticketCoverageNote;
          expect(expected, `${history}/${locale}`).toBeTruthy();
          expect(compact(text)).toContain(compact(expected!));
          expect(compact(localizedPreview.html)).toContain(compact(expected!));
          expect(compact(text)).toContain(compact(formatBoundValue(historicalVm.total, 'currency', historicalVm.currencyCode, effectiveLocale)!));
          expect(text).not.toMatch(/PRIVATE|EDITED/);
          expect(JSON.stringify(historicalVm)).toBe(frozenHistorical);
          expect(await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id }).orderBy('invoice_time_entry_id')).toEqual(persistedHistory);
          expect(await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id })).toEqual(persistedCharges);
        }
      }
    } finally {
      await db('clients').where({ tenant, client_id: clientId }).update({ properties: clientBeforeLocales.properties });
      for (const link of links) await db('invoice_time_entries').where({ tenant, invoice_time_entry_id: link.invoice_time_entry_id }).update({ work_item_snapshot: link.work_item_snapshot });
    }
    const frozen = JSON.stringify(vm);
    // Invoiced fields are locked in the UI. Deliberate fixture-only source edits
    // test immutable historical rendering, not a supported edit workflow.
    await db('tickets').where({ tenant, client_id: clientId }).update({ ticket_number: db.raw("ticket_number || '-EDITED'"), title: 'EDITED AFTER BILLING', attributes: { description: 'EDITED DESCRIPTION' } });
    await db('time_entries').where({ tenant, contract_line_id: lineId }).update({ notes: 'EDITED PRIVATE NOTE', work_date: '2026-08-20', start_time: '2026-08-20T13:00:00Z', end_time: '2026-08-20T14:00:00Z' });
    const fresh = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenant, result.invoice_id))!;
    expect(JSON.stringify(fresh)).toBe(frozen);
    expect(await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id })).toEqual(links);
    const afterPdf = new PDFGenerationService(tenant);
    expect((await afterPdf.renderInvoicePreview({ invoiceId: result.invoice_id, templateId: template.template_id })).html).toBe(beforeHtml.html);
    fs.writeFileSync(`${evidenceDir}/after-source-edit.pdf`, await afterPdf.generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
    const afterText = execFileSync('pdftotext', ['-layout', `${evidenceDir}/after-source-edit.pdf`, '-'], { encoding: 'utf8' });
    expect(afterText).toBe(beforeText);
    expect(afterText).not.toMatch(/PRIVATE|EDITED/);
    fs.writeFileSync(`${evidenceDir}/immutable-pdf.txt`, afterText);
    expect(await exportPayload()).toEqual(exportBefore);
    expect(await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id })).toEqual(canonicalCharges);
    fs.writeFileSync(`${evidenceDir}/accounting-export.json`, JSON.stringify(exportBefore, null, 2));
    const duplicate = await generateInvoice(cycleId) as any;
    expect(duplicate?.invoice_id).toBeUndefined();
    expect(await db('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id }).count('* as count').first().then((r) => Number(r!.count))).toBe(4);
    expect(JSON.stringify(links)).not.toContain('PRIVATE');
    fs.writeFileSync(`${evidenceDir}/generated.json`, JSON.stringify({ invoiceId: result.invoice_id, links, vm }, null, 2));
    fs.writeFileSync(`${evidenceDir}/production.pdf`, await new PDFGenerationService(tenant).generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
    await db('clients').where({ tenant, client_id: clientId }).update({ properties: { defaultLocale: 'fr' } });
    const pdf = new PDFGenerationService(tenant);
    expect(await pdf.resolveRenderLocale({ invoiceId: result.invoice_id })).toBe('fr');
    fs.writeFileSync(`${evidenceDir}/production-fr.pdf`, await pdf.generatePDF({ invoiceId: result.invoice_id, userId, templateId: template.template_id }));
    const { grantCredit, applyCreditToInvoice } = await import('@alga-psa/billing/actions/creditActions');
    const credit = await grantCredit(clientId, 2500, undefined, 'Synthetic acceptance credit', profileId) as any;
    expect(credit.credit_id, JSON.stringify(credit)).toBeTruthy();
    expect(await applyCreditToInvoice(clientId, result.invoice_id, 2500)).toBeUndefined();
    const creditedInvoice = await Invoice.getFullInvoiceById(db, tenant, result.invoice_id);
    const creditedVm = mapDbInvoiceToWasmViewModel(creditedInvoice)!;
    expect(creditedVm.ticketPresentationRows).toEqual(vm.ticketPresentationRows);
    expect(creditedVm.subtotal).toBe(vm.subtotal);
    expect(creditedVm.tax).toBe(vm.tax);
    expect(Number(creditedInvoice!.credit_applied)).toBe(2500);
    fs.writeFileSync(`${evidenceDir}/credited.json`, JSON.stringify(creditedVm, null, 2));
    const { addManualItemsToInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
    const adjusted = await addManualItemsToInvoice(result.invoice_id, [
      { description: 'Synthetic line discount', quantity: 1, rate: -1000, is_discount: true, discount_type: 'fixed', applies_to_item_id: persistedCharges[0].item_id, is_taxable: false },
      { description: 'Synthetic negative credit', quantity: 1, rate: -500, is_taxable: false },
      { description: 'Synthetic zero information', quantity: 1, rate: 0, is_taxable: false },
    ] as any) as any;
    expect(adjusted.invoice_id, JSON.stringify(adjusted)).toBe(result.invoice_id);
    const adjustedVm = mapDbInvoiceToWasmViewModel(adjusted)!;
    expect(adjustedVm.subtotal).toBe(86000);
    expect(adjustedVm.tax).toBe(8750);
    expect(adjustedVm.total).toBe(94750);
    expect(Number(adjusted.credit_applied)).toBe(2500);
    const adjustmentCharges = await db('invoice_charges').where({ tenant, invoice_id: result.invoice_id });
    for (const charge of adjustmentCharges) {
      expect(adjustedVm.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id).reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
    }
    expect(adjustedVm.ticketPresentationRows!.filter((r) => r.id.startsWith('ticket:'))).toHaveLength(2);
    for (const description of ['Synthetic line discount', 'Synthetic negative credit', 'Synthetic zero information']) {
      expect(adjustedVm.ticketPresentationRows!.filter((r) => r.description === description)).toHaveLength(1);
    }
    fs.writeFileSync(`${evidenceDir}/adjusted.json`, JSON.stringify(adjustedVm, null, 2));
    // Corrupt-history cases deliberately modify already-generated snapshots only
    // inside rolled-back transactions. They are not generation fixtures.
    for (const variant of ['legacy', 'partial', 'invalid-version', 'v1', 'malformed-amount', 'malformed-minutes', 'net-mismatch', 'duplicate-link', 'conflicting-link', 'partial-aggregate']) {
      const tx = await db.transaction();
      try {
        const selected = tx('invoice_time_entries').where({ tenant, invoice_id: result.invoice_id });
        if (variant === 'legacy') await selected.update({ work_item_snapshot: null });
        else if (variant === 'duplicate-link' || variant === 'conflicting-link') {
          await tx('invoice_time_entries').insert({ ...links[0], invoice_time_entry_id: randomUUID(), item_id: variant === 'duplicate-link' ? links[0].item_id : links[1].item_id });
        } else if (variant === 'partial-aggregate') {
          // Disclosed historical aggregate: attach a second generated link, whose
          // missing snapshot must invalidate the whole owning charge.
          await tx('invoice_time_entries').where({ tenant, invoice_time_entry_id: links[1].invoice_time_entry_id }).update({ item_id: links[0].item_id, work_item_snapshot: null });
        }
        else {
          const original = links[0].work_item_snapshot;
          const snapshot = variant === 'partial' ? null
            : variant === 'malformed-amount' ? { ...original, netAmount: 'not-money' }
            : variant === 'malformed-minutes' ? { ...original, billedMinutes: -1 }
            : variant === 'net-mismatch' ? { ...original, netAmount: original.netAmount + 1 }
            : { ...original, version: variant === 'v1' ? 1 : 99 };
          await selected.andWhere({ entry_id: links[0].entry_id }).update({ work_item_snapshot: snapshot });
        }
        const historical = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(tx, tenant, result.invoice_id))!;
        for (const charge of adjustmentCharges) {
          const contributions = historical.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id);
          expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
          if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
        }
        if (variant === 'legacy') expect(historical.ticketPresentationRows).toHaveLength(adjustmentCharges.length);
        if (variant !== 'legacy' && variant !== 'v1') expect(historical.ticketPresentationRows!.some((r) => r.id === links[0].item_id)).toBe(true);
        fs.writeFileSync(`${evidenceDir}/history-${variant}.json`, JSON.stringify(historical, null, 2));
        if (variant === 'v1') expect(historical.timeEntries!.find((e) => e.id === links[0].entry_id)?.rateKind).toBe('unknown');
      } finally { await tx.rollback(); }
    }


  } finally { await db.destroy(); }
}, process.env.TEST_DB_BACKEND === 'citus' ? 30 * 60_000 : 120000);
