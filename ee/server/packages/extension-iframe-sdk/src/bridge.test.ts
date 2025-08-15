import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IframeBridge } from './bridge';
import type { Envelope } from './types';

const VERSION = '1';

function dispatchFromParent(data: unknown, origin?: string) {
  // In JSDOM, we dispatch directly on window. origin must match expectedParentOrigin (location.origin)
  const evt = new MessageEvent('message', {
    data,
    origin: origin ?? window.location.origin,
    // jsdom does not provide a separate parent window; using window is acceptable here
    source: window as Window,
  });
  window.dispatchEvent(evt);
}

describe('IframeBridge (SDK client)', () => {
  beforeEach(() => {
    // Ensure clean state
    vi.restoreAllMocks();
    // Ensure dev mode so targetOrigin may be "*" safely for tests
    (process.env as any).NODE_ENV = 'test';
    (window as any).__ALGA_DEV__ = true;
    // Reset inline styles
    document.documentElement.removeAttribute('style');
  });

  it('ignores messages without proper envelope or wrong origin', () => {
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin });
    const spy = vi.fn();
    bridge.on(spy);

    // Wrong origin
    dispatchFromParent({ foo: 'bar' }, 'https://evil.example.com');
    // No envelope
    dispatchFromParent({ type: 'bootstrap', payload: {} }, window.location.origin);
    // Bad version
    dispatchFromParent({ alga: true, version: '999', type: 'bootstrap', payload: {} }, window.location.origin);

    expect(spy).not.toHaveBeenCalled();
  });

  it('handles bootstrap: applies theme tokens and stores session token', () => {
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin });
    const spy = vi.fn();
    bridge.on(spy);

    const envelope: Envelope<'bootstrap', {
      session: { token: string; expires_at: string };
      theme_tokens: Record<string, string>;
      navigation: { path: string };
    }> = {
      alga: true,
      version: VERSION,
      type: 'bootstrap',
      payload: {
        session: { token: 'abc123', expires_at: '2099-01-01T00:00:00Z' },
        theme_tokens: { '--alga-primary': '#123456', '--alga-bg': '#ffffff' },
        navigation: { path: '/' },
      },
    };

    dispatchFromParent(envelope, window.location.origin);

    // Listener receives the message
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0];
    expect(msg.type).toBe('bootstrap');

    // Theme applied to :root
    expect(getComputedStyle(document.documentElement).getPropertyValue('--alga-primary').trim()).toBe('#123456');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--alga-bg').trim()).toBe('#ffffff');

    // Token stored
    expect(bridge.getSessionToken()).toBe('abc123');
    expect(Object.keys(bridge.getThemeTokens())).toContain('--alga-primary');
  });

  it('ready() emits a versioned envelope to parent', () => {
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin, devAllowWildcard: true });
    const postSpy = vi.spyOn(window.parent as any, 'postMessage');

    bridge.ready('req-1');

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [envelope, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe('*'); // devAllowWildcard true in tests
    expect(envelope).toMatchObject({
      alga: true,
      version: VERSION,
      type: 'ready',
      request_id: 'req-1',
      payload: {},
    });
  });

  it('use resize emit helper: emitToHost("resize") sends envelope', () => {
    const bridge = new IframeBridge({ expectedParentOrigin: window.location.origin, devAllowWildcard: true });
    const postSpy = vi.spyOn(window.parent as any, 'postMessage');

    bridge.emitToHost('resize', { height: 777 }, 'rid-2');

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [envelope, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe('*');
    expect(envelope).toMatchObject({
      alga: true,
      version: VERSION,
      type: 'resize',
      request_id: 'rid-2',
      payload: { height: 777 },
    });
  });
});