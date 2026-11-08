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

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(TINY_PNG);
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
