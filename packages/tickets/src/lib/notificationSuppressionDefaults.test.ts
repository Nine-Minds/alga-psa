// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeNotificationSuppressionDefault,
  defaultNotificationSuppression,
  loadDontNotifyCustomerDefault,
  primeDontNotifyCustomerDefault,
  readDontNotifyCustomerDefault,
  resetDontNotifyCustomerDefaultCache,
  subscribeDontNotifyCustomerDefault,
} from './notificationSuppressionDefaults';

const getTicketingDisplaySettings = vi.fn();

vi.mock('../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: () => getTicketingDisplaySettings(),
}));

describe('notificationSuppressionDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDontNotifyCustomerDefaultCache();
  });

  afterEach(() => {
    resetDontNotifyCustomerDefaultCache();
  });

  describe('computeNotificationSuppressionDefault', () => {
    it('ticks only the customer box when the tenant default is on', () => {
      expect(computeNotificationSuppressionDefault(true)).toEqual({
        suppressContactNotifications: true,
        suppressInternalNotifications: false,
      });
    });

    it('returns an unticked pair when off or unset', () => {
      expect(computeNotificationSuppressionDefault(false)).toEqual({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
      expect(computeNotificationSuppressionDefault()).toEqual(computeNotificationSuppressionDefault(false));
    });
  });

  describe('cache', () => {
    it('reads false before anything is loaded', () => {
      expect(readDontNotifyCustomerDefault()).toBe(false);
      expect(defaultNotificationSuppression().suppressContactNotifications).toBe(false);
    });

    it('primes synchronously and notifies subscribers', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeDontNotifyCustomerDefault(listener);

      primeDontNotifyCustomerDefault(true);
      expect(readDontNotifyCustomerDefault()).toBe(true);
      expect(defaultNotificationSuppression()).toEqual({
        suppressContactNotifications: true,
        suppressInternalNotifications: false,
      });
      expect(listener).toHaveBeenCalledTimes(1);

      // Priming with the same value is a no-op.
      primeDontNotifyCustomerDefault(true);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      primeDontNotifyCustomerDefault(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadDontNotifyCustomerDefault', () => {
    it('loads the flag once and caches it', async () => {
      getTicketingDisplaySettings.mockResolvedValue({ defaultDontNotifyCustomer: true });

      await expect(loadDontNotifyCustomerDefault()).resolves.toBe(true);
      await expect(loadDontNotifyCustomerDefault()).resolves.toBe(true);
      expect(getTicketingDisplaySettings).toHaveBeenCalledTimes(1);
      expect(defaultNotificationSuppression().suppressContactNotifications).toBe(true);
    });

    it('shares one in-flight request between concurrent callers', async () => {
      let resolveSettings: (value: { defaultDontNotifyCustomer: boolean }) => void = () => {};
      getTicketingDisplaySettings.mockReturnValue(
        new Promise((resolve) => {
          resolveSettings = resolve;
        }),
      );

      const first = loadDontNotifyCustomerDefault();
      const second = loadDontNotifyCustomerDefault();
      resolveSettings({ defaultDontNotifyCustomer: true });

      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
      expect(getTicketingDisplaySettings).toHaveBeenCalledTimes(1);
    });

    it('fails open when the settings read throws', async () => {
      getTicketingDisplaySettings.mockRejectedValue(new Error('nope'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(loadDontNotifyCustomerDefault()).resolves.toBe(false);
      expect(readDontNotifyCustomerDefault()).toBe(false);
      consoleError.mockRestore();
    });

    it('treats a null settings payload as off', async () => {
      getTicketingDisplaySettings.mockResolvedValue(null);
      await expect(loadDontNotifyCustomerDefault()).resolves.toBe(false);
    });
  });
});
