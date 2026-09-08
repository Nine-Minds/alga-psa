import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import dotenv from 'dotenv';

// Opt-in local acceptance fixture. Uses the wired stack, creates only synthetic source
// records, and leaves the invoice for live designer/PDF inspection. Authentication is
// supplied by a real fixture user's identity; charge math, DB, transactions and reads
// are not mocked. No completed snapshots are inserted.
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
    const tenant = state.tenant, userId = state.user.user_id;
    const clientId = randomUUID(), contractId = randomUUID(), lineId = randomUUID(), serviceId = randomUUID(), cycleId = randomUUID(), profileId = randomUUID(), usageLineId = randomUUID(), usageServiceId = randomUUID();
    await db.transaction(async (tx) => {
      const baseClient = await tx('clients').where({ tenant }).first();
      await tx('clients').insert({ ...baseClient, client_id: clientId, client_name: `Invoice ticket acceptance ${clientId.slice(0,6)}`, billing_email: 'billing@example.invalid', billing_contact_id: null, invoice_template_id: null, notes_document_id: null, auto_invoice: false, default_currency_code: 'USD', is_tax_exempt: false });
      await tx('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId, name: 'Default', is_default: true, is_system_managed_default: true, is_active: true, billing_email: 'billing@example.invalid' });
      await tx('client_billing_cycles').insert({ tenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId, billing_cycle: 'monthly', effective_date: '2026-09-01', period_start_date: '2026-09-01', period_end_date: '2026-10-01', is_active: true });
      await tx('contracts').insert({ tenant, contract_id: contractId, contract_name: `Invoice ticket acceptance ${clientId.slice(0,6)}`, billing_frequency: 'monthly', is_active: true, status: 'active', currency_code: 'USD', owner_client_id: clientId });
      await tx('client_contracts').insert({ tenant, client_contract_id: randomUUID(), client_id: clientId, contract_id: contractId, start_date: '2026-07-01', is_active: true });
      await tx('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Ticket acceptance hourly', contract_line_type: 'Hourly', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true, enable_overtime: true, overtime_threshold: 1, overtime_rate: 22500 });
      const baseService = await tx('service_catalog').where({ tenant, billing_method: 'hourly' }).first();
      if (!baseService) throw new Error('Live fixture needs an existing hourly service type');
      await tx('service_catalog').insert({ ...baseService, service_id: serviceId, service_name: `Ticket acceptance hourly ${clientId.slice(0,6)}`, default_rate: 15000, tax_rate_id: null });
      await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: serviceId, currency_code: 'USD', rate: 15000 });
      const configId = randomUUID();
      await tx('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId, quantity: 1, custom_rate: 15000 });
      await tx('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Hourly', custom_rate: 15000, quantity: 1 });
      await tx('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
      await tx('contract_lines').insert({ tenant, contract_line_id: usageLineId, contract_id: contractId, contract_line_name: 'Ticket acceptance usage', contract_line_type: 'Usage', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true });
      await tx('service_catalog').insert({ ...baseService, service_id: usageServiceId, service_name: `Ticket acceptance usage ${clientId.slice(0,6)}`, billing_method: 'usage', default_rate: 5000, tax_rate_id: null });
      await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: usageServiceId, currency_code: 'USD', rate: 5000 });
      const usageConfigId = randomUUID();
      await tx('contract_line_services').insert({ tenant, contract_line_id: usageLineId, service_id: usageServiceId, quantity: 1, custom_rate: 5000 });
      await tx('contract_line_service_configuration').insert({ tenant, config_id: usageConfigId, contract_line_id: usageLineId, service_id: usageServiceId, configuration_type: 'Usage', custom_rate: 5000, quantity: 1 });
      await tx('contract_line_service_usage_config').insert({ tenant, config_id: usageConfigId, unit_of_measure: 'unit', base_rate: 5000 });
      await tx('usage_tracking').insert({ tenant, usage_id: randomUUID(), service_id: usageServiceId, client_id: clientId, contract_line_id: usageLineId, usage_date: '2026-08-15', quantity: 1, invoiced: false });
      const baseTicket = await tx('tickets').where({ tenant }).first();
      for (let i = 0; i < 2; i++) {
        const ticketId = randomUUID();
        await tx('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `DRAFT-${clientId.slice(0,6)}-${i}`, title: `Public ticket ${i}`, attributes: { description: `Public work ${i}`, internal_note: 'PRIVATE_SENTINEL' }, client_id: clientId, status_id: baseTicket.status_id, board_id: baseTicket.board_id, priority_id: baseTicket.priority_id, entered_by: userId, entered_at: new Date() });
        for (let j = 0; j < 2; j++) {
          const minutes = i === 0 && j === 0 ? 120 : 60;
          await tx('time_entries').insert({ tenant, entry_id: randomUUID(), user_id: userId, start_time: `2026-08-${15+i}T10:00:00Z`, end_time: `2026-08-${15+i}T${minutes===120?12:11}:00:00Z`, work_timezone: 'UTC', work_date: `2026-08-${15+i}`, work_item_id: ticketId, work_item_type: 'ticket', approval_status: 'APPROVED', service_id: serviceId, contract_line_id: lineId, billable_duration: minutes, invoiced: false, notes: 'PRIVATE_TIME_SENTINEL' });
        }
      }
    });
    // Isolated tax configuration: never changes a shared service or tax region.
    const taxRateId = randomUUID(), regionCode = `DRAFT-${clientId}`;
    await db('tax_regions').insert({ tenant, region_code: regionCode, region_name: 'Acceptance 10%' });
    await db('tax_rates').insert({ tenant, tax_rate_id: taxRateId, region_code: regionCode, tax_percentage: 10, start_date: '2026-01-01', is_active: true });
    await db('client_tax_rates').insert({ tenant, client_id: clientId, tax_rate_id: taxRateId, is_default: true });
    await db('client_tax_settings').insert({ tenant, client_id: clientId, billing_profile_id: profileId, is_reverse_charge_applicable: false });
    await db('service_catalog').where({ tenant }).whereIn('service_id', [serviceId, usageServiceId]).update({ tax_rate_id: taxRateId });
    if (customize) await customize({ tenant, userId, clientId, contractId, lineId, serviceId, cycleId, profileId, usageLineId, usageServiceId, taxRateId, regionCode });
    const { syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync');
    await db.transaction((tx) => syncRecurringServicePeriodsForContractLine(tx, { tenant, contractLineId: lineId, sourceRunPrefix: 'invoice-ticket-acceptance' }));
    await db.transaction((tx) => syncRecurringServicePeriodsForContractLine(tx, { tenant, contractLineId: usageLineId, sourceRunPrefix: 'invoice-ticket-acceptance' }));
    return { tenant, userId, clientId, contractId, lineId, serviceId, cycleId, profileId, usageLineId, usageServiceId, taxRateId, regionCode };
}

it.runIf(process.env.INVOICE_TICKET_LIVE === '1')('generates immutable ticket presentation from approved source records', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first();
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
}, 120000);

