import type { Page } from 'puppeteer';
import { resolveRemoteAssets, type RenderHtmlToPngOptions } from './renderHtmlToPng';

export interface SecureHtmlPageOptions {
  /** Maximum combined bytes embedded from remote image resources. */
  maxRemoteAssetBytes?: number;
  remoteAssets?: RenderHtmlToPngOptions['remoteAssets'];
  fetchAsset?: RenderHtmlToPngOptions['fetchAsset'];
}

/** Apply the authoritative Chromium policy before loading any caller-controlled HTML. */
export async function setSecureHtmlContent(
  page: Page,
  html: string,
  options: SecureHtmlPageOptions = {},
): Promise<void> {
  const safeHtml = await resolveRemoteAssets(html, {
    remoteAssets: options.remoteAssets,
    fetchAsset: budgetedFetcher(options),
  });

  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url === 'about:blank') {
      void request.continue();
    } else {
      void request.abort('blockedbyclient');
    }
  });
  await page.setContent(safeHtml, { waitUntil: 'domcontentloaded' });
}

function budgetedFetcher(options: SecureHtmlPageOptions): NonNullable<RenderHtmlToPngOptions['fetchAsset']> {
  const fetch = options.fetchAsset ?? (async (url) => {
    const { fetchPublicBytes } = await import('@alga-psa/core/net/safeFetch');
    return fetchPublicBytes(url);
  });
  const maxBytes = options.maxRemoteAssetBytes ?? 5 * 1024 * 1024;
  let totalBytes = 0;
  return async (url) => {
    const result = await fetch(url);
    totalBytes += result.bytes.length;
    if (totalBytes > maxBytes) throw new Error('Remote image resource budget exceeded');
    return result;
  };
}
