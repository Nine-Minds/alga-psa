import { describe, expect, it, vi } from 'vitest';
import { setSecureHtmlContent } from './secureHtmlPage';

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
    page.handlers.request({ url: () => 'http://127.0.0.1/', abort, continue: proceed });
    expect(abort).toHaveBeenCalledWith('blockedbyclient');
    expect(proceed).not.toHaveBeenCalled();
    page.handlers.request({ url: () => 'data:image/png;base64,AA==', abort, continue: proceed });
    expect(proceed).toHaveBeenCalledOnce();
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
    expect(page.html).toContain('aria-label="slow"');
  });
});