it.runIf(process.env.INVOICE_TICKET_CUSTOM === '1')('renders the UI-saved transformed detail and primary tables through preview and PDF', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first();
    state.tenant = state.user.tenant;
    const tenant = state.tenant;
    if (!process.env.INVOICE_TICKET_CUSTOM_NUMBER || !process.env.INVOICE_TICKET_CUSTOM_TEMPLATE) {
      throw new Error('Set INVOICE_TICKET_CUSTOM_NUMBER and INVOICE_TICKET_CUSTOM_TEMPLATE to the UI-verified invoice and saved layout.');
    }
    const invoice = await db('invoices').where({ tenant, invoice_number: process.env.INVOICE_TICKET_CUSTOM_NUMBER }).first();
    const template = await db('invoice_templates').where({ tenant, template_id: process.env.INVOICE_TICKET_CUSTOM_TEMPLATE }).first();
    expect(template.templateAst.transforms.sourceBindingId).toBe('timeEntries');
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const { resolveCanvasCollection } = await import('@alga-psa/billing/components/invoice-designer/preview/previewBindings');
    const { evaluateTemplateAst } = await import('@alga-psa/billing/lib/invoice-template-ast/evaluator');
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const vm = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, tenant, invoice.invoice_id))!;
    const ast = template.templateAst;
    fs.writeFileSync(`${evidenceDir}/custom-template.json`, JSON.stringify(ast, null, 2));
    const evaluation = evaluateTemplateAst(ast, vm as unknown as Record<string, unknown>);
    const tables: any[] = [];
    const visit = (node: any) => { if (node.type === 'dynamic-table') tables.push(node); (node.children ?? []).forEach(visit); };
    visit(ast.layout);
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      const source = table.repeat.sourceBinding.bindingId;
      expect(resolveCanvasCollection(vm, source, ast)).toEqual({ rows: evaluation.bindings[source] });
    }
    expect(resolveCanvasCollection(vm, ast.transforms.outputBindingId, ast).rows).toHaveLength(4);
    expect(resolveCanvasCollection(vm, ast.transforms.outputBindingId, ast).rows.map((row) => row.amount)).toEqual([37500, 15000, 15000, 15000]);
    fs.writeFileSync(`${evidenceDir}/custom-canvas-rows.json`, JSON.stringify(tables.map((table) => ({
      source: table.repeat.sourceBinding.bindingId,
      ...resolveCanvasCollection(vm, table.repeat.sourceBinding.bindingId, ast),
    })), null, 2));
    const pdf = new PDFGenerationService(tenant);
    const preview = await pdf.renderInvoicePreview({ invoiceId: invoice.invoice_id, templateId: template.template_id });
    expect(preview.html).toContain('Tarifs variables');
    expect(preview.html).toContain('included in the charges above');
    fs.writeFileSync(`${evidenceDir}/custom-preview.html`, preview.html);
    fs.writeFileSync(`${evidenceDir}/custom.pdf`, await pdf.generatePDF({ invoiceId: invoice.invoice_id, userId: state.user.user_id, templateId: template.template_id }));
    const { execFileSync } = await import('node:child_process');
    const text = execFileSync('pdftotext', ['-layout', `${evidenceDir}/custom.pdf`, '-'], { encoding: 'utf8' });
    expect(text).toContain('375,00');
    expect(text).toContain('525,00');
    expect(text).toContain(new Intl.NumberFormat('fr', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(vm.total / 100));
    expect(text).not.toContain('EDITED');
    fs.writeFileSync(`${evidenceDir}/custom.txt`, text);
  } finally { await db.destroy(); }
}, 120000);

