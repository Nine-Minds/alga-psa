/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { bootstrapIframe } from './iframeBridge';

function makeIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  // jsdom does not populate contentWindow; attach a stub for our tests
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: vi.fn(), close: vi.fn() },
    configurable: true,
  });
  // Attach to DOM so events behave more like real
  document.body.appendChild(iframe);
  return iframe;
}

function setEnvRunnerBase(value?: string) {
  if (value === undefined) {
    delete (process.env as any).RUNNER_PUBLIC_BASE;
  } else {
    (process.env as any).RUNNER_PUBLIC_BASE = value;
  }
}

describe('bootstrapIframe (host bridge)', () => {
  beforeEach(() => {
    // Use jsdom-like origin
    Object.defineProperty(window, 'location', { value: new URL('https://host.example.com/'), writable: true });
    // Default: not absolute so allowedOrigin not required
    setEnvRunnerBase('');
    // Clean DOM
    document.documentElement.innerHTML = '<head></head><body></body>';
    // Dev flag for safety in tests (code still computes explicit origin)
    (window as any).__ALGA_DEV__ = true;
    (process.env as any).NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies sandbox="allow-scripts" by default when none provided', () => {
    const iframe = makeIframe();
    // set a relative src to avoid absolute origin checks
    iframe.setAttribute('src', '/ext-ui/ext-1/sha256:'.concat('a'.repeat(64), '/index.html?path=/'));

    bootstrapIframe({
      iframe,
      extensionId: 'ext-1',
      contentHash: 'sha256:' + 'a'.repeat(64),
      session: { token: 't', expiresAt: '2099-01-01T00:00:00Z' },
      themeTokens: { '--alga-primary': '#f00' },
    });

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('throws when allowedOrigin mismatches iframe src origin and RUNNER_PUBLIC_BASE is absolute', () => {
    const iframe = makeIframe();
    setEnvRunnerBase('https://runner.example.com');
    // src hosted on runner.example.com
    iframe.setAttribute('src', 'https://runner.example.com/ext-ui/ext-1/sha256:'.concat('b'.repeat(64), '/index.html?path=/'));

    expect(() =>
      bootstrapIframe({
        iframe,
        extensionId: 'ext-1',
        contentHash: 'sha256:' + 'b'.repeat(64),
        session: { token: 'x', expiresAt: '2099-01-01T00:00:00Z' },
        themeTokens: {},
        allowedOrigin: 'https://wrong.example.com',
      })
    ).toThrow(/allowedOrigin mismatch/i);
  });

  it('sends bootstrap message with envelope version after load', () => {
    const iframe = makeIframe();
    // Ensure relative src and consistent origin derivation
    iframe.setAttribute('src', '/ext-ui/ext-2/sha256:'.concat('c'.repeat(64), '/index.html?path=/'));

    bootstrapIframe({
      iframe,
      extensionId: 'ext-2',
      contentHash: 'sha256:' + 'c'.repeat(64),
      session: { token: 'tok-123', expiresAt: '2099-01-01T00:00:00Z' },
      themeTokens: { '--alga-primary': '#123456' },
      requestId: 'req-42',
    });

    // Trigger load event to send bootstrap
    iframe.dispatchEvent(new Event('load'));

    const postSpy = (iframe as any).contentWindow.postMessage as ReturnType<typeof vi.fn>;
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postSpy.mock.calls[0];

    expect(targetOrigin).toBe('*');
    expect(message).toMatchObject({
      alga: true,
      version: '1',
      type: 'bootstrap',
      request_id: 'req-42',
      payload: {
        session: { token: 'tok-123', expires_at: '2099-01-01T00:00:00Z' },
        navigation: { path: '/' },
      },
    });

    // Also confirms theme injected into parent :root (style present/value applied)
    const primary = getComputedStyle(document.documentElement).getPropertyValue('--alga-primary').trim();
    expect(primary).toBe('#123456');
  });

  it('adjusts iframe height on resize messages with clamping', () => {
    const iframe = makeIframe();
    iframe.setAttribute('src', '/ext-ui/ext-3/sha256:'.concat('d'.repeat(64), '/index.html?path=/'));

    bootstrapIframe({
      iframe,
      extensionId: 'ext-3',
      contentHash: 'sha256:' + 'd'.repeat(64),
      session: { token: 'tok', expiresAt: '2099-01-01T00:00:00Z' },
      themeTokens: {},
    });

    // Simulate child resize -> parent listener
    const payloads = [
      { height: 50, expected: '100px' },     // below min clamp to 100
      { height: 777, expected: '777px' },    // within range
      { height: 99999, expected: '4000px' }, // above max clamp to 4000
    ];

    for (const p of payloads) {
      const evt = new MessageEvent('message', {
        data: { alga: true, version: '1', type: 'resize', payload: { height: p.height } },
        origin: window.location.origin,
        source: (iframe as any).contentWindow,
      } as any);
      window.dispatchEvent(evt);
      expect((iframe.style as any).height).toBe(p.expected);
    }
  });

  it('validates contentHash format', () => {
    const iframe = makeIframe();
    iframe.setAttribute('src', '/ext-ui/ext-bad/sha256:'.concat('e'.repeat(64), '/index.html?path=/'));

    expect(() =>
      bootstrapIframe({
        iframe,
        extensionId: 'ext-bad',
        contentHash: 'not-a-hash',
        session: { token: 'tok', expiresAt: '2099-01-01T00:00:00Z' },
        themeTokens: {},
      })
    ).toThrow(/Invalid contentHash/i);
  });
});
