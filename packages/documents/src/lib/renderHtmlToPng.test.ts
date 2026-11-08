import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderHtmlToPng, resolveRemoteAssets } from './renderHtmlToPng';

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

  it('4. plain text/markdown-style HTML still renders to a PNG', async () => {
    const png = await renderHtmlToPng('<pre>just some text</pre><h1>Heading</h1><table><tr><td>x</td></tr></table>', {
      width: 300,
      height: 200,
    });
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  }, 60000);
});
