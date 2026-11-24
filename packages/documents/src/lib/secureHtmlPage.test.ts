import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSecureHtmlContent } from './secureHtmlPage';

// Lets a test charge simulated wall-clock time to HTML preparation (parsing and
// rewriting the document) before any remote image is fetched.
const preparation = vi.hoisted(() => ({ beforeResolve: undefined as (() => void) | undefined }));

vi.mock('./renderHtmlToPng', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./renderHtmlToPng')>();
  return {
    ...actual,
    resolveRemoteAssets: async (...args: Parameters<typeof actual.resolveRemoteAssets>) => {
      preparation.beforeResolve?.();
      return actual.resolveRemoteAssets(...args);
    },
  };
});

afterEach(() => {
  preparation.beforeResolve = undefined;
  vi.restoreAllMocks();
});

function fakePage() {
  const handlers: Record<string, (request: any) => void> = {};
  const calls: string[] = [];
  const page = {
    setJavaScriptEnabled: vi.fn(async () => { calls.push('javascript-disabled'); }),
    setRequestInterception: vi.fn(async () => { calls.push('interception-enabled'); }),
    on: vi.fn((event: string, handler: (request: any) => void) => { handlers[event] = handler; }),
    setContent: vi.fn(async (html: string, options: unknown) => {
      calls.push('content-loaded');
      (page as any).html = html;
      (page as any).contentOptions = options;
    }),
    handlers,
    calls,
    html: '',
    contentOptions: undefined as unknown,
  };
  return page;
}

describe('shared secure Chromium HTML policy', () => {
  it('turns off scripts before loading, aborts network requests and keeps inline assets', async () => {
    const page = fakePage();
    await setSecureHtmlContent(page as any, '<img src="data:image/png;base64,AA=="><iframe src="http://127.0.0.1/"></iframe>');

    expect(page.calls).toEqual(['javascript-disabled', 'interception-enabled', 'content-loaded']);
    expect(page.contentOptions).toEqual({ waitUntil: 'domcontentloaded' });
    const abort = vi.fn();
    const proceed = vi.fn();
    page.handlers.request({ url: () => 'http://127.0.0.1/', resourceType: () => 'document', abort, continue: proceed });
    expect(abort).toHaveBeenCalledWith('blockedbyclient');
    expect(proceed).not.toHaveBeenCalled();
    page.handlers.request({ url: () => 'data:image/png;base64,AA==', resourceType: () => 'image', abort, continue: proceed });
    expect(proceed).toHaveBeenCalledOnce();
  });

  it.each([
    ['file:///etc/passwd', 'document'],
    ['data:text/html,<h1>payload</h1>', 'document'],
    ['data:text/javascript,alert(1)', 'script'],
    ['data:image/png;base64,AA==', 'document'],
    ['data:image/svg+xml,<svg/>', 'document'],
    ['data:application/octet-stream;base64,AA==', 'image'],
  ])('refuses %s in a %s request', async (url, type) => {
    const page = fakePage();
    await setSecureHtmlContent(page as any, '<p>Document</p>');
    const abort = vi.fn();
    const proceed = vi.fn();
    page.handlers.request({ url: () => url, resourceType: () => type, abort, continue: proceed });
    expect(abort).toHaveBeenCalledWith('blockedbyclient');
    expect(proceed).not.toHaveBeenCalled();
  });

  it('passes the remaining byte allowance and never fetches later images after exhaustion', async () => {
    const page = fakePage();
    const fetchAsset = vi.fn(async () => ({ bytes: Buffer.alloc(4), contentType: 'image/png' }));
    await setSecureHtmlContent(
      page as any,
      '<img src="https://public.example/a" alt="a"><img src="https://public.example/b" alt="b">',
      { fetchAsset, maxRemoteAssetBytes: 4 },
    );

    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledWith('https://public.example/a', { maxBytes: 4, timeoutMs: 5000 });
    expect(page.html).toContain('data:image/png;base64,');
    // The later image is rendered as a placeholder without starting another fetch.
    expect(page.html).toContain('aria-label="b"');
  });

  it('caps aggregate resolution time even when an injected fetch does not settle', async () => {
    const page = fakePage();
    const fetchAsset = vi.fn(() => new Promise<{ bytes: Buffer; contentType: string }>(() => undefined));
    const started = Date.now();

    await setSecureHtmlContent(page as any, '<img src="https://public.example/hangs" alt="slow">', {
      fetchAsset,
      maxRemoteAssetTimeMs: 20,
    });

    expect(Date.now() - started).toBeLessThan(500);
    expect(fetchAsset).toHaveBeenCalledWith('https://public.example/hangs', {
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: expect.any(Number),
    });
    expect(page.html).toContain('aria-label="slow"');
  });

  it('starts the time budget at the first remote fetch, not when HTML preparation begins', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // Preparing the document takes far longer than the whole remote-image budget.
    preparation.beforeResolve = () => { clock += 1_000; };
    const fetchAsset = vi.fn(async () => {
      // Each fetch consumes more than half of the 20ms budget.
      clock += 15;
      return { bytes: Buffer.alloc(4), contentType: 'image/png' };
    });
    const page = fakePage();

    await setSecureHtmlContent(
      page as any,
      '<img src="https://public.example/first" alt="first"><img src="https://public.example/second" alt="second">',
      { fetchAsset, maxRemoteAssetTimeMs: 20 },
    );

    // The first image gets the full budget despite the slow preparation...
    expect(fetchAsset).toHaveBeenNthCalledWith(1, 'https://public.example/first', {
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 20,
    });
    // ...and the budget still bounds aggregate fetch time across images.
    expect(fetchAsset).toHaveBeenNthCalledWith(2, 'https://public.example/second', {
      maxBytes: 5 * 1024 * 1024 - 4,
      timeoutMs: 5,
    });
    expect(page.html).toContain('data:image/png;base64,');
    expect(page.html).not.toContain('aria-label="first"');
  });
});
