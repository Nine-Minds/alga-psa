import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createAccountingFixture } from '../fixtures/accounting';

type Organisation = { tenantId: string; tenantName: string };
type Invoice = { InvoiceID: string; xeroTenantId: string; InvoiceNumber: string;
  Contact: { ContactID: string }; LineItems: Array<{ LineAmount: number; ItemCode?: string }> };
const settingsURL = '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero';
test.use({ emulatorProviders: ['xero'] });

if (process.env.E2E_EDITION !== 'enterprise') {
  test('community refuses the enterprise Xero OAuth connection', async ({ request }) => {
    const response = await request.get('/api/integrations/xero/connect');
    expect(response.status()).toBe(501);
    expect(await response.json()).toEqual({ error: 'Xero integration is only available in Enterprise Edition.' });
  });
} else {
  test('Xero OAuth and UI mapping export to the selected organisation and recover without duplicate invoices', async ({ page, credentials, database, emulators }) => {
    test.setTimeout(300000);
    const [unselected] = await emulators.state('xero', 'organisations') as Organisation[];
    const organisation = await emulators.seed('xero', 'organisation', { tenantName: 'Browser selected organisation' }) as Organisation;
    // The shipped integration uses the first connected organisation. Choose
    // that provider response before OAuth; Alga must persist and display it.
    await emulators.action('xero', 'select-organisation', { xeroTenantId: organisation.tenantId });
    const customer = await emulators.seed('xero', 'contact', {
      xeroTenantId: organisation.tenantId, name: 'Browser accounting customer',
    }) as { ContactID: string };
    await emulators.seed('xero', 'contact', { xeroTenantId: unselected.tenantId, name: 'Browser accounting customer' });
    const accounting = await createAccountingFixture(database, credentials.email, {
      adapter: 'xero', realmId: organisation.tenantId, customerId: customer.ContactID,
    });
    const { tenant, service, invoice } = accounting;
    const scope = { tenant: tenant.tenantId };
    const mappingScope = { ...scope, integration_type: 'xero', external_realm_id: organisation.tenantId };
    await signIn(page, { email: tenant.admin.email, password: credentials.password });
    await page.goto(settingsURL);
    await page.locator('#xero-client-id').fill('browser-xero-client');
    await page.locator('#xero-client-secret').fill('browser-xero-secret');
    await page.locator('#xero-settings-save').click();
    await expect(page.getByText('Xero credentials saved. You can now start the live Xero OAuth flow.', { exact: true })).toBeVisible();
    await page.locator('#xero-connect-button').click();
    await expect(page).toHaveURL(/xero_status=success/);
    const connection = page.locator('#xero-integration-connection-card');
    await expect(connection).toContainText(organisation.tenantName);
    await page.reload();
    await expect(connection).toContainText(organisation.tenantName);

    await page.locator('#add-xero-live-item-mapping-button').click();
    const mappingDialog = page.getByRole('dialog', { name: 'Add Live Xero Service Mapping' });
    await mappingDialog.locator('#xero-live-service-mappings-alga-select').click();
    await page.getByRole('option', { name: service.name, exact: true }).click();
    await mappingDialog.locator('#xero-live-service-mappings-external-select').click();
    await page.getByRole('option', { name: 'Item · Consulting Services (CONSULT)', exact: true }).click();
    await mappingDialog.getByRole('button', { name: 'Save Mapping', exact: true }).click();
    await expect(mappingDialog).toBeHidden();
    await page.reload();
    await expect(page.locator('[data-automation-id="xero-live-item-mappings-table"]')).toContainText(service.name);
    expect(await database('tenant_external_entity_mappings')
      .where({ ...mappingScope, alga_entity_type: 'service', alga_entity_id: service.id })
      .select('external_entity_id')).toEqual([{ external_entity_id: 'CONSULT' }]);

    await page.goto('/msp/billing?tab=accounting-exports');
    await page.locator('#accounting-exports-new-batch').click();
    await page.locator('#accounting-export-adapter').click();
    await page.getByRole('option', { name: 'Xero', exact: true }).click();
    await page.locator('#accounting-export-client-search').fill(tenant.clients.primary.name);
    await page.locator('#accounting-export-statuses').fill('sent');
    await page.locator('#accounting-export-create-submit').click();
    await expect(page.getByRole('dialog', { name: 'Accounting Export Batch', exact: true })).toBeVisible();
    const batches = await database('accounting_export_batches').where({ ...scope, adapter_type: 'xero' });
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.target_realm).toBe(organisation.tenantId);
    expect(await database('accounting_export_lines').where({ ...scope, batch_id: batch.batch_id })
      .select('document_id', 'document_line_id')).toEqual([{ document_id: invoice.id, document_line_id: invoice.chargeId }]);
    const batchStatus = async () => (await database('accounting_export_batches').where({ ...scope, batch_id: batch.batch_id }).first())?.status;

    await emulators.arm('xero', 'transport:error', { status: 500, rate: 1 });
    await page.locator('#accounting-exports-detail-execute').click();
    await expect.poll(batchStatus, { timeout: 90000 }).toBe('failed');
    expect(await emulators.state('xero', 'invoices')).toEqual([]);
    expect(await database('tenant_external_entity_mappings').where({ ...mappingScope, alga_entity_type: 'invoice', alga_entity_id: invoice.id })).toEqual([]);
    await page.reload();
    const row = page.getByRole('row').filter({ has: page.locator(`#accounting-exports-open-${batch.batch_id}`) });
    await expect(row).toContainText('Failed');
    await emulators.disarm('xero', 'transport:error');
    await emulators.action('xero', 'expire-access-tokens');
    await page.locator(`#accounting-exports-open-${batch.batch_id}`).click();
    await page.locator('#accounting-exports-detail-execute').click();
    await expect.poll(batchStatus, { timeout: 90000 }).toBe('delivered');
    const remote = await emulators.state('xero', 'invoices') as Invoice[];
    expect(remote).toHaveLength(1);
    expect(remote[0]).toMatchObject({ xeroTenantId: organisation.tenantId, InvoiceNumber: invoice.number,
      Contact: { ContactID: customer.ContactID },
      LineItems: [expect.objectContaining({ LineAmount: invoice.amountCents / 100, ItemCode: 'CONSULT' })],
    });
    expect(await database('tenant_external_entity_mappings').where({ ...mappingScope, alga_entity_type: 'invoice', alga_entity_id: invoice.id })
      .select('external_entity_id')).toEqual([{ external_entity_id: remote[0].InvoiceID }]);
    await page.reload();
    await expect(row).toContainText('Delivered');
    await page.locator('#accounting-exports-new-batch').click();
    await page.locator('#accounting-export-adapter').click();
    await page.getByRole('option', { name: 'Xero', exact: true }).click();
    await page.locator('#accounting-export-client-search').fill(tenant.clients.primary.name);
    await page.locator('#accounting-export-create-submit').click();
    await expect(page.getByText('No invoices match the selected filters (or all matching invoices have already been exported).', { exact: true })).toBeVisible();
    expect(await database('accounting_export_batches').where({ ...scope, adapter_type: 'xero' })).toHaveLength(1);
    expect(await emulators.state('xero', 'invoices')).toEqual(remote);
    const history = await emulators.requests('xero');
    expect(history.complete).toBe(true);
    expect(history.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/identity/connect/authorize', status: 302 }),
      expect.objectContaining({ method: 'POST', path: '/connect/token', status: 200 }),
      expect.objectContaining({ status: 500 }),
      expect.objectContaining({ status: 401 }),
      expect.objectContaining({ method: 'POST', path: '/api.xro/2.0/Invoices', status: 200 }),
    ]));
  });
}
