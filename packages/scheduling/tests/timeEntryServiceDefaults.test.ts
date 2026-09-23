import { describe, expect, it, vi } from 'vitest';
import { resolveDefaultTimeEntryService } from '../src/lib/timeEntryServiceDefaults';

describe('resolveDefaultTimeEntryService precedence', () => {
  it('uses the client default when it validates', async () => {
    const validate = vi.fn(async () => true);

    const result = await resolveDefaultTimeEntryService({
      clientDefaultServiceId: 'client-service',
      tenantDefaultServiceId: 'tenant-service',
      validate,
    });

    expect(result).toEqual({ serviceId: 'client-service', source: 'client' });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith('client-service');
  });

  it('falls back to the tenant default when the client has none', async () => {
    const validate = vi.fn(async () => true);

    const result = await resolveDefaultTimeEntryService({
      clientDefaultServiceId: null,
      tenantDefaultServiceId: 'tenant-service',
      validate,
    });

    expect(result).toEqual({ serviceId: 'tenant-service', source: 'tenant' });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith('tenant-service');
  });

  it('falls through to the tenant default when the client default is invalid', async () => {
    const validate = vi.fn(async (serviceId: string) => serviceId === 'tenant-service');

    const result = await resolveDefaultTimeEntryService({
      clientDefaultServiceId: 'stale-client-service',
      tenantDefaultServiceId: 'tenant-service',
      validate,
    });

    expect(result).toEqual({ serviceId: 'tenant-service', source: 'tenant' });
    expect(validate).toHaveBeenNthCalledWith(1, 'stale-client-service');
    expect(validate).toHaveBeenNthCalledWith(2, 'tenant-service');
  });

  it('returns an empty service when every candidate is invalid', async () => {
    const validate = vi.fn(async () => false);

    const result = await resolveDefaultTimeEntryService({
      clientDefaultServiceId: 'inactive-service',
      tenantDefaultServiceId: 'missing-service',
      validate,
    });

    expect(result).toEqual({ serviceId: null, source: null });
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('returns an empty service when nothing is configured', async () => {
    const validate = vi.fn(async () => true);

    const result = await resolveDefaultTimeEntryService({
      clientDefaultServiceId: null,
      tenantDefaultServiceId: undefined,
      validate,
    });

    expect(result).toEqual({ serviceId: null, source: null });
    expect(validate).not.toHaveBeenCalled();
  });
});
