import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import { ApiTestClient } from '../utils/apiTestHelpers';
import { createServiceRequestData } from '../utils/serviceTestData';
import {
  ensureApiServerRunning,
  resolveApiBaseUrl,
  stopApiServerIfStarted
} from '../utils/apiServerManager';

const TEST_TIMEOUT = 120_000;
const apiBaseUrl = resolveApiBaseUrl(process.env.TEST_API_BASE_URL);

type AccountingExportBatch = {
  batch_id: string;
  adapter_type: string;
  export_type: string;
  status: string;
};

type AccountingExportDetail = {
  batch: AccountingExportBatch;
  lines: Array<{
    line_id: string;
    status: string;
    invoice_id: string;
  }>;
  errors: Array<{
    error_id: string;
    code: string;
    message: string;
  }>;
};

describe('Accounting Exports API E2E', () => {
  let env: E2ETestEnvironment;
  let accountingClient: ApiTestClient;

  const createdBatchIds: string[] = [];
  const createdServiceIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdChargeIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeAll(async () => {
    await ensureApiServerRunning(apiBaseUrl);
    env = await setupE2ETestEnvironment({
      baseUrl: apiBaseUrl,
      clientName: 'Accounting Exports API Test Client',
      userName: 'accounting_exports_api_test'
    });

    accountingClient = new ApiTestClient({
      baseUrl: apiBaseUrl,
      apiKey: env.apiKey,
      headers: {
        'x-tenant-id': env.tenant
      }
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (!env) {
      await stopApiServerIfStarted();
      return;
    }
    try {
      if (createdChargeIds.length > 0) {
        await env.db('invoice_charges')
          .where('tenant', env.tenant)
          .whereIn('item_id', createdChargeIds)
          .delete();
      }

      if (createdTransactionIds.length > 0) {
        await env.db('transactions')
          .where('tenant', env.tenant)
          .whereIn('transaction_id', createdTransactionIds)
          .delete();
      }

      if (createdInvoiceIds.length > 0) {
        await env.db('invoices')
          .where('tenant', env.tenant)
          .whereIn('invoice_id', createdInvoiceIds)
          .delete();
      }

      if (createdBatchIds.length > 0) {
        await env.db('accounting_export_errors')
          .where('tenant', env.tenant)
          .whereIn('batch_id', createdBatchIds)
          .delete();

        await env.db('accounting_export_lines')
          .where('tenant', env.tenant)
          .whereIn('batch_id', createdBatchIds)
          .delete();

        await env.db('accounting_export_batches')
          .where('tenant', env.tenant)
          .whereIn('batch_id', createdBatchIds)
          .delete();
      }

      if (createdServiceIds.length > 0) {
        await env.db('service_catalog')
          .where('tenant', env.tenant)
          .whereIn('service_id', createdServiceIds)
          .delete();
      }

      await env.cleanup();
    } finally {
      await stopApiServerIfStarted();
    }
  }, TEST_TIMEOUT);

  it('creates and lists accounting export batches', async () => {
    const createResponse = await accountingClient.post<AccountingExportBatch>(
      '/api/accounting/exports',
      {
        adapter_type: 'quickbooks_online',
        export_type: 'invoice',
        filters: {
          startDate: '2025-01-01',
          endDate: '2025-01-31',
          invoiceStatuses: ['sent']
        },
        created_by: env.userId,
        notes: 'E2E batch creation test'
      }
    );

    expect(createResponse.status).toBe(201);
    const createdBatch = createResponse.data;
    expect(createdBatch.batch_id).toBeDefined();
    createdBatchIds.push(createdBatch.batch_id);

    const listResponse = await accountingClient.get<AccountingExportBatch[]>(
      '/api/accounting/exports',
      { params: { adapter_type: 'quickbooks_online' } }
    );

    expect(listResponse.status).toBe(200);
    const listedIds = (listResponse.data || []).map((batch) => batch.batch_id);
    expect(listedIds).toContain(createdBatch.batch_id);

    const detailResponse = await accountingClient.get<AccountingExportDetail>(
      `/api/accounting/exports/${createdBatch.batch_id}`
    );

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.data.batch.batch_id).toBe(createdBatch.batch_id);
    expect(Array.isArray(detailResponse.data.lines)).toBe(true);
    expect(Array.isArray(detailResponse.data.errors)).toBe(true);
  }, TEST_TIMEOUT);

  it('appends lines without mappings and surfaces validation errors', async () => {
    const servicePayload = await createServiceRequestData(env.db, env.tenant, {
      service_name: 'Accounting Export API Service',
      billing_method: 'fixed',
      unit_of_measure: 'device'
    });

    const serviceResponse = await env.apiClient.post<{ data: { service_id: string } }>(
      '/api/v1/services',
      servicePayload
    );

    expect(serviceResponse.status).toBe(201);
    const serviceId = serviceResponse.data.data.service_id;
    createdServiceIds.push(serviceId);

    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    const transactionId = uuidv4();
    const now = new Date().toISOString();
    const invoiceNumber = `INV-${invoiceId.slice(0, 8)}`;

    await env.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: env.tenant,
      client_id: env.clientId,
      invoice_number: invoiceNumber,
      invoice_date: now,
      due_date: now,
      subtotal: 7500,
      tax: 0,
      total_amount: 7500,
      status: 'sent',
      currency_code: 'USD',
      billing_period_start: now,
      billing_period_end: now,
      is_manual: false,
      created_at: now,
      updated_at: now
    });
    createdInvoiceIds.push(invoiceId);

    await env.db('invoice_charges').insert({
      item_id: chargeId,
      tenant: env.tenant,
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Monthly service fee',
      quantity: 1,
      unit_price: 7500,
      net_amount: 7500,
      total_price: 7500,
      tax_amount: 0,
      is_manual: false,
      created_at: now,
      updated_at: now
    });
    createdChargeIds.push(chargeId);

    await env.db('transactions').insert({
      transaction_id: transactionId,
      tenant: env.tenant,
      client_id: env.clientId,
      invoice_id: invoiceId,
      amount: 7500,
      type: 'invoice_generated',
      description: 'Generated by Accounting Exports API test',
      status: 'completed',
      created_at: now,
      balance_after: 7500
    });
    createdTransactionIds.push(transactionId);

    const batchResponse = await accountingClient.post<AccountingExportBatch>(
      '/api/accounting/exports',
      {
        adapter_type: 'quickbooks_online',
        export_type: 'invoice',
        filters: {
          startDate: now.split('T')[0],
          endDate: now.split('T')[0],
          invoiceIds: [invoiceId]
        },
        created_by: env.userId,
        notes: 'Validation test batch'
      }
    );

    expect(batchResponse.status).toBe(201);
    const batch = batchResponse.data;
    createdBatchIds.push(batch.batch_id);

    const appendResponse = await accountingClient.post(
      `/api/accounting/exports/${batch.batch_id}/lines`,
      {
        lines: [
          {
            invoice_id: invoiceId,
            invoice_charge_id: chargeId,
            client_id: env.clientId,
            amount_cents: 7500,
            currency_code: 'USD',
            payload: {
              invoice_number: invoiceNumber,
              transaction_ids: [transactionId]
            }
          }
        ]
      }
    );

    expect(appendResponse.status).toBe(201);

    const detailAfterAppend = await accountingClient.get<AccountingExportDetail>(
      `/api/accounting/exports/${batch.batch_id}`
    );

    expect(detailAfterAppend.status).toBe(200);
    expect(detailAfterAppend.data.batch.status).toBe('needs_attention');
    expect(detailAfterAppend.data.errors.length).toBeGreaterThan(0);
    expect(detailAfterAppend.data.errors[0].code).toBe('missing_service_mapping');
  }, TEST_TIMEOUT);

  it('prevents duplicate batch creation using the same filter set', async () => {
    const filters = {
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      invoiceStatuses: ['sent']
    };

    const initialResponse = await accountingClient.post<AccountingExportBatch>(
      '/api/accounting/exports',
      {
        adapter_type: 'quickbooks_online',
        export_type: 'invoice',
        filters,
        created_by: env.userId,
        notes: 'Duplicate guard batch'
      }
    );

    expect(initialResponse.status).toBe(201);
    createdBatchIds.push(initialResponse.data.batch_id);

    const duplicateResponse = await accountingClient.post(
      '/api/accounting/exports',
      {
        adapter_type: 'quickbooks_online',
        export_type: 'invoice',
        filters,
        created_by: env.userId,
        notes: 'Duplicate guard batch'
      }
    );

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.data?.message || duplicateResponse.data?.error).toBeDefined();
  }, TEST_TIMEOUT);
});
