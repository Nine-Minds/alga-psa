// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import {
  computeNotificationSuppressionDefault,
  TicketNotificationDefaultsProvider,
  useDefaultNotificationSuppression,
  useDontNotifyCustomerDefault,
} from './notificationSuppressionDefaults';

function withProvider(dontNotifyCustomer: boolean) {
  return ({ children }: { children: ReactNode }) =>
    createElement(TicketNotificationDefaultsProvider, { dontNotifyCustomer, children });
}

describe('notificationSuppressionDefaults', () => {
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

    it('returns a fresh object each call so callers cannot share state', () => {
      expect(computeNotificationSuppressionDefault(false)).not.toBe(computeNotificationSuppressionDefault(false));
    });
  });

  describe('provider', () => {
    it('defaults to unticked without a provider (client portal)', () => {
      const { result } = renderHook(() => useDefaultNotificationSuppression());
      expect(result.current()).toEqual({
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      });
    });

    it('ticks only the customer box when the provider is on', () => {
      const { result } = renderHook(() => useDefaultNotificationSuppression(), { wrapper: withProvider(true) });
      expect(result.current()).toEqual({
        suppressContactNotifications: true,
        suppressInternalNotifications: false,
      });
    });

    it('exposes the raw flag', () => {
      expect(renderHook(() => useDontNotifyCustomerDefault(), { wrapper: withProvider(true) }).result.current).toBe(true);
      expect(renderHook(() => useDontNotifyCustomerDefault(), { wrapper: withProvider(false) }).result.current).toBe(false);
    });

    it('keeps the factory stable across renders while the value is unchanged', () => {
      const { result, rerender } = renderHook(() => useDefaultNotificationSuppression(), { wrapper: withProvider(true) });
      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });
  });
});