it.runIf(process.env.INVOICE_TICKET_EXTENDED === '1').each(['cap', 'recurring-cap', 'bucket', 'multi-tax-long', 'task-identities', 'hour-block'])('verifies %s production generation and persistence', async (variant) => {
  const dir = `${evidenceDir}/${variant}`;
  fs.mkdirSync(dir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first();
    state.tenant = state.user.tenant;
    let projectConfigId: string | undefined;
    let cappedProjectId: string | undefined;
    const taskIds: string[] = [];
    const blockEntryIds: string[] = [];
    let blockId: string | undefined;
    const ids = await createSourceFixture(db, async (ids) => {
      const { tenant, clientId, lineId, serviceId, contractId } = ids;
      if (variant === 'cap' || variant === 'recurring-cap') {
        const projectId = randomUUID(), phaseId = randomUUID(), taskId = randomUUID();
        projectConfigId = randomUUID();
        cappedProjectId = projectId;
        const baseProject = await db('projects').where({ tenant }).first();
        const basePhase = await db('project_phases').where({ tenant }).first();
        await db('projects').insert({ ...baseProject, project_id: projectId, client_id: clientId, project_name: 'Acceptance capped project', start_date: '2026-08-01', project_number: `CAP-${projectId.slice(0,6)}`, wbs_code: `CAP-${projectId}`, billing_profile_id: ids.profileId });
        await db('project_phases').insert({ ...basePhase, phase_id: phaseId, project_id: projectId, phase_name: 'Acceptance phase', wbs_code: `CAP-${phaseId}` });
        await db('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: 'Acceptance capped task', wbs_code: '1.1' });
        await db('project_billing_configs').insert({ tenant, config_id: projectConfigId, project_id: projectId, billing_model: 'time_and_materials', currency: 'USD', invoice_mode: variant === 'cap' ? 'standalone' : 'recurring', contract_id: variant === 'cap' ? null : contractId, cap_amount: 20000, cap_behavior: 'hard_cap' });
        const overtime = await db('time_entries').where({ tenant, contract_line_id: lineId, billable_duration: 120 }).first();
        await db('time_entries').where({ tenant, work_item_id: overtime.work_item_id }).update({ work_item_type: 'project_task', work_item_id: taskId, contract_line_id: variant === 'cap' ? null : lineId });
        // Standalone uncontracted project time exercises the supported cap path.
        if (variant === 'cap') await db('client_contracts').where({ tenant, client_id: clientId }).delete();
      }
      if (variant === 'task-identities') {
        const projectId = randomUUID(), phaseId = randomUUID();
        const baseProject = await db('projects').where({ tenant }).first();
        const basePhase = await db('project_phases').where({ tenant }).first();
        await db('projects').insert({ ...baseProject, project_id: projectId, client_id: clientId,
          project_name: 'Owned task identity acceptance', project_number: `TASK-${projectId.slice(0,6)}`,
          wbs_code: `TASK-${projectId}`, billing_profile_id: ids.profileId });
        await db('project_phases').insert({ ...basePhase, phase_id: phaseId, project_id: projectId, wbs_code: `TASK-${phaseId}` });
        const secondService = randomUUID(), configId = randomUUID();
        const original = await db('service_catalog').where({ tenant, service_id: serviceId }).first();
        await db('service_catalog').insert({ ...original, service_id: secondService, service_name: 'Second task service', default_rate: 18000 });
        await db('service_prices').insert({ tenant, price_id: randomUUID(), service_id: secondService, currency_code: 'USD', rate: 18000 });
        await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: secondService, quantity: 1, custom_rate: 18000 });
        await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: secondService, configuration_type: 'Hourly', custom_rate: 18000, quantity: 1 });
        await db('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
        const source = await db('time_entries').where({ tenant, contract_line_id: lineId, billable_duration: 60 }).first();
        for (let index = 0; index < 3; index++) {
          const taskId = randomUUID(); taskIds.push(taskId);
          await db('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId,
            task_name: index < 2 ? 'Same public task name' : '', description: null, wbs_code: `1.${index + 1}` });
          for (let entry = 0; entry < (index === 0 ? 2 : 1); entry++) {
            await db('time_entries').insert({ ...source, entry_id: randomUUID(), work_item_type: 'project_task',
              work_item_id: taskId, service_id: entry ? secondService : serviceId });
          }
        }
      }
      if (variant === 'hour-block') {
        // Source setup: granted prepaid block, followed by the real FIFO allocator.
        // The partially covered second entry supplies the supported non-contract
        // due selector; the first is fully covered and must persist as information.
        const blockService = randomUUID(); blockId = randomUUID();
        const original = await db('service_catalog').where({ tenant, service_id: serviceId }).first();
        await db('service_catalog').insert({ ...original, service_id: blockService, service_name: 'Acceptance prepaid support' });
        await db('service_prices').insert({ tenant, price_id: randomUUID(), service_id: blockService, currency_code: 'USD', rate: 15000 });
        await db('hour_blocks').insert({ tenant, block_id: blockId, client_id: clientId, service_id: blockService,
          total_minutes: 180, remaining_minutes: 180, hourly_rate: 15000, purchase_amount: 45000,
          currency_code: 'USD', status: 'active', purchased_at: '2026-09-01', created_by: ids.userId });
        const source = await db('time_entries').where({ tenant, contract_line_id: lineId, billable_duration: 60 }).first();
        const { allocateTimeEntry } = await import('@alga-psa/shared/billingClients/hourBlockService');
        for (const minutes of [60, 180]) {
          const entry = { ...source, entry_id: randomUUID(), contract_line_id: null, service_id: blockService,
            start_time: '2026-09-15T10:00:00Z', end_time: minutes === 60 ? '2026-09-15T11:00:00Z' : '2026-09-15T13:00:00Z',
            work_date: '2026-09-15', billable_duration: minutes };
          blockEntryIds.push(entry.entry_id);
          await db('time_entries').insert(entry);
          const allocations = await db.transaction((tx) => allocateTimeEntry(tx, tenant, clientId, entry));
          expect(allocations.reduce((sum, allocation) => sum + allocation.minutes, 0)).toBe(minutes === 60 ? 60 : 120);
        }
      }
      if (variant === 'bucket') {
        const bucketId = randomUUID();
        await db('contract_line_service_configuration').insert({ tenant, config_id: bucketId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Bucket' });
        await db('contract_line_service_bucket_config').insert({ tenant, config_id: bucketId, total_minutes: 60, overage_rate: 15000, allow_rollover: false });
        await db('contract_line_buckets').insert({ tenant, bucket_id: bucketId, contract_line_id: lineId, bucket_name: 'Acceptance included hour', total_minutes: 60, overage_rate: 15000, allow_rollover: false, covers_all_services: false });
        await db('contract_line_bucket_services').insert({ tenant, bucket_id: bucketId, contract_line_id: lineId, service_id: serviceId, burn_multiplier: 1 });
        const { findOrCreateCurrentBucketUsageRecord, reconcileBucketUsageRecord } = await import('@alga-psa/shared/billingClients/bucketUsageService');
        await db.transaction(async (tx) => {
          const usage = await findOrCreateCurrentBucketUsageRecord(tx, clientId, serviceId, '2026-08-15', lineId, tenant);
          await reconcileBucketUsageRecord(tx, usage.usage_id, tenant);
          const actual = await tx('bucket_usage').where({ tenant, usage_id: usage.usage_id }).first();
          expect(Number(actual.minutes_used)).toBe(300);
          expect(Number(actual.overage_minutes)).toBe(240);
          fs.writeFileSync(`${dir}/bucket-usage.json`, JSON.stringify(actual, null, 2));
        });
      }
      if (variant === 'multi-tax-long') {
        const secondService = randomUUID(), secondTax = randomUUID(), configId = randomUUID(), regionCode = `SECOND-${clientId}`;
        const original = await db('service_catalog').where({ tenant, service_id: serviceId }).first();
        await db('tax_regions').insert({ tenant, region_code: regionCode, region_name: 'Acceptance 20%' });
        await db('tax_rates').insert({ tenant, tax_rate_id: secondTax, region_code: regionCode, tax_percentage: 20, start_date: '2026-01-01', is_active: true });
        await db('client_tax_rates').insert({ tenant, client_id: clientId, tax_rate_id: secondTax, is_default: false });
        await db('service_catalog').insert({ ...original, service_id: secondService, service_name: 'Acceptance 20 percent service', tax_rate_id: secondTax });
        await db('service_prices').insert({ tenant, price_id: randomUUID(), service_id: secondService, currency_code: 'USD', rate: 15000 });
        await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: secondService, quantity: 1, custom_rate: 15000 });
        await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: secondService, configuration_type: 'Hourly', custom_rate: 15000, quantity: 1 });
        await db('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
        const overtime = await db('time_entries').where({ tenant, contract_line_id: lineId, billable_duration: 120 }).first();
        const single = await db('time_entries').where({ tenant, work_item_id: overtime.work_item_id, billable_duration: 60 }).first();
        await db('time_entries').where({ tenant, entry_id: single.entry_id }).update({ service_id: secondService });
        // Source entries, not manufactured renderer rows: a real long invoice.
        for (let i = 0; i < 70; i++) await db('time_entries').insert({ ...single, entry_id: randomUUID(), service_id: i % 2 ? secondService : serviceId, start_time: `2026-08-${String(17 + i % 10).padStart(2, '0')}T10:00:00Z`, end_time: `2026-08-${String(17 + i % 10).padStart(2, '0')}T11:00:00Z`, work_date: `2026-08-${String(17 + i % 10).padStart(2, '0')}` });
        await db('tickets').where({ tenant, client_id: clientId }).update({ title: 'Long public ticket title for nested detail wrapping and invoice readability', attributes: { description: 'Public investigation, remediation and validation across the customer environment. '.repeat(5) } });
      }
    });
    const { generateInvoice, generateProjectInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
    let result: any;
    if (variant === 'hour-block') {
      const { buildClientCadenceDueSelectionInput } = await import('@alga-psa/shared/billingClients/recurringRunExecutionIdentity');
      const { generateInvoiceForSelectionInputs } = await import('@alga-psa/billing/actions/invoiceGeneration');
      const periods = await db('recurring_service_periods').where({ tenant: ids.tenant, invoice_window_start: '2026-09-01', invoice_window_end: '2026-10-01' }).whereIn('obligation_id', [ids.lineId, ids.usageLineId]);
      const selectors = periods.map((period) => buildClientCadenceDueSelectionInput({ clientId: ids.clientId,
        scheduleKey: period.schedule_key, periodKey: period.period_key, windowStart: '2026-09-01', windowEnd: '2026-10-01' }));
      selectors.push(buildClientCadenceDueSelectionInput({ clientId: ids.clientId,
        scheduleKey: `schedule:${ids.tenant}:unresolved:time:${blockEntryIds[1]}`,
        periodKey: `period:2026-09-01:2026-10-01:unresolved:time:${blockEntryIds[1]}`,
        windowStart: '2026-09-01', windowEnd: '2026-10-01' }));
      fs.writeFileSync(`${dir}/selectors.json`, JSON.stringify(selectors, null, 2));
      result = await generateInvoiceForSelectionInputs(selectors);
    } else result = await (variant === 'cap' ? generateProjectInvoice(cappedProjectId!) : generateInvoice(ids.cycleId));
    expect(result.invoice_id, JSON.stringify(result)).toBeTruthy();
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const invoice = await Invoice.getFullInvoiceById(db, ids.tenant, result.invoice_id);
    const vm = mapDbInvoiceToWasmViewModel(invoice)!;
    const charges = await db('invoice_charges').where({ tenant: ids.tenant, invoice_id: result.invoice_id });
    const links = await db('invoice_time_entries').where({ tenant: ids.tenant, invoice_id: result.invoice_id });
    fs.writeFileSync(`${dir}/generated.json`, JSON.stringify({ ids, invoiceId: result.invoice_id, invoiceNumber: invoice!.invoice_number, charges, links, vm }, null, 2));
    for (const charge of charges) {
      const contributions = vm.ticketPresentationRows!.flatMap((r) => r.contributions).filter((c) => c.itemId === charge.item_id);
      expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
      if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
    }
    expect(vm.ticketPresentationRows!.reduce((sum, row) => sum + row.amount, 0)).toBe(vm.subtotal);
    expect(vm.tax).toBe(charges.reduce((sum, row) => sum + Number(row.tax_amount), 0));
    expect(vm.total).toBe(vm.subtotal + vm.tax);
    if (variant === 'cap' || variant === 'recurring-cap') {
      expect(vm.subtotal).toBe(variant === 'cap' ? 20000 : 55000); expect(vm.tax).toBe(variant === 'cap' ? 2000 : 5500);
      const cappedLinks = links.filter((link) => link.work_item_snapshot.workItemType === 'project_task');
      expect(cappedLinks).toHaveLength(2);
      for (const link of cappedLinks) {
        const charge = charges.find((c) => c.item_id === link.item_id)!;
        expect(Number(charge.net_amount)).not.toBe(link.work_item_snapshot.netAmount);
        expect(vm.ticketPresentationRows!.find((r) => r.id === link.item_id)).toMatchObject({ rateKind: 'unknown', rate: null });
        expect(link.work_item_snapshot.rateKind).not.toBe('uniform');
      }
      const usage = await db('project_billing_cap_usage').where({ tenant: ids.tenant, config_id: projectConfigId }).first();
      expect(Number(usage.billed_amount)).toBe(20000); expect(Number(usage.written_down_amount)).toBe(variant === 'cap' ? 25000 : 32500);
      fs.writeFileSync(`${dir}/cap-usage.json`, JSON.stringify(usage, null, 2));
      const { addManualItemsToInvoice } = await import('@alga-psa/billing/actions/invoiceModification');
      const adjusted = await addManualItemsToInvoice(result.invoice_id, [
        { description: 'Cap acceptance line discount', quantity: 1, rate: -1000, is_discount: true, discount_type: 'fixed', applies_to_item_id: charges.find((c) => Number(c.net_amount) > 0)!.item_id, is_taxable: false },
        { description: 'Cap acceptance negative credit', quantity: 1, rate: -500, is_taxable: false },
        { description: 'Cap acceptance information', quantity: 1, rate: 0, is_taxable: false },
      ] as any) as any;
      const adjustedVm = mapDbInvoiceToWasmViewModel(adjusted)!;
      expect(adjustedVm.subtotal).toBe(vm.subtotal - 1500); expect(adjustedVm.tax).toBe(vm.tax); expect(adjustedVm.total).toBe(vm.total - 1500);
      for (const description of ['Cap acceptance line discount', 'Cap acceptance negative credit', 'Cap acceptance information']) {
        expect(adjustedVm.ticketPresentationRows!.filter((row) => row.description === description)).toHaveLength(1);
      }
      expect(await db('invoice_time_entries').where({ tenant: ids.tenant, invoice_id: result.invoice_id })).toEqual(links);
      expect(adjustedVm.ticketPresentationRows!.reduce((sum, row) => sum + row.amount, 0)).toBe(adjustedVm.subtotal);
      fs.writeFileSync(`${dir}/inline-adjustments.json`, JSON.stringify(adjustedVm, null, 2));

    }
    if (variant === 'bucket') {
      const bucketCharges = charges.filter((charge) => charge.billing_charge_type === 'bucket');
      expect(bucketCharges).toHaveLength(1);
      expect(Number(bucketCharges[0].net_amount)).toBe(60000);
      expect(vm.ticketPresentationRows!.find((row) => row.id === bucketCharges[0].item_id)?.contributions).toEqual([{ itemId: bucketCharges[0].item_id, entryId: null, amount: 60000 }]);
      // The original source fixture intentionally has both Hourly and Bucket
      // configurations. Preserve its separate canonical charges and arithmetic.
      expect(vm.subtotal).toBe(147500);
      const periods = await db('recurring_service_periods').where({ tenant: ids.tenant, invoice_id: result.invoice_id });
      expect(periods.length).toBeGreaterThan(0);
      expect(periods.every((period) => period.lifecycle_state === 'billed' && period.invoice_charge_detail_id)).toBe(true);
      fs.writeFileSync(`${dir}/recurring-periods.json`, JSON.stringify(periods, null, 2));
      const before = await db('invoice_charges').where({ tenant: ids.tenant, invoice_id: result.invoice_id });
      expect((await generateInvoice(ids.cycleId) as any)?.invoice_id).toBeUndefined();
      expect(await db('invoice_charges').where({ tenant: ids.tenant, invoice_id: result.invoice_id })).toEqual(before);
    }
    if (variant === 'task-identities') {
      expect(links).toHaveLength(8);
      const tasks = vm.ticketGroups!.filter((group) => group.workItemType === 'project_task');
      expect(tasks).toHaveLength(3);
      expect(new Set(tasks.map((group) => group.workItemId))).toEqual(new Set(taskIds));
      expect(tasks.filter((group) => group.label === 'Same public task name')).toHaveLength(2);
      const mixed = tasks.find((group) => group.workItemId === taskIds[0])!;
      expect(new Set(mixed.entries.map((entry) => entry.serviceId)).size).toBe(2);
      expect(mixed).toMatchObject({ rateKind: 'mixed', rate: null, totalHours: 2, totalAmount: 33000 });
      expect(tasks.find((group) => group.workItemId === taskIds[2])).toMatchObject({ labelKey: 'time.task', ticketNumber: null });
      expect(vm.subtotal).toBe(150500);
      const { attachInvoiceTimeCollections } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
      const reordered = attachInvoiceTimeCollections({ ...vm }, [...invoice!.invoice_charges!].reverse());
      expect(reordered.ticketGroups).toEqual(vm.ticketGroups);
      expect(reordered.timeEntries).toEqual(vm.timeEntries);
      await db('project_tasks').where({ tenant: ids.tenant }).whereIn('task_id', taskIds).update({ task_name: 'EDITED PRIVATE SOURCE' });
      expect(mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, ids.tenant, result.invoice_id))).toEqual(vm);
    }
    if (variant === 'hour-block') {
      const information = charges.filter((charge) => charge.billing_charge_type === 'hour_block');
      expect(information).toHaveLength(1);
      expect(Number(information[0].net_amount)).toBe(0);
      expect(information[0].description).toContain('3.0 hrs consumed, 0.0 hrs remaining');
      expect(vm.ticketPresentationRows!.filter((row) => row.id === information[0].item_id)).toHaveLength(1);
      expect(vm.ticketPresentationRows!.find((row) => row.id === information[0].item_id)?.amount).toBe(0);
      // Prepaid information is not a recurring contract obligation and has no
      // configuration-backed detail. Preserve that accounting representation.
      const details = await db('invoice_charge_details').where({ tenant: ids.tenant }).whereIn('item_id', charges.map((charge) => charge.item_id));
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((detail) => new Date(detail.service_period_start).toISOString().startsWith('2026-08-01'))).toBe(true);
      expect(details.every((detail) => new Date(detail.service_period_end).toISOString().startsWith('2026-08-31'))).toBe(true);
      expect((await db('time_entries').where({ tenant: ids.tenant }).whereIn('entry_id', blockEntryIds)).every((entry) => entry.invoiced)).toBe(true);
      expect(Number((await db('hour_blocks').where({ tenant: ids.tenant, block_id: blockId }).first()).remaining_minutes)).toBe(0);
      fs.writeFileSync(`${dir}/persisted-prepaid.json`, JSON.stringify({ blockId, blockEntryIds, information, details }, null, 2));
    }
    if (variant === 'multi-tax-long') {
      expect(links).toHaveLength(74);
      expect(vm.subtotal).toBe(1137500); expect(vm.tax).toBe(167750);
      expect(vm.ticketPresentationRows!.find((row) => row.contributions.length > 2)?.taxRate).toBeUndefined();
    }
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const standard = await db('standard_invoice_templates').where({ standard_invoice_template_code: 'standard-invoice-by-ticket' }).first();
    const pdf = new PDFGenerationService(ids.tenant);
    const preview = await pdf.renderInvoicePreview({ invoiceId: result.invoice_id, templateId: standard.template_id });
    if (variant === 'hour-block') {
      expect(preview.html).toContain('3.0 hrs consumed, 0.0 hrs remaining');
      expect(preview.html).toContain('2026');
      expect(vm.items.some((item) => item.servicePeriodStart?.startsWith('2026-08-01') && item.servicePeriodEnd?.startsWith('2026-08-31'))).toBe(true);
    }
    fs.writeFileSync(`${dir}/preview.html`, preview.html);
    fs.writeFileSync(`${dir}/production.pdf`, await pdf.generatePDF({ invoiceId: result.invoice_id, userId: ids.userId, templateId: standard.template_id }));
  } finally { await db.destroy(); }
}, 180000);

