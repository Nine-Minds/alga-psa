import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { buildHmrCaptureSource } from '../capture-next-hmr-reloads.mjs';

const CHROME_PATH = process.env.CHROME_BIN ?? '/usr/bin/google-chrome';

test('the preload observer captures HMR reload messages after document navigation', {
  skip: !existsSync(CHROME_PATH) && 'A local Chrome binary is required for the browser fixture',
  timeout: 30_000,
}, async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const pageName = new URL(request.url, 'http://localhost').pathname.slice(1);
    const wsUrl = `ws://${request.headers.host}/hmr?document=${encodeURIComponent(pageName)}`;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><body data-page="${pageName}"><script>
      const hmr = new WebSocket(${JSON.stringify(wsUrl)});
      hmr.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'reloadPage') document.body.dataset.received = message.data;
      });
    </script></body>`);
  });
  const webSockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (client) => {
      webSockets.emit('connection', client, request);
    });
  });
  webSockets.on('connection', (client, request) => {
    const documentName = new URL(request.url, 'http://localhost').searchParams.get('document');
    client.send(JSON.stringify({ type: 'reloadPage', data: `fixture reload ${documentName}` }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise((resolve) => webSockets.close(resolve));
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });

  const context = await browser.newContext();
  const records = [];
  await context.exposeBinding('__codexCaptureNextHmrReload', (_source, record) => {
    records.push(JSON.parse(record));
  });
  await context.addInitScript({ content: buildHmrCaptureSource() });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/first`);
  await page.waitForFunction(() => document.body.dataset.received === 'fixture reload first');
  await page.waitForFunction(() => window.__codexNextHmrCaptureInstalled === true);
  await page.goto(`http://127.0.0.1:${address.port}/second`);
  await page.waitForFunction(() => document.body.dataset.received === 'fixture reload second');
  await page.waitForFunction(() => window.__codexNextHmrCaptureInstalled === true);

  assert.equal(records.length, 2);
  assert.equal(records[0].payload, 'fixture reload first');
  assert.equal(records[0].pageUrl, `http://127.0.0.1:${address.port}/first`);
  assert.match(records[0].connectionUrl, /\/hmr\?document=first/);
  assert.equal(records[1].payload, 'fixture reload second');
  assert.equal(records[1].pageUrl, `http://127.0.0.1:${address.port}/second`);
  assert.match(records[1].connectionUrl, /\/hmr\?document=second/);
  assert.ok(records.every((record) => Number.isFinite(record.performanceTimeOrigin)));
});
