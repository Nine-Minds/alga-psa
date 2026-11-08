import type { Page } from 'puppeteer';
import { resolveRemoteAssets, type RenderHtmlToPngOptions } from './renderHtmlToPng';

export interface SecureHtmlPageOptions {
  /** Maximum combined bytes embedded from remote image resources. */
  maxRemoteAssetBytes?: number;
  /** Maximum distinct remote image URLs fetched for a single render. */
  maxRemoteAssetRequests?: number;
  /** Maximum wall-clock time spent resolving remote images for a single render. */
  maxRemoteAssetTimeMs?: number;
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
    // Data documents, scripts, fonts and other payloads have no role in a render.
    // Keep SVG in the image context only: Chromium disables its active content there.
    const inlineImage = request.resourceType() === 'image' &&
      /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;[^,]*)?,/i.test(url);
    if (inlineImage || url === 'about:blank') {
      void request.continue();
    } else {
      void request.abort('blockedbyclient');
    }
  });
  await page.setContent(safeHtml, { waitUntil: 'domcontentloaded' });
}

function budgetedFetcher(options: SecureHtmlPageOptions): NonNullable<RenderHtmlToPngOptions['fetchAsset']> {
  const fetch = options.fetchAsset ?? (async (url, fetchOptions) => {
    const { fetchPublicBytes } = await import('@alga-psa/core/net/safeFetch');
    return fetchPublicBytes(url, fetchOptions);
  });
  const maxBytes = options.maxRemoteAssetBytes ?? 5 * 1024 * 1024;
  const maxRequests = options.maxRemoteAssetRequests ?? 20;
  const maxTimeMs = options.maxRemoteAssetTimeMs ?? 10_000;
  const startedAt = Date.now();
  let totalBytes = 0;
  let requests = 0;

  return async (url) => {
    const remainingBytes = maxBytes - totalBytes;
    const remainingTimeMs = maxTimeMs - (Date.now() - startedAt);
    if (remainingBytes <= 0) throw new Error('Remote image resource budget exceeded');
    if (requests >= maxRequests) throw new Error('Remote image request budget exceeded');
    if (remainingTimeMs <= 0) throw new Error('Remote image time budget exceeded');

    requests += 1;
    const timeoutMs = Math.min(5000, remainingTimeMs);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        fetch(url, { maxBytes: remainingBytes, timeoutMs }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Remote image time budget exceeded')), timeoutMs);
        }),
      ]);
      totalBytes += result.bytes.length;
      if (totalBytes > maxBytes) throw new Error('Remote image resource budget exceeded');
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}
