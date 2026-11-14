import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type { HTTPRequest, Page } from 'puppeteer';
import { configureIsolatedPage, prepareHtmlForIsolatedRendering } from './isolatedRendering';

describe('shared isolated rendering policy', () => {
  it('inlines validated images while removing active content and preserving document text', async () => {
    const bytes = Buffer.from('image-bytes');
    const fetchAsset = vi.fn().mockResolvedValue({ bytes, contentType: 'image/png' });
    const html = await prepareHtmlForIsolatedRendering(`
      <p>Invoice total: 42</p>
      <img src="https://assets.example/logo.png" onerror="alert(1)">
      <iframe src="http://127.0.0.1/private"></iframe>
      <script>fetch('http://127.0.0.1/private')</script>
      <style>@import 'https://assets.example/style.css'; .title { color: red }</style>
    `, { fetchAsset });
    const { document } = new JSDOM(html).window;

    expect(fetchAsset).toHaveBeenCalledExactlyOnceWith('https://assets.example/logo.png');
    expect(document.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    expect(document.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(document.querySelector('script, iframe')).toBeNull();
    expect(document.querySelector('p')?.textContent).toBe('Invoice total: 42');
    expect(document.querySelector('style')?.textContent).toContain('color: red');
    expect(document.querySelector('style')?.textContent).not.toContain('@import');
  });

  it('blocks remote images without calling the asset fetcher', async () => {
    const fetchAsset = vi.fn();
    const html = await prepareHtmlForIsolatedRendering(
      '<img src="https://assets.example/logo.png" alt="Company logo">',
      { remoteAssets: 'block', fetchAsset }
    );
    const { document } = new JSDOM(html).window;

    expect(fetchAsset).not.toHaveBeenCalled();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Company logo');
  });

  it.each(['http://127.0.0.1/private', 'https://assets.example/logo.png', 'file:///etc/passwd'])
    ('aborts browser requests to %s before page content is loaded', async (url) => {
      let onRequest: (request: HTTPRequest) => void = () => { throw new Error('Request policy was not installed'); };
      const page = {
        setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((_event, listener) => { onRequest = listener; }),
      };
      await configureIsolatedPage(page as unknown as Page);
      const request = { url: () => url, abort: vi.fn(), continue: vi.fn() };
      onRequest(request as unknown as HTTPRequest);

      expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
      expect(page.setRequestInterception).toHaveBeenCalledWith(true);
      expect(request.abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(request.continue).not.toHaveBeenCalled();
    });

  it('allows an embedded image through browser request interception', async () => {
    let onRequest: (request: HTTPRequest) => void = () => { throw new Error('Request policy was not installed'); };
    const page = {
      setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event, listener) => { onRequest = listener; }),
    };
    await configureIsolatedPage(page as unknown as Page);
    const request = { url: () => 'data:image/png;base64,aW1hZ2U=', abort: vi.fn(), continue: vi.fn() };
    onRequest(request as unknown as HTTPRequest);

    expect(request.continue).toHaveBeenCalledOnce();
    expect(request.abort).not.toHaveBeenCalled();
  });
});
