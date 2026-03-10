import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    (...args: any[]) => action({ tenant: 'tenant-1', user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

describe('calendar action CE boundary', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.EDITION;
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }

    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('returns enterprise-only availability without invoking the EE action module in CE', async () => {
    process.env.EDITION = 'ce';

    const eeGetProviders = vi.fn(async () => ({ success: true, providers: [] }));

    vi.doMock('@enterprise/lib/actions/integrations/calendarActions', () => ({
      getCalendarProvidersImpl: eeGetProviders,
    }));

    const actionsModule = await import('@/lib/actions/calendarActions');
    const result = await actionsModule.getCalendarProviders();

    expect(result).toEqual({
      success: false,
      error: 'Calendar sync is only available in Enterprise Edition.',
    });
    expect(eeGetProviders).not.toHaveBeenCalled();
  });
});
