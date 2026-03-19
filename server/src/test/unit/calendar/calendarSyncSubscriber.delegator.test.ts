import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('calendarSyncSubscriber delegator', () => {
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

  it('no-ops in CE without loading the EE subscriber implementation', async () => {
    process.env.EDITION = 'ce';

    const eeRegister = vi.fn();
    const eeUnregister = vi.fn();

    vi.doMock('@alga-psa/ee-calendar/event-bus', () => ({
      registerCalendarSyncSubscriber: eeRegister,
      unregisterCalendarSyncSubscriber: eeUnregister,
    }));

    const subscriberModule = await import('@/lib/eventBus/subscribers/calendarSyncSubscriber');

    await subscriberModule.registerCalendarSyncSubscriber();
    await subscriberModule.unregisterCalendarSyncSubscriber();

    expect(eeRegister).not.toHaveBeenCalled();
    expect(eeUnregister).not.toHaveBeenCalled();
  });

  it('delegates to the EE subscriber implementation in enterprise mode', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeRegister = vi.fn(async () => undefined);
    const eeUnregister = vi.fn(async () => undefined);

    vi.doMock('@alga-psa/ee-calendar/event-bus', () => ({
      registerCalendarSyncSubscriber: eeRegister,
      unregisterCalendarSyncSubscriber: eeUnregister,
    }));

    const subscriberModule = await import('@/lib/eventBus/subscribers/calendarSyncSubscriber');

    await subscriberModule.registerCalendarSyncSubscriber();
    await subscriberModule.unregisterCalendarSyncSubscriber();

    expect(eeRegister).toHaveBeenCalledTimes(1);
    expect(eeUnregister).toHaveBeenCalledTimes(1);
  });

  it('keeps live sync imports out of the shared subscriber wrapper', () => {
    const serverRoot = process.cwd();
    const sharedSource = fs.readFileSync(
      path.join(serverRoot, 'src/lib/eventBus/subscribers/calendarSyncSubscriber.ts'),
      'utf8'
    );
    const eeSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts'),
      'utf8'
    );

    expect(sharedSource).toContain("@alga-psa/ee-calendar/event-bus");
    expect(sharedSource).not.toContain('CalendarSyncService');
    expect(sharedSource).not.toContain('CalendarProviderService');

    expect(eeSource).toContain('CalendarSyncService');
    expect(eeSource).toContain('CalendarProviderService');
  });
});