it.runIf(Boolean(process.env.INVOICE_TICKET_REVIEW_LAYOUT))('saves and verifies a named nested alias on the generated long invoice through production preview/PDF', async () => {
  const dir = `${evidenceDir}/designer`;
  fs.mkdirSync(dir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first(); state.tenant = state.user.tenant;
    const generated = JSON.parse(fs.readFileSync(`${evidenceDir}/multi-tax-long/generated.json`, 'utf8'));
    const { getStandardTemplateAstByCode } = await import('@alga-psa/billing/lib/invoice-template-ast/standardTemplates');
    const { saveInvoiceTemplate } = await import('@alga-psa/billing/actions/invoiceTemplates');
    let templateId = process.env.INVOICE_TICKET_REVIEW_TEMPLATE;
    if (process.env.INVOICE_TICKET_REVIEW_LAYOUT === 'seed') {
      // Seed an existing custom layout through the supported save action. The
      // visual editor exposes collection selection, but no alias-declaration UI.
      const ast = structuredClone(getStandardTemplateAstByCode('standard-invoice-by-ticket'))!;
      ast.bindings!.collections!.nestedEntries = { id: 'nestedEntries', kind: 'collection', path: 'group.entries' };
      ast.transforms = { sourceBindingId: 'timeEntries', outputBindingId: 'selectedTime', operations: [{ id: 'mixed-filter', type: 'filter', predicate: { type: 'comparison', path: 'rateKind', op: 'eq', value: 'mixed' } }] };
      const columns: any[] = [
        { id: 'ticket', header: 'Ticket', value: { type: 'path', path: 'entry.ticketNumber' }, format: 'text' },
        { id: 'hours', header: 'Hours', value: { type: 'path', path: 'entry.hours' }, format: 'number' },
        { id: 'rate', header: 'Rate', value: { type: 'path', path: 'entry.rateDisplay' }, format: 'currency' },
        { id: 'amount', header: 'Amount', value: { type: 'path', path: 'entry.amount' }, format: 'currency' },
      ];
      const nested: any = { id: 'ticket-region', type: 'stack', direction: 'column', repeat: { sourceBinding: { bindingId: 'ticketGroups' }, itemBinding: 'group' }, children: [
        { id: 'ticket-label', type: 'text', content: { type: 'path', path: 'group.label' } },
        { id: 'entry-detail', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: 'nestedEntries' }, itemBinding: 'entry' }, columns },
      ] };
      const totalsIndex = ast.layout.children.findIndex((node) => node.id === 'totals-wrap');
      ast.layout.children.splice(totalsIndex < 0 ? ast.layout.children.length : totalsIndex, 0,
        { id: 'detail-notice', type: 'text', content: { type: 'literal', value: 'Billed-time detail — included in the charges above' } },
        { id: 'filtered-detail', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: 'selectedTime' }, itemBinding: 'entry' }, columns },
        nested);
      const saved = await saveInvoiceTemplate({ template_id: randomUUID(), name: 'Acceptance nested ticket detail', version: 1, is_default: false, templateAst: ast } as any);
      expect(saved.success, saved.error).toBe(true); templateId = saved.template!.template_id;
      await db('clients').where({ tenant: state.tenant, client_id: generated.ids.clientId }).update({ properties: { defaultLocale: 'fr' } });
      fs.writeFileSync(`${dir}/source.json`, JSON.stringify({ templateId, invoiceId: generated.invoiceId, invoiceNumber: generated.invoiceNumber }, null, 2));
    }
    expect(templateId).toBeTruthy();
    const template = await db('invoice_templates').where({ tenant: state.tenant, template_id: templateId }).first();
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const { evaluateTemplateAst } = await import('@alga-psa/billing/lib/invoice-template-ast/evaluator');
    const { resolveCanvasCollection, resolveCanvasRowScope } = await import('@alga-psa/billing/components/invoice-designer/preview/previewBindings');
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const vm = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, state.tenant, generated.invoiceId))!;
    const ast = template.templateAst;
    if (process.env.INVOICE_TICKET_REVIEW_LAYOUT === 'verify') {
      const region = ast.layout.children.find((node: any) => node.id === 'ticket-region');
      const detail = region.children.find((node: any) => node.id === 'entry-detail');
      expect(detail.repeat.sourceBinding.bindingId).toBe('nestedEntries');
      expect(detail.columns).toHaveLength(5);
      expect(ast.transforms.operations.some((op: any) => op.type === 'sort' && op.keys[0].path === 'rateDisplay')).toBe(true);
    }
    const scope = resolveCanvasRowScope(vm, ast, 'entry-detail');
    const nested = resolveCanvasCollection(vm, 'nestedEntries', ast, scope);
    expect(nested.rows).toHaveLength(72);
    expect(nested.rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(1102500);
    const evaluation = evaluateTemplateAst(ast, vm as any);
    const transformed = resolveCanvasCollection(vm, ast.transforms.outputBindingId, ast);
    expect(transformed.rows).toEqual(evaluation.bindings[ast.transforms.outputBindingId]);
    fs.writeFileSync(`${dir}/canvas.json`, JSON.stringify({ nested, transformed }, null, 2));
    fs.writeFileSync(`${dir}/saved-template.json`, JSON.stringify(ast, null, 2));
    const pdf = new PDFGenerationService(state.tenant);
    for (const locale of ['en', 'zz-unavailable', 'fr']) {
      await db('clients').where({ tenant: state.tenant, client_id: generated.ids.clientId }).update({ properties: { defaultLocale: locale } });
      const localized = await pdf.renderInvoicePreview({ invoiceId: generated.invoiceId, templateId });
      expect(localized.html).toContain(locale === 'fr' ? 'Tarifs variables' : 'Mixed rates');
      fs.writeFileSync(`${dir}/preview-${locale}.html`, localized.html);
      fs.writeFileSync(`${dir}/nested-${locale}.pdf`, await pdf.generatePDF({ invoiceId: generated.invoiceId, userId: state.user.user_id, templateId }));
    }
    const preview = await pdf.renderInvoicePreview({ invoiceId: generated.invoiceId, templateId });
    fs.writeFileSync(`${dir}/preview.html`, preview.html);
    expect(preview.html).toContain('375,00'); expect(preview.html).toContain('Tarifs variables');
    fs.writeFileSync(`${dir}/nested.pdf`, await pdf.generatePDF({ invoiceId: generated.invoiceId, userId: state.user.user_id, templateId }));
    const { execFileSync } = await import('node:child_process');
    const text = execFileSync('pdftotext', ['-layout', `${dir}/nested.pdf`, '-'], { encoding: 'utf8' });
    const info = execFileSync('pdfinfo', [`${dir}/nested.pdf`], { encoding: 'utf8' });
    fs.writeFileSync(`${dir}/nested.txt`, text); fs.writeFileSync(`${dir}/pdfinfo.txt`, info);
    expect(Number(info.match(/Pages:\s+(\d+)/)?.[1])).toBeGreaterThan(1);
    expect(text).toContain('375,00'); expect(text).toContain('Tarifs variables');
    expect(text).toContain('included in the charges above');
    expect(text.replace(/\s/g, '')).toContain(new Intl.NumberFormat('fr', { minimumFractionDigits: 2 }).format(vm.total / 100).replace(/\s/g, ''));
    const pages = text.split('\f');
    expect(pages.some((page) => page.includes('Sous-total') && page.includes('Taxes') && page.includes('Total'))).toBe(true);
    expect(text).not.toContain('PRIVATE');
    expect((preview.html.match(/150,00/g) ?? []).length).toBeGreaterThanOrEqual(73);
  } finally { await db.destroy(); }
}, 180000);

