import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
}));

import { ApiCountryController } from '../../../lib/api/controllers/ApiCountryController';
import type { AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';

class CountryController extends ApiCountryController {
  constructor(countryService: Record<string, unknown>) {
    super();
    (this as any).countryService = countryService;
  }

  protected async authenticate(req: NextRequest) {
    return Object.assign(req, { context: { tenant: 'test-tenant' } }) as AuthenticatedApiRequest;
  }
}

describe('GET /api/v1/countries', () => {
  it('returns the active countries for any authenticated caller', async () => {
    const listActive = vi.fn().mockResolvedValue([{ code: 'US', name: 'United States', phone_code: '+1' }]);
    const controller = new CountryController({ listActive });

    const response = await controller.list()(new NextRequest('http://localhost/api/v1/countries'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ code: 'US', name: 'United States', phone_code: '+1' }] });
    expect(listActive).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'test-tenant' }));
  });
});
