import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getApiKeyUserOverride } from '@alga-psa/auth';
import { getTenantContext } from '@alga-psa/db';

const createAccountingExportBatchMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/billing/actions', () => ({
  createAccountingExportBatch: createAccountingExportBatchMock,
  appendAccountingExportLines: vi.fn(),
  appendAccountingExportErrors: vi.fn(),
  updateAccountingExportBatchStatus: vi.fn(),
  getAccountingExportBatch: vi.fn(),
  listAccountingExportBatches: vi.fn(),
  executeAccountingExportBatch: vi.fn()
}));

import { ApiAccountingExportController } from '../../../lib/api/controllers/ApiAccountingExportController';

describe('ApiAccountingExportController.createBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves each authenticated caller through concurrent sessionless action calls and clears the context afterwards', async () => {
    const controller = new ApiAccountingExportController();
    const internals = controller as any;
    vi.spyOn(internals, 'authenticate').mockImplementation(async (request: any) => {
      const tenant = request.headers.get('x-fixture-tenant');
      request.context = { tenant, userId: `user-${tenant}`, user: {
        tenant, user_id: `user-${tenant}`, user_type: 'internal',
      } };
      return request;
    });
    vi.spyOn(internals, 'authorize').mockResolvedValue(undefined);
    let entered = 0;
    let release!: () => void;
    const bothEntered = new Promise<void>(resolve => { release = resolve; });
    createAccountingExportBatchMock.mockImplementation(async () => {
      if (++entered === 2) release();
      await bothEntered;
      const user = getApiKeyUserOverride();
      if (!user) throw new Error('Authenticated API identity was lost before the server action');
      expect(await getTenantContext()).toBe(user.tenant);
      return { batch_id: `batch-${user.tenant}`, created_by: user.user_id };
    });
    const responses = await Promise.all(['one', 'two'].map(tenant => controller.createBatch(new NextRequest(
      'http://localhost/api/accounting/exports', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-tenant': tenant },
        body: JSON.stringify({ adapter_type: 'xero', export_type: 'invoice' }),
      },
    ))));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(await Promise.all(responses.map(response => response.json()))).toEqual([
      { batch_id: 'batch-one', created_by: 'user-one' },
      { batch_id: 'batch-two', created_by: 'user-two' },
    ]);
    expect(getApiKeyUserOverride()).toBeUndefined();
  });

  it('returns a conflict response when the server action reports a duplicate export', async () => {
    createAccountingExportBatchMock.mockResolvedValue({
      success: false,
      code: 'ACCOUNTING_EXPORT_DUPLICATE',
      message: 'An export batch already exists for this filter selection'
    });

    const controller = new ApiAccountingExportController();
    const controllerInternals = controller as unknown as {
      authenticate: (request: NextRequest) => Promise<NextRequest>;
      authorize: () => Promise<void>;
    };
    vi.spyOn(controllerInternals, 'authenticate').mockImplementation(async (request: NextRequest) => {
      const authenticatedRequest = request as NextRequest & {
        context: { tenant: string; userId: string; user: { user_type: string } };
      };
      authenticatedRequest.context = {
        tenant: 'tenant-1',
        userId: 'user-1',
        user: { user_type: 'internal' }
      };
      return authenticatedRequest;
    });
    vi.spyOn(controllerInternals, 'authorize').mockResolvedValue(undefined);

    const response = await controller.createBatch(new NextRequest(
      'http://localhost/api/accounting/exports',
      {
        method: 'POST',
        body: JSON.stringify({ adapter_type: 'xero', export_type: 'invoice' }),
        headers: { 'content-type': 'application/json' }
      }
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'ACCOUNTING_EXPORT_DUPLICATE',
      message: 'An export batch already exists for this filter selection'
    });
  });
});