it.runIf(process.env.INVOICE_TICKET_DIAGNOSTICS === '1')('surfaces declared scalar and missing collection diagnostics through production preview and PDF', async () => {
  const dir = `${evidenceDir}/diagnostics`; fs.mkdirSync(dir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local')); Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first(); state.tenant = state.user.tenant;
    const generated = JSON.parse(fs.readFileSync(`${evidenceDir}/multi-tax-long/generated.json`, 'utf8'));
    const { saveInvoiceTemplate } = await import('@alga-psa/billing/actions/invoiceTemplates');
    const { getStandardTemplateAstByCode } = await import('@alga-psa/billing/lib/invoice-template-ast/standardTemplates');
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const sources = [];
    for (const path of ['invoiceNumber', 'missing.path']) {
      const ast = structuredClone(getStandardTemplateAstByCode('standard-invoice-by-ticket'))!;
      ast.bindings!.collections!.bad = { id: 'bad', kind: 'collection', path };
      ast.layout.children = [{ id: 'bad-table', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: 'bad' }, itemBinding: 'entry' }, columns: [{ id: 'amount', header: 'Amount', value: { type: 'path', path: 'entry.amount' }, format: 'currency' }] }];
      const saved = await saveInvoiceTemplate({ template_id: randomUUID(), name: `Acceptance diagnostic ${path}`, version: 1, is_default: false, templateAst: ast } as any);
      expect(saved.success, saved.error).toBe(true);
      const pdf = new PDFGenerationService(state.tenant), templateId = saved.template!.template_id;
      await expect(pdf.renderInvoicePreview({ invoiceId: generated.invoiceId, templateId })).rejects.toThrow(path);
      await expect(pdf.generatePDF({ invoiceId: generated.invoiceId, userId: state.user.user_id, templateId })).rejects.toThrow(path);
      sources.push({ path, templateId, invoiceId: generated.invoiceId, invoiceNumber: generated.invoiceNumber });
    }
    fs.writeFileSync(`${dir}/sources.json`, JSON.stringify(sources, null, 2));
  } finally { await db.destroy(); }
}, 120000);

