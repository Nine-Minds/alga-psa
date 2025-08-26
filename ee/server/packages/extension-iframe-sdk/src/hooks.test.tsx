import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { IframeBridge } from './bridge';
import { useBridge, useTheme, useAuthToken, useResize } from './hooks';

const VERSION = '1';

function dispatchFromParent(data: any, origin?: string) {
  const evt = new MessageEvent('message', {
    data,
    origin: origin ?? window.location.origin,
    source: window as any,
  });
  window.dispatchEvent(evt);
}

describe('SDK React hooks', () => {
  beforeEach(() => {
    (process.env as any).NODE_ENV = 'test';
    (window as any).__ALGA_DEV__ = true;
    document.documentElement.removeAttribute('style');
  });

  it('useBridge returns a stable bridge and sends ready() on mount', () => {
    const postSpy = vi.spyOn(window.parent as any, 'postMessage');
    const { result, rerender } = renderHook(() => useBridge());

    const bridge1 = result.current;
    expect(bridge1).toBeInstanceOf(IframeBridge);

    rerender();
    const bridge2 = result.current;
    expect(bridge2).toBe(bridge1);

    // ready() called on mount emits a "ready" envelope
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [envelope, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe('*');
    expect(envelope).toMatchObject({ alga: true, version: VERSION, type: 'ready', payload: {} });
  });

  it('useTheme returns tokens after bootstrap and reflects updates', () => {
    const wrapper = ({ children }: any) => children;
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin });
    const { result } = renderHook(() => useTheme(bridge), { wrapper });

    // initially null
    expect(result.current).toBeNull();

    // Send bootstrap with theme tokens
    act(() => {
      dispatchFromParent(
        {
          alga: true,
          version: VERSION,
          type: 'bootstrap',
          payload: {
            session: { token: 'tok', expires_at: '2099-01-01T00:00:00Z' },
            theme_tokens: { '--alga-primary': '#ff0000' },
            navigation: { path: '/' },
          },
        },
        window.location.origin
      );
    });

    // Hook updates with tokens
    expect(result.current).toBeTruthy();
    expect(result.current!['--alga-primary']).toBe('#ff0000');

    // And CSS variables were also applied to :root
    const applied = getComputedStyle(document.documentElement).getPropertyValue('--alga-primary').trim();
    expect(applied).toBe('#ff0000');
  });

  it('useAuthToken returns token after bootstrap and updates on refresh', () => {
    const wrapper = ({ children }: any) => children;
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin });
    const { result } = renderHook(() => useAuthToken(bridge), { wrapper });

    expect(result.current).toBeNull();

    act(() => {
      dispatchFromParent(
        {
          alga: true,
          version: VERSION,
          type: 'bootstrap',
          payload: {
            session: { token: 'abc123', expires_at: '2099-01-01T00:00:00Z' },
            theme_tokens: {},
            navigation: { path: '/' },
          },
        },
        window.location.origin
      );
    });

    expect(result.current).toBe('abc123');

    // Refresh token via another bootstrap
    act(() => {
      dispatchFromParent(
        {
          alga: true,
          version: VERSION,
          type: 'bootstrap',
          payload: {
            session: { token: 'def456', expires_at: '2099-01-01T00:00:00Z' },
            theme_tokens: {},
            navigation: { path: '/' },
          },
        },
        window.location.origin
      );
    });

    expect(result.current).toBe('def456');
  });

  it('useResize posts resize notifications with envelope', () => {
    const postSpy = vi.spyOn(window.parent as any, 'postMessage');
    const wrapper = ({ children }: any) => children;
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin, devAllowWildcard: true });

    const { result } = renderHook(() => useResize(bridge), { wrapper });

    act(() => {
      result.current(555);
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [envelope, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe('*');
    expect(envelope).toMatchObject({
      alga: true,
      version: VERSION,
      type: 'resize',
      payload: { height: 555 },
    });
  });
});