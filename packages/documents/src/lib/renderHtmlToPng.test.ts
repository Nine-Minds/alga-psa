import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderHtmlToPng, resolveRemoteAssets } from './renderHtmlToPng';
import { createAssetBudget } from './remoteAssetBudget';

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

let server: http.Server;
let port = 0;
let connections = 0;
let requests: string[] = [];
let completedRequests: string[] = [];
let responseBytes: Buffer | null = null;
let responseDelayMs = 0;
let smallResponseDelayMs = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    const send = () => {
      completedRequests.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(req.url?.startsWith('/large-repeated.png') ? responseBytes ?? TINY_PNG : TINY_PNG);
    };
    const delay = req.url?.startsWith('/large-repeated.png') ? responseDelayMs : smallResponseDelayMs;
    if (delay) setTimeout(send, delay);
    else send();
  });
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function loopbackHtml(): string {
  const base = `http://127.0.0.1:${port}`;
  return `
    <style>@import url("${base}/import.css"); .bg { background: url(${base}/y) }</style>
    <link rel="stylesheet" href="${base}/link.css">
    <p class="bg">hello</p>
    <img src="${base}/x.png" alt="internal">
    <img srcset="${base}/s.png 1x" alt="srcset">
    <iframe src="${base}/frame"></iframe>
    <video poster="${base}/poster.png"></video>
    <object data="${base}/obj"></object>
    <script>fetch("${base}/script")</script>
  `;
}

