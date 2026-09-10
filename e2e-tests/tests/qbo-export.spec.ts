import { test as providerTest, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createAccountingFixture } from '../fixtures/accounting';

type Entity = { Id: string; SyncToken?: string; Name?: string; DocNumber?: string; TotalAmt?: number;
  CustomerRef?: { value: string }; Line?: Array<{ Amount: number; SalesItemLineDetail: { ItemRef: { value: string } } }> };
type AccountingFixture = Awaited<ReturnType<typeof createAccountingFixture>> & { item: Entity };
const settingsURL = '/msp/settings?tab=integrations&category=accounting&accounting_integration=qbo';
const clientId = 'browser-qbo-client';
const clientSecret = 'browser-qbo-secret';

const test = providerTest.extend<{ accounting: AccountingFixture }>({
  accounting: async ({ database, credentials, emulators }, use, testInfo) => {
    const realmId = 'browser-selected-company';
    await emulators.seed('qbo', 'client', { clientId, clientSecret });
    await emulators.seed('qbo', 'realm', { realmId });
    await emulators.action('qbo', 'select-company', { realmId });
    // Company-local IDs deliberately collide with the unselected company.
    for (const realm of ['realm-sim', realmId]) {
      await emulators.seed('qbo', 'customer', { realmId: realm, name: 'Browser accounting customer' });
      await emulators.seed('qbo', 'item', { realmId: realm, name: 'Browser accounting item', type: 'Service', unitPrice: 275 });
    }
    const [customer] = await emulators.action<Entity[]>('qbo', 'entities', { realmId, entityType: 'Customer' });
    const [item] = await emulators.action<Entity[]>('qbo', 'entities', { realmId, entityType: 'Item' });
    const data = await createAccountingFixture(database, credentials.email, {
      adapter: 'quickbooks_online', realmId, customerId: customer.Id,
    });
    const fixture = { ...data, item };
    await testInfo.attach('accounting-identities', { body: JSON.stringify(fixture), contentType: 'application/json' });
    await use(fixture);
  },
});
test.use({ emulatorProviders: ['qbo'] });

