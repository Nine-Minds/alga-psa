import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiProjectController } from '../../../lib/api/controllers/ApiProjectController';
import { ApiFinancialController } from '../../../lib/api/controllers/ApiFinancialController';

const deniedError = {
  name: 'ProductAccessError',
  message: 'Denied by product',
  code: 'PRODUCT_ACCESS_DENIED',
  statusCode: 403,
  status: 403,
};

describe('api controller product access coverage', () => {
  it('project list returns 403 product denial when authenticate rejects, before listing data', async () => {
    const controller = new ApiProjectController();
    const listSpy = vi.spyOn((controller as any).projectService, 'list');
    vi.spyOn(controller as any, 'authenticate').mockRejectedValue(deniedError);

    const response = await controller.list()(
      new NextRequest('http://localhost:3000/api/v1/projects', {
        method: 'GET',
        headers: { 'x-api-key': 'test-key' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe('PRODUCT_ACCESS_DENIED');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('financial list returns 403 product denial when authenticate rejects, before listing data', async () => {
    const controller = new ApiFinancialController();
    const listSpy = vi.spyOn((controller as any).financialService, 'listTransactions');
    vi.spyOn(controller as any, 'authenticate').mockRejectedValue(deniedError);

    const response = await controller.listTransactions()(
      new NextRequest('http://localhost:3000/api/v1/financial/transactions', {
        method: 'GET',
        headers: { 'x-api-key': 'test-key' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe('PRODUCT_ACCESS_DENIED');
    expect(listSpy).not.toHaveBeenCalled();
  });
});
