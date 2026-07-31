import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
