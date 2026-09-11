import { randomUUID } from 'node:crypto';
import { test, expect, signIn } from '../fixtures/auth';
import { createTimeBillingFixture } from '../fixtures/time-billing';
import { assertInvoiceDownload } from '../fixtures/invoice-document';
import { createBrowserInvoiceTicketSourceFixture } from '../fixtures/invoice-ticket';
import { createBrowserApiKey } from '../fixtures/api-key';

test('authenticated invoice generation excludes foreign ticket snapshots from reads and downloaded PDF', async ({ page, database, credentials }, testInfo) => {
  test.setTimeout(180000);
  const billing = await createTimeBillingFixture(database, credentials.email);
  const tenant = billing.tenant.tenantId;
  const userId = billing.tenant.admin.userId;
  const ids = await createBrowserInvoiceTicketSourceFixture(database, { tenant, userId });
  const key = await createBrowserApiKey(database, userId, tenant);
  const headers = { 'x-api-key': key.api_key, 'x-tenant-id': tenant };
  let foreignLinkId: string | undefined;
  try {
    await signIn(page, { email: billing.tenant.admin.email, password: credentials.password });
    const period = await database('recurring_service_periods').where({ tenant, obligation_id: ids.lineId, invoice_window_start: '2026-09-01' }).first();
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
    const generated = await page.request.post('/api/v1/invoices/generate', { headers, data: { selector_input: selector } });
    expect(generated.status(), await generated.text()).toBe(201);
    const invoiceId = (await generated.json()).data.invoice_id;
    const links = await database('invoice_time_entries').where({ tenant, invoice_id: invoiceId });
    expect(links).toHaveLength(4);
    expect(JSON.stringify(links)).not.toContain('PRIVATE');
    const read = async () => {
      const response = await page.request.get(`/api/v1/invoices/${invoiceId}`, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const before = await read();
    foreignLinkId = randomUUID();
    await database('invoice_time_entries').insert({ ...links[0], invoice_time_entry_id: foreignLinkId,
      tenant: billing.actors.secondary.tenantId,
      work_item_snapshot: { ...links[0].work_item_snapshot, title: 'FOREIGN_PRIVATE_SENTINEL' } });
    const after = await read();
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('PRIVATE');
    const denied = await page.request.get(`/api/v1/invoices/${invoiceId}`, {
      headers: { ...headers, 'x-tenant-id': billing.actors.secondary.tenantId },
    });
    expect([401, 403]).toContain(denied.status());
    const invoice = await database('invoices').where({ tenant, invoice_id: invoiceId }).first();
    const client = await database('clients').where({ tenant, client_id: ids.clientId }).first();
    const service = await database('service_catalog').where({ tenant, service_id: ids.serviceId }).first();
    // This API selects the hourly obligation only: four regular hours at $150
    // plus one overtime hour at $225. Whole-cycle generation also includes usage.
    expect(Number(invoice.subtotal)).toBe(82500);
    const charges = await database('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every(charge => charge.service_id === ids.serviceId)).toBe(true);
    const unselectedUsage = await database('usage_tracking').where({ tenant, contract_line_id: ids.usageLineId });
    expect(unselectedUsage).toHaveLength(1);
    expect(unselectedUsage[0].invoiced).toBe(false);
    const usagePeriod = await database('recurring_service_periods').where({ tenant, obligation_id: ids.usageLineId }).first();
    expect(usagePeriod).toMatchObject({ lifecycle_state: 'generated', invoice_id: null });
    await page.goto(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${invoiceId}`);
    await expect(page.locator('#invoice-download-pdf')).toBeVisible();
    await assertInvoiceDownload(page, testInfo, { number: invoice.invoice_number, clientName: client.client_name,
      serviceName: service.service_name, amountCents: Number(invoice.total_amount), forbiddenText: ['PRIVATE'] });
  } finally {
    if (foreignLinkId) await database('invoice_time_entries').where({ invoice_time_entry_id: foreignLinkId, tenant: billing.actors.secondary.tenantId }).delete();
    await database('api_keys').where({ tenant, api_key_id: key.api_key_id }).delete();
  }
});
