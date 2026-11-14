import { describe, expect, it, vi, beforeEach } from 'vitest';

const getServices = vi.fn();
vi.mock('../actions/serviceCatalogActions', () => ({ getServices: (...args: unknown[]) => getServices(...args) }));

import { loadServiceOptions } from './serviceOptions';

describe('loadServiceOptions', () => {
  beforeEach(() => {
    getServices.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns the catalog for a subject allowed to read it', async () => {
    getServices.mockResolvedValue({ services: [{ service_id: 's1', service_name: 'Managed backup' }], totalCount: 1, page: 1, pageSize: 999 });
    await expect(loadServiceOptions()).resolves.toEqual([{ service_id: 's1', service_name: 'Managed backup' }]);
    expect(getServices).toHaveBeenCalledWith(1, 999);
  });

  it('returns no options instead of rejecting when the commercial lookup is refused', async () => {
    getServices.mockRejectedValue(new Error('Permission denied: service or billing read required'));
    await expect(loadServiceOptions()).resolves.toEqual([]);
  });
});
