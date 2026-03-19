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

  it('T359/T360: fresh CE calendar action wrappers stay unavailable without invoking EE modules', async () => {
    process.env.EDITION = 'ce';

    const eeGetProviders = vi.fn(async () => ({ success: true, providers: [] }));

    vi.doMock('@alga-psa/ee-calendar/actions', () => ({
      getCalendarProvidersImpl: eeGetProviders,
    }));

    const actionsModule = await import('@alga-psa/integrations/actions/calendarActions');
    const result = await actionsModule.getCalendarProviders();

    expect(result).toEqual({
      success: false,
      error: 'Calendar sync is only available in Enterprise Edition.',
    });
    expect(eeGetProviders).not.toHaveBeenCalled();
  });

  it('T365/T366: CE sync requests for existing calendar provider ids fail closed before loading EE sync logic', async () => {
    process.env.EDITION = 'ce';

    const eeSyncProvider = vi.fn(async () => ({ success: true, started: true }));

    vi.doMock('@alga-psa/ee-calendar/actions', () => ({
      syncCalendarProviderImpl: eeSyncProvider,
    }));

    const actionsModule = await import('@alga-psa/integrations/actions/calendarActions');
    const result = await actionsModule.syncCalendarProvider('provider-1');

    expect(result).toEqual({
      success: false,
      error: 'Calendar sync is only available in Enterprise Edition.',
    });
    expect(eeSyncProvider).not.toHaveBeenCalled();
  });
});