describe('renderHtmlToPng network policy', () => {
  it('1. never opens a connection to a loopback listener and still returns a PNG', async () => {
    connections = 0;
    requests = [];
    const png = await renderHtmlToPng(loopbackHtml());
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    // Let any straggling request land before asserting.
    await new Promise((r) => setTimeout(r, 300));
    expect(requests).toEqual([]);
    expect(connections).toBe(0);
  }, 60000);

  it('1b. block mode: iframe/object/link/import/script/poster to loopback open no socket', async () => {
    connections = 0;
    requests = [];
    const png = await renderHtmlToPng(loopbackHtml(), { remoteAssets: 'block' });
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(connections).toBe(0);
  }, 60000);

  it('2. remoteAssets "block" renders with a placeholder and no network', async () => {
    connections = 0;
    const html = `<img src="http://127.0.0.1:${port}/x.png" alt="pic">`;
    const rewritten = await resolveRemoteAssets(html, { remoteAssets: 'block' });
    expect(rewritten).not.toContain('127.0.0.1');
    expect(rewritten).toContain('pic');
    const png = await renderHtmlToPng(html, { remoteAssets: 'block' });
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(connections).toBe(0);
  }, 60000);

  it('3. inline mode embeds fetched images as data URIs and placeholders refused ones', async () => {
    const fetched: string[] = [];
    const fetchAsset = async (url: string) => {
      fetched.push(url);
      if (url.includes('bad')) throw new Error('refused');
      if (url.includes('html')) return { bytes: Buffer.from('<html>'), contentType: 'text/html' };
      return { bytes: TINY_PNG, contentType: 'image/png' };
    };
    const html =
      `<img src="https://cdn.example.com/a.png?x=1&amp;y=2" alt="ok">` +
      `<img src="https://cdn.example.com/bad.png" alt="Blocked one">` +
      `<img src="https://cdn.example.com/html">` +
      `<img src="data:image/png;base64,AAAA">` +
      `<div style="background:url('https://cdn.example.com/bg.png')"></div>` +
      `<div style="background:url(https://cdn.example.com/bad-bg.png)"></div>`;
    const out = await resolveRemoteAssets(html, { fetchAsset });

    expect(out).toContain(`src="data:image/png;base64,${TINY_PNG.toString('base64')}"`);
    expect(fetched).toContain('https://cdn.example.com/a.png?x=1&y=2');
    expect(out).not.toContain('cdn.example.com');
    expect(out).toContain('Blocked one'); // alt text preserved in placeholder
    expect(out).toContain('src="data:image/png;base64,AAAA"'); // untouched
    expect(out.match(/url\("data:image\/png;base64,/g)).toHaveLength(2);
  });

  it('3b. default inline path goes through safeFetch and refuses loopback', async () => {
    connections = 0;
    const out = await resolveRemoteAssets(`<img src="http://127.0.0.1:${port}/x.png" alt="loop">`);
    expect(out).not.toContain('<img');
    expect(out).toContain('loop');
    expect(connections).toBe(0);
  });

  it('bounds distinct assets and concurrent fetches, preserving excluded positions', async () => {
    const urls = Array.from({ length: 200 }, (_, i) => `https://assets.example/${i}.png`);
    let active = 0;
    let highWater = 0;
    const fetched: string[] = [];
    const out = await resolveRemoteAssets(urls.map((url, i) => `<img src="${url}" alt="asset-${i}">`).join(''), {
      limits: { maxAssets: 12, concurrency: 3 },
      fetchAsset: async (url) => {
        fetched.push(url);
        active += 1;
        highWater = Math.max(highWater, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { bytes: TINY_PNG, contentType: 'image/png' };
      },
    });
    expect(fetched).toHaveLength(12);
    expect(highWater).toBe(3);
    expect(out.match(/data:image\/png;base64,/g)).toHaveLength(12);
    expect(out.match(/role="img"/g)).toHaveLength(188);
    expect(out.indexOf('asset-0')).toBeLessThan(out.indexOf('asset-199'));
  });

  it('reaches but never exceeds the configured concurrency under a fetch barrier', async () => {
    let active = 0;
    let highWater = 0;
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const fetchAsset = async () => {
      active += 1;
      highWater = Math.max(highWater, active);
      arrivals += 1;
      if (arrivals === 3) release();
      await barrier;
      active -= 1;
      return { bytes: TINY_PNG, contentType: 'image/png' };
    };
    const out = await resolveRemoteAssets(
      Array.from({ length: 9 }, (_, i) => `<img src="https://assets.example/barrier-${i}">`).join(''),
      { limits: { maxAssets: 9, concurrency: 3 }, fetchAsset }
    );
    expect(highWater).toBe(3);
    expect(out.match(/data:image\/png;base64,/g)).toHaveLength(9);
  });

  it('selects byte-budget winners by position despite varied fetch completion timing', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://assets.example/bytes-${i}`);
    const html = urls.map((url, i) => `<img src="${url}" alt="byte-${i}">`).join('');
    const render = () => resolveRemoteAssets(html, {
      limits: { maxAssets: 6, concurrency: 4, maxTotalBytes: 8 },
      fetchAsset: async (url) => {
        const i = Number(url.split('-').pop());
        await new Promise((resolve) => setTimeout(resolve, (5 - i) % 4));
        return { bytes: Buffer.alloc(4, i), contentType: 'image/png' };
      },
    });
    const first = await render();
    const second = await render();
    expect(first).toBe(second);
    expect(first.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(first).toContain(`data:image/png;base64,${Buffer.alloc(4, 0).toString('base64')}`);
    expect(first).toContain(`data:image/png;base64,${Buffer.alloc(4, 1).toString('base64')}`);
    expect(first).not.toContain(`data:image/png;base64,${Buffer.alloc(4, 2).toString('base64')}`);
    expect(first).toContain('byte-2');
    expect(first).toContain('byte-5');
    const budget = createAssetBudget({ maxTotalBytes: 8 });
    expect(budget.charge(4)).toBe(true);
    expect(budget.charge(4)).toBe(true);
    expect(budget.charge(1)).toBe(false);
    expect(budget.spentBytes).toBeLessThanOrEqual(8);
  });

  it('charges CSS and img results in original source order across varied completion orders', async () => {
    const html = '<p style="background:url(https://assets.example/earlier-css)">early</p>' +
      '<img src="https://assets.example/later-img" alt="later">';
    const render = (cssDelay: number, imgDelay: number) => resolveRemoteAssets(html, {
      limits: { maxAssets: 2, concurrency: 2, maxTotalBytes: 4 },
      fetchAsset: async (url) => {
        await new Promise((resolve) => setTimeout(resolve, url.includes('earlier-css') ? cssDelay : imgDelay));
        return { bytes: Buffer.alloc(4, url.includes('earlier-css') ? 1 : 2), contentType: 'image/png' };
      },
    });
    const cssCompletesLast = await render(15, 0);
    const imgCompletesLast = await render(0, 15);
    expect(cssCompletesLast).toBe(imgCompletesLast);
    expect(cssCompletesLast).toContain(`url("data:image/png;base64,${Buffer.alloc(4, 1).toString('base64')}")`);
    expect(cssCompletesLast).not.toContain(`data:image/png;base64,${Buffer.alloc(4, 2).toString('base64')}`);
    expect(cssCompletesLast).toContain('later');
  });

  it('fetches and charges a repeated URL once and applies per-call limits', async () => {
    let calls = 0;
    const repeated = `<img src="https://assets.example/repeated" alt="repeat-${Array.from({ length: 50 }, (_, i) => i).join(',')}">`.repeat(50);
    const repeatedOut = await resolveRemoteAssets(repeated, {
      limits: { maxAssets: 1, maxTotalBytes: 8 },
      fetchAsset: async () => { calls += 1; return { bytes: Buffer.alloc(8), contentType: 'image/png' }; },
    });
    expect(calls).toBe(1);
    expect(repeatedOut.match(/data:image\/png;base64,/g)).toHaveLength(50);

    const overrideCalls: string[] = [];
    const out = await resolveRemoteAssets(
      '<img src="https://assets.example/one" alt="one"><img src="https://assets.example/two" alt="two">',
      { limits: { maxAssets: 1 }, fetchAsset: async (url) => {
        overrideCalls.push(url);
        return { bytes: TINY_PNG, contentType: 'image/png' };
      } }
    );
    expect(overrideCalls).toHaveLength(1);
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  it('bounds expanded output for repeated large img and CSS references deterministically', async () => {
    const imageBytes = Buffer.alloc(1024 * 1024, 7);
    const dataUri = `data:image/png;base64,${imageBytes.toString('base64')}`;
    const perReferenceOutput = Buffer.byteLength(dataUri);
    const outputCap = 16 * 1024 * 1024;
    const url = `http://127.0.0.1:${port}/large-repeated.png`;
    const smallUrl = `http://127.0.0.1:${port}/small.png`;
    const repeatedReferences = Array.from({ length: 30 }, (_, index) => index % 2 === 0
      ? `<img src="${url}" alt="img-${index}">`
      : `<div style="background-image:url(${url})">css-${index}</div>`);
    const html = [...repeatedReferences, `<img src="${smallUrl}" alt="small">`].join('');

    const render = async (largeDelayMs: number, smallDelayMs = 0, maxExpandedOutputBytes?: number) => {
      requests = [];
      completedRequests = [];
      responseBytes = imageBytes;
      responseDelayMs = largeDelayMs;
      smallResponseDelayMs = smallDelayMs;
      const output = await resolveRemoteAssets(html, {
        limits: {
          maxAssets: 2,
          maxTotalBytes: imageBytes.length + TINY_PNG.length,
          ...(maxExpandedOutputBytes === undefined ? {} : { maxExpandedOutputBytes }),
        },
        fetchAsset: async (assetUrl) => {
          const response = await fetch(assetUrl);
          return {
            bytes: Buffer.from(await response.arrayBuffer()),
            contentType: response.headers.get('content-type') ?? '',
          };
        },
      });
      return { output, fetched: [...requests], completionOrder: [...completedRequests] };
    };

    const first = await render(20, 0);
    const second = await render(0, 20);
    expect(first.fetched.sort()).toEqual(['/large-repeated.png', '/small.png']);
    expect(second.fetched.sort()).toEqual(['/large-repeated.png', '/small.png']);
    expect(first.completionOrder).toEqual(['/small.png', '/large-repeated.png']);
    expect(second.completionOrder).toEqual(['/large-repeated.png', '/small.png']);
    expect(first.output).toBe(second.output);
    expect(first.output.split(dataUri).length - 1).toBe(11);
    expect(first.output).toContain(`<img src="data:image/png;base64,${TINY_PNG.toString('base64')}" alt="small">`);
    expect(Buffer.byteLength(dataUri)).toBe(perReferenceOutput);
    expect(perReferenceOutput * 11).toBeLessThanOrEqual(outputCap);
    expect(perReferenceOutput * 12).toBeGreaterThan(outputCap);
    expect(first.output.split(`url("${dataUri}")`).length - 1).toBe(5);
    expect(first.output.match(/role="img"/g)).toHaveLength(9);
    expect(first.output.match(/url\("data:image\/png;base64,/g)).toHaveLength(15); // all CSS references retain their positions
    expect(first.output).toContain('css-1');
    expect(first.output).toContain('css-29');
    expect(first.output).toContain('img-2');
    expect(first.output).toContain('img-28');
    const referenceLabels = repeatedReferences.map((_reference, index) => index % 2 === 0 ? `img-${index}` : `css-${index}`);
    const referencePositions = [...referenceLabels, 'small']
      .map((label) => first.output.indexOf(label));
    expect(referencePositions.every((position, index) =>
      index === 0 || referencePositions[index - 1] < position
    )).toBe(true);
    expect(Buffer.byteLength(first.output)).toBeLessThan(Buffer.byteLength(html) + outputCap + 3000);

    const override = await render(0, 0, perReferenceOutput * 13);
    expect(override.output.split(dataUri).length - 1).toBe(13);
    expect(override.output).toContain(`url("${dataUri}")`);
    expect(override.output).toContain('small');
    expect(override.output.match(/role="img"/g)).toHaveLength(9);
    expect(override.output.match(/url\("data:image\/png;base64,/g)).toHaveLength(15);
    responseBytes = null;
    responseDelayMs = 0;
    smallResponseDelayMs = 0;
  });

  it('composes CSS rewrites nested in retained images and suppresses them for placeholders', async () => {
    const imageUrl = 'https://assets.example/a.png';
    const cssUrl = 'https://assets.example/b.png';
    const imageBytes = Buffer.from([1, 2, 3]);
    const cssBytes = Buffer.from([4, 5, 6, 7]);
    const imageUri = `data:image/png;base64,${imageBytes.toString('base64')}`;
    const cssUri = `data:image/png;base64,${cssBytes.toString('base64')}`;
    const html = `<img src="${imageUrl}" style="background:url(${cssUrl})" alt="photo">`;
    const fetched: string[] = [];
    const fetchAsset = async (url: string) => {
      fetched.push(url);
      return { bytes: url === imageUrl ? imageBytes : cssBytes, contentType: 'image/png' };
    };

    const inlined = await resolveRemoteAssets(html, { fetchAsset });
    expect(inlined).toBe(`<img src="${imageUri}" style="background:url(&quot;${cssUri}&quot;)" alt="photo">`);
    expect(fetched).toEqual([imageUrl, cssUrl]);

    fetched.length = 0;
    const blocked = await resolveRemoteAssets(html, { remoteAssets: 'block', fetchAsset });
    expect(blocked).toBe(
      '<span style="display:inline-block;min-width:60px;min-height:30px;padding:4px;background:#e5e7eb;color:#6b7280;font-size:12px;border:1px solid #d1d5db;box-sizing:border-box;" role="img" aria-label="photo">photo</span>'
    );
    expect(blocked).not.toContain('url(');
    expect(blocked).not.toContain('assets.example');
    expect(fetched).toEqual([]);
  });

  it('shares output capacity with nested CSS and rolls back suppressed nested reservations', async () => {
    const imageUrl = 'https://assets.example/budget-image.png';
    const cssUrl = 'https://assets.example/budget-css.png';
    const sourceBytes = Buffer.alloc(12, 1);
    const nestedBytes = Buffer.alloc(12, 2);
    const sourceUri = `data:image/png;base64,${sourceBytes.toString('base64')}`;
    const cssUri = `data:image/png;base64,${nestedBytes.toString('base64')}`;
    const fetchAsset = async (url: string) => ({
      bytes: url === imageUrl ? sourceBytes : nestedBytes,
      contentType: 'image/png',
    });

    const retained = await resolveRemoteAssets(
      `<img src="${imageUrl}" style="background:url(${cssUrl})" alt="retained">`,
      { fetchAsset, limits: { maxExpandedOutputBytes: Buffer.byteLength(sourceUri) } }
    );
    expect(retained).toBe(
      `<img src="${sourceUri}" style="background:url(&quot;${'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='}&quot;)" alt="retained">`
    );

    const beforeSourceCss = 'https://assets.example/css-before-src.png';
    const tooLargeImage = 'https://assets.example/too-large-image.png';
    const afterUrl = 'https://assets.example/after.png';
    const beforeBytes = TINY_PNG;
    const beforeUri = `data:image/png;base64,${beforeBytes.toString('base64')}`;
    const afterImageUri = beforeUri;
    const suppressed = await resolveRemoteAssets(
      `<img style="background:url(${beforeSourceCss})" src="${tooLargeImage}" alt="suppressed">` +
        `<img src="${afterUrl}" alt="after">`,
      {
        limits: { maxExpandedOutputBytes: Buffer.byteLength(beforeUri), maxTotalBytes: 1024 },
        fetchAsset: async (url) => ({
          bytes: url === tooLargeImage ? Buffer.alloc(200, 3) : beforeBytes,
          contentType: 'image/png',
        }),
      }
    );
    expect(suppressed).toContain('aria-label="suppressed">suppressed</span><img');
    expect(suppressed).toContain(`<img src="${afterImageUri}" alt="after">`);
    expect(suppressed).not.toContain(beforeSourceCss);
    expect(suppressed).not.toContain(tooLargeImage);
  });

  it('forwards the default and overridden per-asset timeout and rejects malformed values', async () => {
    const timeoutValues: Array<number | undefined> = [];
    const fetchAsset = async (_url: string, options?: { timeoutMs: number }) => {
      timeoutValues.push(options?.timeoutMs);
      return { bytes: TINY_PNG, contentType: 'image/png' };
    };
    await resolveRemoteAssets('<img src="https://assets.example/default">', { fetchAsset });
    await resolveRemoteAssets('<img src="https://assets.example/custom">', {
      fetchAsset,
      limits: { perAssetTimeoutMs: 1200 },
    });
    expect(timeoutValues).toEqual([5000, 1200]);
    await expect(resolveRemoteAssets('<img src="https://assets.example/invalid">', {
      fetchAsset,
      limits: { perAssetTimeoutMs: 0 },
    })).rejects.toThrow(/perAssetTimeoutMs/);
  });

  it('keeps inline, blocked, and CSS assets at their original positions', async () => {
    const out = await resolveRemoteAssets(
      '<p>before</p><img src="https://assets.example/inline" alt="middle"><img src="https://assets.example/blocked" alt="after"><p style="background:url(https://assets.example/bg)">last</p>',
      { limits: { maxAssets: 1 }, fetchAsset: async () => ({ bytes: TINY_PNG, contentType: 'image/png' }) }
    );
    expect(out.indexOf('before')).toBeLessThan(out.indexOf('data:image/png'));
    expect(out.indexOf('data:image/png')).toBeLessThan(out.indexOf('after'));
    expect(out.indexOf('after')).toBeLessThan(out.indexOf('last'));
    expect(out).toContain(`url("data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='}`);
  });

  it('admits mixed CSS and img references by their original HTML positions', async () => {
    const fetched: string[] = [];
    const out = await resolveRemoteAssets(
      '<p style="background:url(https://assets.example/first)">first</p><img src="https://assets.example/second" alt="second">',
      {
        limits: { maxAssets: 1 },
        fetchAsset: async (url) => {
          fetched.push(url);
          return { bytes: TINY_PNG, contentType: 'image/png' };
        },
      }
    );
    expect(fetched).toEqual(['https://assets.example/first']);
    expect(out.indexOf('data:image/png')).toBeLessThan(out.indexOf('second'));
    expect(out).toContain('url("data:image/png;base64,');
  });

  it('4. plain text/markdown-style HTML still renders to a PNG', async () => {
    const png = await renderHtmlToPng('<pre>just some text</pre><h1>Heading</h1><table><tr><td>x</td></tr></table>', {
      width: 300,
      height: 200,
    });
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  }, 60000);
});