if (process.env.E2E_EDITION !== 'enterprise') {
  test('community refuses the enterprise QuickBooks OAuth connection', async ({ request }) => {
    const response = await request.get('/api/integrations/qbo/connect');
    expect(response.status()).toBe(501);
    expect(await response.json()).toEqual({ error: 'QuickBooks Online integration is only available in Enterprise Edition.' });
  });
} else {
  test('QuickBooks OAuth and UI mapping export to the selected company and recover without duplicate invoices', async ({ page, accounting, credentials, database, emulators }) => {
    test.setTimeout(300000);
    const { tenant, service, invoice, provider, item } = accounting;
    const scope = { tenant: tenant.tenantId };
    const mappingScope = { ...scope, integration_type: 'quickbooks_online', external_realm_id: provider.realmId };
    await signIn(page, { email: tenant.admin.email, password: credentials.password });
    await page.goto(settingsURL);
    await page.locator('#qbo-client-id').fill(clientId);
    await page.locator('#qbo-client-secret').fill(clientSecret);
    await page.locator('#qbo-settings-save').click();
    await expect(page.getByText('Credentials Ready', { exact: true })).toBeVisible();
    await page.locator('#qbo-connect-button').click();
    await expect(page).toHaveURL(/qbo_status=success/);
    const connection = page.locator('#qbo-integration-connection-card');
    await expect(connection).toContainText(provider.realmId);
    await page.reload();
    await expect(connection).toContainText(provider.realmId);

    await page.locator('#add-qbo-live-item-mapping-button').click();
    const mappingDialog = page.getByRole('dialog', { name: 'Add Live QuickBooks Item Mapping' });
    await mappingDialog.locator('#qbo-live-service-mappings-alga-select').click();
    await page.getByRole('option', { name: service.name, exact: true }).click();
    await mappingDialog.locator('#qbo-live-service-mappings-external-select').click();
    await page.getByRole('option', { name: item.Name!, exact: true }).click();
    await mappingDialog.getByRole('button', { name: 'Save Mapping', exact: true }).click();
    await expect(mappingDialog).toBeHidden();
    await page.reload();
    await expect(page.locator('[data-automation-id="qbo-live-item-mappings-table"]')).toContainText(service.name);
    expect(await database('tenant_external_entity_mappings')
      .where({ ...mappingScope, alga_entity_type: 'service', alga_entity_id: service.id })
      .select('external_entity_id')).toEqual([{ external_entity_id: item.Id }]);

    await page.goto('/msp/billing?tab=accounting-exports');
    await page.locator('#accounting-exports-new-batch').click();
    await page.locator('#accounting-export-adapter').click();
    await page.getByRole('option', { name: 'QuickBooks Online', exact: true }).click();
    await page.locator('#accounting-export-client-search').fill(tenant.clients.primary.name);
    await page.locator('#accounting-export-statuses').fill('sent');
    await page.locator('#accounting-export-create-submit').click();
    const detail = page.getByRole('dialog', { name: 'Accounting Export Batch', exact: true });
    await expect(detail).toBeVisible();
    const batches = await database('accounting_export_batches').where({ ...scope, adapter_type: 'quickbooks_online' });
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.target_realm).toBe(provider.realmId);
    expect(await database('accounting_export_lines').where({ ...scope, batch_id: batch.batch_id })
      .select('document_id', 'document_line_id')).toEqual([{ document_id: invoice.id, document_line_id: invoice.chargeId }]);

    await emulators.arm('qbo', 'transport:error', { status: 500, rate: 1 });
    await page.locator('#accounting-exports-detail-execute').click();
    await expect.poll(async () => (await database('accounting_export_batches').where({ ...scope, batch_id: batch.batch_id }).first())?.status,
      { timeout: 90000 }).toBe('failed');
    expect(await emulators.action('qbo', 'entities', { realmId: provider.realmId, entityType: 'Invoice' })).toEqual([]);
    expect(await database('tenant_external_entity_mappings').where({ ...mappingScope, alga_entity_type: 'invoice', alga_entity_id: invoice.id })).toEqual([]);
    expect((await emulators.requests('qbo')).requests.some(r => r.status === 500)).toBe(true);

    await emulators.disarm('qbo', 'transport:error');
    await emulators.action('qbo', 'expire-access-tokens');
    await page.locator('#accounting-exports-detail-refresh').click();
    await page.locator('#accounting-exports-detail-execute').click();
    await expect.poll(async () => (await database('accounting_export_batches').where({ ...scope, batch_id: batch.batch_id }).first())?.status,
      { timeout: 90000 }).toBe('delivered');
    const remote = await emulators.action<Entity[]>('qbo', 'entities', { realmId: provider.realmId, entityType: 'Invoice' });
    expect(remote).toHaveLength(1);
    expect(remote[0]).toMatchObject({ DocNumber: invoice.number, TotalAmt: invoice.amountCents / 100,
      CustomerRef: { value: provider.customerId },
      Line: [expect.objectContaining({ Amount: invoice.amountCents / 100, SalesItemLineDetail: expect.objectContaining({ ItemRef: { value: item.Id } }) })],
    });
    expect(await emulators.action('qbo', 'entities', { realmId: 'realm-sim', entityType: 'Invoice' })).toEqual([]);
    expect(await database('tenant_external_entity_mappings').where({ ...mappingScope, alga_entity_type: 'invoice', alga_entity_id: invoice.id })
      .select('external_entity_id')).toEqual([{ external_entity_id: remote[0].Id }]);

    await page.reload();
    const row = page.getByRole('row').filter({ has: page.locator(`#accounting-exports-open-${batch.batch_id}`) });
    await expect(row).toContainText('Delivered');
    await page.locator('#accounting-exports-new-batch').click();
    await page.locator('#accounting-export-adapter').click();
    await page.getByRole('option', { name: 'QuickBooks Online', exact: true }).click();
    await page.locator('#accounting-export-client-search').fill(tenant.clients.primary.name);
    await page.locator('#accounting-export-create-submit').click();
    await expect(page.getByText('No invoices match the selected filters (or all matching invoices have already been exported).', { exact: true })).toBeVisible();
    expect(await database('accounting_export_batches').where({ ...scope, adapter_type: 'quickbooks_online' })).toHaveLength(1);
    expect(await emulators.action('qbo', 'entities', { realmId: provider.realmId, entityType: 'Invoice' })).toEqual(remote);

    // An external bookkeeper edit must arrive through CDC. Keep Alga's stored
    // token stale so the actual re-export has to read the current vendor token.
    const invoiceMapping = () => database('tenant_external_entity_mappings')
      .where({ ...mappingScope, alga_entity_type: 'invoice', alga_entity_id: invoice.id }).first();
    const originalMapping = await invoiceMapping();
    const edited = await emulators.action<Entity>('qbo', 'rename-invoice', {
      realmId: provider.realmId, invoiceId: remote[0].Id, docNumber: 'BOOKKEEPER-EDIT',
    });
    expect(edited.Id).toBe(remote[0].Id);
    expect(edited.SyncToken).not.toBe(originalMapping.metadata.sync_token);
    await page.goto(settingsURL);
    await page.locator('#qbo-sync-now-button').click();
    await expect.poll(async () => (await invoiceMapping())?.sync_status).toBe('drift');
    const drift = await invoiceMapping();
    expect(drift.metadata.sync_token).toBe(originalMapping.metadata.sync_token);
    expect(drift.metadata.external_observed).toMatchObject({
      doc_number: 'BOOKKEEPER-EDIT', sync_token: edited.SyncToken,
    });

    await page.goto(`/msp/billing?tab=invoicing&subtab=finalized&invoiceId=${invoice.id}`);
    await page.locator('#invoice-drift-reexport-button').click();
    await expect(page.getByText('Re-export to QuickBooks queued.', { exact: true })).toBeVisible();
    await page.locator('#invoice-sync-now-button').click();
    await expect.poll(async () => (await invoiceMapping())?.sync_status,
      { timeout: 90000 }).toBe('synced');
    const restored = await emulators.action<Entity[]>('qbo', 'entities', {
      realmId: provider.realmId, entityType: 'Invoice',
    });
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ Id: remote[0].Id, DocNumber: invoice.number,
      TotalAmt: invoice.amountCents / 100, CustomerRef: { value: provider.customerId },
    });
    expect(restored[0].SyncToken).not.toBe(edited.SyncToken);
    expect((await invoiceMapping()).metadata.sync_token).toBe(restored[0].SyncToken);
    expect(await emulators.action('qbo', 'entities', { realmId: 'realm-sim', entityType: 'Invoice' })).toEqual([]);
    await page.reload();
    await expect(page.locator('#invoice-sync-now-button')).toBeVisible();
    await expect(page.locator('#invoice-drift-reexport-button')).toBeHidden();
    const history = await emulators.requests('qbo');
    expect(history.complete).toBe(true);
    expect(history.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/connect/oauth2', status: 302 }),
      expect.objectContaining({ method: 'POST', path: '/oauth2/v1/tokens/bearer', status: 200 }),
      expect.objectContaining({ status: 401 }),
      expect.objectContaining({ method: 'POST', path: `/v3/company/${provider.realmId}/invoice`, status: 200 }),
    ]));
  });
}
