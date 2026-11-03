import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { ApiFinancialController } from '../../../lib/api/controllers/ApiFinancialController';
import { createTestDbConnection, createTestTenant, type TenantTestData } from '../../e2e/helpers/testSetup';
import { wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';

type ApiContext = {
  tenant: string;
  userId: string;
  user: { user_id: string; tenant: string; user_type: 'internal' };
  apiKeyId: string;
};

describe('bulk invoice controller lifecycle integration', () => {
  let db: Knex;
  let primary: TenantTestData;
  let other: TenantTestData;
  let controller: ApiFinancialController;
  let apiContext: ApiContext;
  let roleId: string;
  const permissionIds = new Map<string, string>();

  const tenantTable = (tenant: string, name: string) => tenantDb(db, tenant).table(name);

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = createTestDbConnection();
    primary = await createTestTenant(db, { companyName: `Bulk invoice actor ${uuidv4().slice(0, 8)}` });
    other = await createTestTenant(db, { companyName: `Bulk invoice other ${uuidv4().slice(0, 8)}` });
    const tenant = primary.tenant.tenantId;
    const userId = primary.adminUser.userId;
    roleId = String((await tenantTable(tenant, 'user_roles').where({ user_id: userId }).first('role_id'))!.role_id);
    apiContext = {
      tenant,
      userId,
      user: { user_id: userId, tenant, user_type: 'internal' },
      apiKeyId: uuidv4(),
    };

    await grant(tenant, 'financial', 'update');
    await grant(tenant, 'invoice', 'finalize');
    await grant(tenant, 'invoice', 'void');
    controller = new ApiFinancialController();
    (controller as any).authenticate = async (request: any) => {
      request.context = apiContext;
      return request;
    };
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  async function grant(tenant: string, resource: string, action: string): Promise<string> {
    const existing = await tenantTable(tenant, 'permissions').where({ resource, action }).first('permission_id');
    const permissionId = existing?.permission_id ?? uuidv4();
    if (!existing) {
      await tenantTable(tenant, 'permissions').insert({
        permission_id: permissionId,
        tenant,
        resource,
        action,
        msp: true,
        client: false,
      });
    }
    await tenantTable(tenant, 'role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId })
      .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
    if (tenant === primary?.tenant.tenantId) permissionIds.set(`${resource}:${action}`, permissionId);
    return permissionId;
  }

  async function revoke(resource: string, action: string): Promise<void> {
    const permissionId = permissionIds.get(`${resource}:${action}`);
    if (permissionId) {
      await tenantTable(apiContext.tenant, 'role_permissions')
        .where({ role_id: roleId, permission_id: permissionId }).delete();
    }
  }

  async function seedInvoice(
    tenant: string,
    clientId: string,
    options: { finalized?: boolean; withCharge?: boolean; addPayment?: boolean } = {},
  ): Promise<string> {
    const invoiceId = uuidv4();
    const now = new Date().toISOString();
    await tenantTable(tenant, 'invoices').insert({
      invoice_id: invoiceId,
      tenant,
      client_id: clientId,
      invoice_number: `BULK-${invoiceId.slice(0, 8)}`,
      invoice_date: now,
      due_date: now,
      subtotal: 1500,
      tax: 0,
      total_amount: 1500,
      credit_applied: 0,
      currency_code: 'USD',
      status: options.finalized ? 'sent' : 'draft',
      finalized_at: options.finalized ? now : null,
      tax_source: 'internal',
      invoice_type: 'invoice',
      is_manual: true,
      created_at: now,
      updated_at: now,
    });
    if (options.withCharge !== false) {
      await tenantTable(tenant, 'invoice_charges').insert({
        item_id: uuidv4(),
        tenant,
        invoice_id: invoiceId,
        description: 'Bulk lifecycle test charge',
        quantity: 1,
        unit_price: 1500,
        net_amount: 1500,
        tax_amount: 0,
        total_price: 1500,
        is_manual: true,
        is_discount: false,
        is_taxable: false,
        created_at: now,
      });
    }
    if (options.addPayment) {
      await tenantTable(tenant, 'invoice_payments').insert({
        payment_id: uuidv4(),
        tenant,
        invoice_id: invoiceId,
        amount: 100,
        payment_date: now,
        created_at: now,
      });
    }
    return invoiceId;
  }

  async function post(operation: string, invoiceIds: string[], parameters?: Record<string, unknown>) {
    const request = new NextRequest('http://localhost/api/v1/financial/bulk/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ invoice_ids: invoiceIds, operation, parameters }),
    });
    return controller.bulkInvoiceOperations()(request);
  }

  async function responseBody(response: Response): Promise<any> {
    return response.json();
  }

  it('propagates API-key tenant and actor through the controller into real finalize and void engines', async () => {
    const draftId = await seedInvoice(apiContext.tenant, primary.client!.clientId);
    const finalizedId = await seedInvoice(apiContext.tenant, primary.client!.clientId, { finalized: true });

    const finalizedResponse = await post('finalize', [draftId]);
    expect(finalizedResponse.status).toBe(200);
    expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: draftId }).first())
      .toMatchObject({ status: 'sent', finalized_at: expect.anything() });

    const voidResponse = await post('cancel', [finalizedId], { reason: 'integration actor propagation' });
    expect(voidResponse.status).toBe(200);
    const voidResult = await responseBody(voidResponse);
    expect(voidResult.data.data).toMatchObject({ successful: 1, failed: 0 });
    expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: finalizedId }).first('status'))
      .toMatchObject({ status: 'cancelled' });
    expect(await tenantTable(apiContext.tenant, 'transactions').where({ invoice_id: finalizedId, type: 'invoice_cancelled' }).first())
      .toMatchObject({ metadata: expect.objectContaining({ voided_by: apiContext.userId, reason: 'integration actor propagation' }) });
  });

  it('keeps canonical guards mutation-free and rejects a cross-tenant invoice', async () => {
    const draftId = await seedInvoice(apiContext.tenant, primary.client!.clientId);
    const foreignId = await seedInvoice(other.tenant.tenantId, other.client!.clientId, { finalized: true });

    const response = await post('cancel', [draftId, foreignId]);
    const body = await responseBody(response);
    expect(response.status).toBe(200);
    expect(body.data.data).toMatchObject({ successful: 0, failed: 2 });
    expect(body.data.data.results.map((result: any) => result.error)).toEqual([
      expect.stringContaining('Drafts must be deleted'),
      expect.stringContaining('Invoice not found'),
    ]);
    expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: draftId }).first('status'))
      .toMatchObject({ status: 'draft' });
    expect(await tenantTable(other.tenant.tenantId, 'invoices').where({ invoice_id: foreignId }).first('status'))
      .toMatchObject({ status: 'sent' });
  });

  it('returns mixed per-invoice outcomes while allowing only guarded invoices to remain unchanged', async () => {
    const readyId = await seedInvoice(apiContext.tenant, primary.client!.clientId, { finalized: true });
    const draftId = await seedInvoice(apiContext.tenant, primary.client!.clientId);

    const response = await post('cancel', [readyId, draftId]);
    const body = await responseBody(response);
    expect(body.data.data).toMatchObject({ total_requested: 2, successful: 1, failed: 1 });
    expect(body.data.data.results.map((result: any) => result.success)).toEqual([true, false]);
    expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: readyId }).first('status'))
      .toMatchObject({ status: 'cancelled' });
    expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: draftId }).first('status'))
      .toMatchObject({ status: 'draft' });
  });

  it('rechecks permission before each invoice and reports revocation after the first commit', async () => {
    const firstId = await seedInvoice(apiContext.tenant, primary.client!.clientId, { finalized: true });
    const secondId = await seedInvoice(apiContext.tenant, primary.client!.clientId, { finalized: true });
    const service = (controller as any).financialService;
    const original = service.validatePermissions.bind(service);
    let checks = 0;
    vi.spyOn(service, 'validatePermissions').mockImplementation(async (...args: any[]) => {
      checks += 1;
      if (checks === 3) await revoke('invoice', 'void');
      return original(...args);
    });

    try {
      const response = await post('cancel', [firstId, secondId]);
      const body = await responseBody(response);
      expect(body.data.data).toMatchObject({ successful: 1, failed: 1 });
      expect(body.data.data.results[1].error).toMatch(/Permission denied/);
      expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: firstId }).first('status'))
        .toMatchObject({ status: 'cancelled' });
      expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: secondId }).first('status'))
        .toMatchObject({ status: 'sent' });
    } finally {
      vi.restoreAllMocks();
      await grant(apiContext.tenant, 'invoice', 'void');
    }
  });

  it.each(['send', 'apply_credit'])('rejects placeholder operation %s at controller schema validation', async (operation) => {
    const draftId = await seedInvoice(apiContext.tenant, primary.client!.clientId);
    const response = await post(operation, [draftId]);
    expect(response.status).toBe(400);
    expect(await tenantTable(apiContext.tenant, 'invoices').where({ invoice_id: draftId }).first('status'))
      .toMatchObject({ status: 'draft' });
  });
});
