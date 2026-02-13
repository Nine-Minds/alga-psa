import { describe, expect, it, vi } from 'vitest';

import { TacticalRmmClient } from '@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient';

describe('TacticalRmmClient.listAllBeta pagination', () => {
  it('iterates pages until next is null and caps page_size at 1000', async () => {
    const client = new TacticalRmmClient({
      baseUrl: 'https://tactical.example',
      authMode: 'api_key',
      apiKey: 'api_key',
    });

    const requestSpy = vi
      .spyOn(client, 'request')
      .mockImplementation(async (args: any) => {
        const page = Number(args?.params?.page || 1);
        const pageSize = Number(args?.params?.page_size);
        if (page === 1) {
          return { results: [{ id: 1 }, { id: 2 }], next: 'page2' } as any;
        }
        if (page === 2) {
          expect(pageSize).toBe(1000);
          return { results: [{ id: 3 }], next: null } as any;
        }
        throw new Error(`Unexpected page: ${page}`);
      });

    const res = await client.listAllBeta<{ id: number }>({
      path: '/api/beta/v1/site/',
      pageSize: 5000,
    });

    expect(res.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(requestSpy).toHaveBeenCalledTimes(2);

    expect((requestSpy.mock.calls[0]?.[0] as any)?.params?.page).toBe(1);
    expect((requestSpy.mock.calls[0]?.[0] as any)?.params?.page_size).toBe(1000);
    expect((requestSpy.mock.calls[1]?.[0] as any)?.params?.page).toBe(2);
    expect((requestSpy.mock.calls[1]?.[0] as any)?.params?.page_size).toBe(1000);
  });
});

