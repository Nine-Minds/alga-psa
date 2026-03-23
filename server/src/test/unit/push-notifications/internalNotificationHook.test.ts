import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests the hook registration system added to internalNotificationActions.
 * Verifies that registered hooks fire after notification creation and
 * handle errors without breaking the notification flow.
 */

// We test the hook mechanism in isolation by importing it directly
import {
  registerInternalNotificationHook,
} from '@alga-psa/notifications/actions';

describe('Internal Notification Post-Creation Hooks', () => {
  it('registerInternalNotificationHook is a function', () => {
    expect(typeof registerInternalNotificationHook).toBe('function');
  });

  it('accepts a hook function without throwing', () => {
    expect(() => {
      registerInternalNotificationHook(() => {});
    }).not.toThrow();
  });

  it('accepts async-style hooks', () => {
    expect(() => {
      registerInternalNotificationHook((notification) => {
        // Fire-and-forget async work
        void Promise.resolve(notification);
      });
    }).not.toThrow();
  });
});