it.runIf(process.env.INVOICE_TICKET_AUTH === '1')('generates through real authenticated HTTP and rejects foreign snapshot ownership', async () => {
  const dir = `${evidenceDir}/authenticated`;
  fs.mkdirSync(dir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local'));
  Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  let keyId: string | undefined;
  let foreignLinkId: string | undefined;
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first();
    state.tenant = state.user.tenant;
    const ids = await createSourceFixture(db);
    const period = await db('recurring_service_periods').where({ tenant: ids.tenant, obligation_id: ids.lineId, invoice_window_start: '2026-09-01' }).first();
    expect(period).toBeTruthy();
    const { buildClientCadenceDueSelectionInput } = await import('@alga-psa/shared/billingClients/recurringRunExecutionIdentity');
    const selector = buildClientCadenceDueSelectionInput({ clientId: ids.clientId, scheduleKey: period.schedule_key, periodKey: period.period_key, windowStart: '2026-09-01', windowEnd: '2026-10-01' });
    const { ApiKeyService } = await import('@alga-psa/auth');
    const key = await ApiKeyService.createApiKey(ids.userId, 'Temporary invoice acceptance HTTP key', new Date(Date.now() + 3600000), { tenantId: ids.tenant });
    keyId = key.api_key_id;
    const { execFileSync } = await import('node:child_process');
    // The browser supplies its actual signed-in MSP session. The HTTP server is
    // outside Vitest and has no test authentication mocks. Never log the key.
    const script = `(async () => { const r = await fetch('/api/v1/invoices/generate', { method:'POST', headers: ${JSON.stringify({ 'content-type': 'application/json', 'x-api-key': key.api_key, 'x-tenant-id': ids.tenant })}, body:${JSON.stringify(JSON.stringify({ selector_input: selector }))} }); return { status:r.status, body:await r.json() }; })()`;
    const envelope = JSON.parse(execFileSync('alga-dev', ['browser-eval', `--paneId=${process.env.INVOICE_TICKET_BROWSER_PANE}`, `--script=${script}`], { encoding: 'utf8', timeout: 90000 }));
    const response = envelope.result?.result;
    fs.writeFileSync(`${dir}/generation-response.json`, JSON.stringify(response ?? envelope, null, 2));
    expect(response?.status, JSON.stringify(response)).toBe(201);
    const invoiceId = response.body.data.invoice_id;
    const links = await db('invoice_time_entries').where({ tenant: ids.tenant, invoice_id: invoiceId });
    expect(links).toHaveLength(4);
    expect(JSON.stringify(links)).not.toContain('PRIVATE');
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const before = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, ids.tenant, invoiceId));
    // Deliberately malformed historical ownership, not a generation fixture.
    // The legacy FK permits another tenant's link to reference these IDs.
    foreignLinkId = randomUUID();
    const foreignTenant = randomUUID();
    await db('invoice_time_entries').insert({ ...links[0], invoice_time_entry_id: foreignLinkId, tenant: foreignTenant, work_item_snapshot: { ...links[0].work_item_snapshot, title: 'FOREIGN_PRIVATE_SENTINEL' } });
    const after = mapDbInvoiceToWasmViewModel(await Invoice.getFullInvoiceById(db, ids.tenant, invoiceId));
    expect(after).toEqual(before);
    const authenticatedRead = await fetch(`http://localhost:3967/api/v1/invoices/${invoiceId}`, { headers: { 'x-api-key': key.api_key, 'x-tenant-id': ids.tenant } });
    expect(authenticatedRead.status).toBe(200);
    const authenticatedBody = await authenticatedRead.json();
    expect(JSON.stringify(authenticatedBody)).not.toContain('PRIVATE');
    fs.writeFileSync(`${dir}/authenticated-read.json`, JSON.stringify(authenticatedBody, null, 2));
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const { getStandardTemplateAstByCode } = await import('@alga-psa/billing/lib/invoice-template-ast/standardTemplates');
    const pdf = new PDFGenerationService(ids.tenant);
    const ast = getStandardTemplateAstByCode('standard-invoice-by-ticket')!;
    const standard = await db('standard_invoice_templates').where({ standard_invoice_template_code: 'standard-invoice-by-ticket' }).first();
    const preview = await pdf.renderInvoicePreview({ invoiceId, templateAst: ast });
    expect(preview.html).not.toContain('PRIVATE');
    fs.writeFileSync(`${dir}/preview.html`, preview.html);
    fs.writeFileSync(`${dir}/invoice.pdf`, await pdf.generatePDF({ invoiceId, userId: ids.userId, templateId: standard.template_id }));
    const supporting = structuredClone(ast);
    supporting.transforms = { sourceBindingId: 'timeEntries', outputBindingId: 'private-check-detail', operations: [{ id: 'sort-detail', type: 'sort', keys: [{ path: 'amount', direction: 'desc' }] }] };
    supporting.layout.children.push({ id: 'private-check-table', type: 'dynamic-table', repeat: { sourceBinding: { bindingId: 'private-check-detail' }, itemBinding: 'entry' }, columns: [{ id: 'description', header: 'Public detail', value: { type: 'path', path: 'entry.description' } }] } as any);
    const detail = await pdf.renderInvoicePreview({ invoiceId, templateAst: supporting });
    expect(detail.html).not.toContain('PRIVATE');
    expect(detail.html).toContain('Public work');
    fs.writeFileSync(`${dir}/supporting-detail.html`, detail.html);
    const denied = await fetch(`http://localhost:3967/api/v1/invoices/${invoiceId}`, { headers: { 'x-api-key': key.api_key, 'x-tenant-id': foreignTenant } });
    expect([401, 403]).toContain(denied.status);
    fs.writeFileSync(`${dir}/ownership.json`, JSON.stringify({ invoiceId, sourceEntryCount: links.length, foreignLinkExcluded: true, wrongTenantHttpStatus: denied.status, renderedData: after }, null, 2));
  } finally {
    if (foreignLinkId) await db('invoice_time_entries').where({ invoice_time_entry_id: foreignLinkId }).delete();
    if (keyId) await db('api_keys').where({ tenant: state.tenant, api_key_id: keyId }).update({ active: false });
    await db.destroy();
  }
}, 120000);

it.runIf(process.env.INVOICE_TICKET_CLOSURE === '1')('verifies visually authored detail and historical locale matrix through persisted reads, preview and PDF', async () => {
  const dir = `${evidenceDir}/locale-matrix`; fs.mkdirSync(dir, { recursive: true });
  const env = dotenv.parse(fs.readFileSync('.env.local')); Object.assign(process.env, env, { DB_PORT: '5472' });
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: 5472, database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN } });
  try {
    state.user = await db('users').where({ email: 'invoice-draft-verifier@example.invalid' }).first(); state.tenant = state.user.tenant;
    const templateId = process.env.INVOICE_TICKET_CLOSURE_TEMPLATE!;
    expect(templateId).toBeTruthy();
    const template = await db('invoice_templates').where({ tenant: state.tenant, template_id: templateId }).first();
    const ast = template.templateAst;
    const walk = (node: any): any[] => [node, ...(node.children ?? []).flatMap(walk)];
    const nodes = walk(ast.layout);
    const region = nodes.find((node) => node.type === 'stack' && node.repeat?.itemBinding === 'group');
    expect(region.repeat.sourceBinding.bindingId).toBe('ticketGroups');
    const nested = region.children.find((node: any) => node.type === 'dynamic-table');
    expect(ast.bindings.collections[nested.repeat.sourceBinding.bindingId].path).toBe('group.entries');
    const flat = nodes.find((node) => node.repeat?.sourceBinding.bindingId === ast.transforms.outputBindingId);
    expect(flat.columns).toHaveLength(6); expect(nested.columns).toHaveLength(6);
    expect(ast.transforms.operations).toContainEqual(expect.objectContaining({ type: 'sort', keys: [{ path: 'date', direction: 'desc' }] }));
    fs.writeFileSync(`${dir}/ui-saved-template.json`, JSON.stringify(template, null, 2));
    const { generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration');
    const { default: Invoice } = await import('@alga-psa/billing/models/invoice');
    const { mapDbInvoiceToWasmViewModel } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters');
    const { PDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService');
    const { runAuthoritativeInvoiceTemplatePreview } = await import('@alga-psa/billing/actions/invoiceTemplatePreview');
    const { importTemplateAstToWorkspace } = await import('@alga-psa/billing/components/invoice-designer/ast/workspaceAst');
    const { resolveCanvasCollection, resolveCanvasRowScope, formatBoundValue } = await import('@alga-psa/billing/components/invoice-designer/preview/previewBindings');
    const { localizeTimePresentation } = await import('@alga-psa/billing/lib/invoice-template-ast/timePresentationLocalization');
    const { localizeTemplateAstForLocale } = await import('@alga-psa/billing/lib/invoice-template-ast/i18nLabels');
    const { execFileSync } = await import('node:child_process');
    const cases: any[] = ['task-identities', 'hour-block', 'multi-tax-long'].map((variant) => ({
      ...JSON.parse(fs.readFileSync(`${evidenceDir}/${variant}/generated.json`, 'utf8')), variant, origin: 'production generation',
    }));
    for (const variant of ['historical-fallbacks', 'historical-partial', 'historical-none']) {
      const ids = await createSourceFixture(db);
      const generated = await generateInvoice(ids.cycleId) as any;
      expect(generated.invoice_id).toBeTruthy();
      const before = await db('invoice_time_entries').where({ tenant: ids.tenant, invoice_id: generated.invoice_id }).orderBy('entry_id');
      // EXPLICIT HISTORICAL FIXTURES: generate supported owned time first, then
      // persist old/missing snapshot shapes. These mutations do not demonstrate
      // a supported orphan producer and are never a historical backfill.
      for (let index = 0; index < before.length; index++) {
        const original = before[index];
        let snapshot = structuredClone(original.work_item_snapshot);
        if (variant === 'historical-none' || (variant === 'historical-partial' && index === 0)) snapshot = null;
        else if (variant === 'historical-fallbacks') {
          if (index === 0) snapshot = { ...snapshot, workItemType: 'ad_hoc', workItemId: null, ticketNumber: null, title: null, description: 'Frozen historical public work' };
          if (index === 1) snapshot = { ...snapshot, workItemType: 'project_task', workItemId: randomUUID(), ticketNumber: null, title: null, description: null };
          if (index === 2) snapshot = { ...snapshot, ticketNumber: null, title: null, description: null };
          // Keep the real overtime snapshot mixed; v1 must display unknown even
          // if historical numeric rate fields happen to be populated.
          if (snapshot.rateKind !== 'mixed') snapshot = { ...snapshot, version: 1 };
        }
        await db('invoice_time_entries').where({ tenant: ids.tenant, invoice_time_entry_id: original.invoice_time_entry_id }).update({ work_item_snapshot: snapshot });
      }
      const after = await db('invoice_time_entries').where({ tenant: ids.tenant, invoice_id: generated.invoice_id }).orderBy('entry_id');
      fs.writeFileSync(`${dir}/${variant}-fixture.json`, JSON.stringify({ ids, invoiceId: generated.invoice_id, origin: 'supported generation followed by disclosed historical snapshot mutation', before, after }, null, 2));
      cases.push({ ids, variant, invoiceId: generated.invoice_id, origin: 'disclosed persisted historical fixture' });
    }
    const manifest: any[] = [];
    for (const fixture of cases) {
      const invoice = await Invoice.getFullInvoiceById(db, state.tenant, fixture.invoiceId);
      const vm = mapDbInvoiceToWasmViewModel(invoice)!;
      const frozen = JSON.stringify(vm);
      const links = await db('invoice_time_entries').where({ tenant: state.tenant, invoice_id: fixture.invoiceId });
      const charges = await db('invoice_charges').where({ tenant: state.tenant, invoice_id: fixture.invoiceId });
      for (const charge of charges) {
        const contributions = vm.ticketPresentationRows!.flatMap((row) => row.contributions).filter((c) => c.itemId === charge.item_id);
        expect(contributions.reduce((sum, c) => sum + c.amount, 0)).toBe(Number(charge.net_amount));
        if (contributions.some((c) => c.entryId === null)) expect(contributions).toHaveLength(1);
      }
      if (fixture.variant === 'historical-fallbacks') {
        expect(vm.ticketGroups!.some((group) => group.workItemType === 'ad_hoc')).toBe(true);
        expect(vm.timeEntries!.some((entry) => entry.rateKind === 'unknown' && entry.rate === null)).toBe(true);
      }
      for (const locale of ['en', 'fr', 'zz-unavailable']) {
        const prefix = `${dir}/${fixture.variant}-${locale}`;
        const localized = await localizeTemplateAstForLocale(ast, locale);
        const effectiveLocale = localized.locale ?? 'en';
        expect(effectiveLocale).toBe(locale === 'fr' ? 'fr' : 'en');
        const display = localizeTimePresentation(vm, localized.t);
        const workspace = importTemplateAstToWorkspace(ast);
        const authoritative = await runAuthoritativeInvoiceTemplatePreview({ workspace, invoiceData: vm, locale });
        expect(authoritative.success, JSON.stringify(authoritative)).toBe(true);
        expect(authoritative.effectiveLocale).toBe(effectiveLocale);
        const canvasFlat = resolveCanvasCollection(vm, flat.repeat.sourceBinding.bindingId, ast);
        const scope = resolveCanvasRowScope(vm, ast, nested.id);
        const canvasNested = resolveCanvasCollection(vm, nested.repeat.sourceBinding.bindingId, ast, scope);
        expect(canvasFlat.rows).toEqual([...(vm.timeEntries ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date))));
        expect(canvasNested.rows).toEqual(vm.ticketGroups?.[0]?.entries ?? []);
        await db('clients').where({ tenant: state.tenant, client_id: fixture.ids.clientId }).update({ properties: { defaultLocale: locale } });
        const pdf = new PDFGenerationService(state.tenant);
        expect(await pdf.resolveRenderLocale({ invoiceId: fixture.invoiceId })).toBe(effectiveLocale);
        const preview = await pdf.renderInvoicePreview({ invoiceId: fixture.invoiceId, templateId });
        fs.writeFileSync(`${prefix}.html`, preview.html);
        fs.writeFileSync(`${prefix}.pdf`, await pdf.generatePDF({ invoiceId: fixture.invoiceId, templateId, userId: state.user.user_id }));
        const text = execFileSync('pdftotext', ['-layout', `${prefix}.pdf`, '-'], { encoding: 'utf8' });
        fs.writeFileSync(`${prefix}.txt`, text);
        // -layout interleaves wrapped table columns, splitting labels; assert
        // containment against reading-order extraction and keep -layout as the
        // human-readable artifact.
        const flowText = execFileSync('pdftotext', [`${prefix}.pdf`, '-'], { encoding: 'utf8' });
        const compact = (value: string) => value.replace(/\s/g, '');
        const expected: string[] = [localized.t?.('time.detail', { defaultValue: 'Billed-time detail — included in the charges above' }) ?? 'Billed-time detail — included in the charges above'];
        if (display.timeEntries?.some((entry) => entry.rateKind === 'mixed')) expected.push(locale === 'fr' ? 'Tarifs variables' : 'Mixed rates');
        if (display.timeEntries?.some((entry) => entry.rateKind === 'unknown')) expected.push(locale === 'fr' ? 'Tarif indisponible' : 'Rate unavailable');
        if (display.ticketCoverageNote) expected.push(display.ticketCoverageNote);
        if (display.ticketDetailNote) expected.push(display.ticketDetailNote);
        if (fixture.variant === 'historical-fallbacks') expected.push(locale === 'fr' ? 'Autre temps facturé' : 'Other billed time', locale === 'fr' ? 'Tâche de projet' : 'Project task');
        if (fixture.variant === 'task-identities') expected.push('Same public task name', locale === 'fr' ? 'Tâche de projet' : 'Project task');
        for (const label of expected) {
          expect(compact(flowText), `${fixture.variant}/${locale}: ${label}`).toContain(compact(label));
          expect(compact(authoritative.render.html!), `${fixture.variant}/${locale} full preview: ${label}`).toContain(compact(label));
        }
        const money = formatBoundValue(vm.total, 'currency', vm.currencyCode, effectiveLocale)!;
        expect(compact(flowText)).toContain(compact(money));
        const dates = (vm.timeEntries ?? []).map((entry) => formatBoundValue(entry.date, 'date', vm.currencyCode, effectiveLocale)!);
        for (const date of dates) expect(compact(flowText)).toContain(compact(date));
        expect(text).not.toMatch(/PRIVATE|EDITED/);
        expect(flowText).not.toMatch(/PRIVATE|EDITED/);
        expect(JSON.stringify(vm)).toBe(frozen);
        expect(await db('invoice_time_entries').where({ tenant: state.tenant, invoice_id: fixture.invoiceId })).toEqual(links);
        if (fixture.variant === 'multi-tax-long') {
          const pages = text.split('\f').filter((page) => page.trim());
          expect(pages.length).toBeGreaterThan(2);
          expect(pages.filter((page) => /DATE|Date/.test(page)).length).toBeGreaterThan(2);
        }
        fs.writeFileSync(`${prefix}-canvas.json`, JSON.stringify({ flat: canvasFlat, nested: canvasNested, display, money, dates, expected, authoritative }, null, 2));
        manifest.push({ variant: fixture.variant, origin: fixture.origin, invoiceId: fixture.invoiceId, invoiceNumber: invoice!.invoice_number, templateId, locale, effectiveLocale, expected, money, dates: [...new Set(dates)], artifacts: prefix });
      }
      expect(await db('invoice_charges').where({ tenant: state.tenant, invoice_id: fixture.invoiceId })).toEqual(charges);
    }
    fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  } finally { await db.destroy(); }
}, 240000);
