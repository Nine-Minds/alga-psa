import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer';
import { JSDOM } from 'jsdom';
import { configureIsolatedPage } from '@alga-psa/documents/lib/renderHtmlToPng';
import { browserPoolService } from './browserPoolService';

const INTERNAL_SECRET = 'internal-loopback-response-4bfca1';
const documentRows = {
  document: {
    document_id: 'doc-1',
    document_name: 'Quarterly <script>alert(1)</script> & Report',
    mime_type: 'text/markdown',
    tenant: 'tenant-1',
  },
  content: '',
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => ({
    table: (name: string) => {
      const query = {
        where: () => query,
        select: () => query,
        first: async () => {
          if (name === 'documents') return documentRows.document;
          if (name === 'document_content') return { content: documentRows.content };
          if (name === 'document_block_content') return undefined;
          return undefined;
        },
      };
      return query;
    },
  }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));

import { PDFGenerationService } from './pdfGenerationService';

let server: http.Server;
let port = 0;
let requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<html><body>${INTERNAL_SECRET}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  requests = [];
});

afterAll(async () => {
  await browserPoolService.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function pdfHasHeader(pdf: Buffer): boolean {
  return pdf.subarray(0, 5).toString('ascii') === '%PDF-';
}

describe('PDFGenerationService stored document rendering isolation', () => {
  it('exports stored Markdown without fetching or disclosing malicious internal content', async () => {
    const target = `http://127.0.0.1:${port}`;
    documentRows.content = [
      '# Safe document heading',
      '',
      `<img src="${target}/image" alt="private image">`,
      `<iframe src="${target}/frame"></iframe>`,
      `<script>fetch("${target}/script")</script>`,
      `<img src="file:///etc/hostname" alt="local file">`,
      `<iframe src="file:///etc/hostname"></iframe>`,
      `<style>.private { background-image: url("${target}/css"); }</style>`,
      '<p onclick="document.body.dataset.clicked=true">Click me</p>',
      '<p class="private">Visible paragraph</p>',
    ].join('\n');

    const service = new PDFGenerationService('tenant-1');
    const html = await (service as any).getDocumentHtml('doc-1') as string;
    const title = new JSDOM(html).window.document.title;
    expect(title).toBe('Quarterly <script>alert(1)</script> & Report');

    const pdf = await (service as any).generatePDFBuffer(html) as Buffer;
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(pdfHasHeader(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(requests).toEqual([]);
    expect(pdf.toString('latin1')).not.toContain(INTERNAL_SECRET);
  }, 60000);

  it('still produces a printable PDF for ordinary stored Markdown', async () => {
    documentRows.content = '# Quarterly report\n\nOrdinary Markdown remains printable.\n\n- Revenue\n- Expenses';
    const service = new PDFGenerationService('tenant-1');
    const html = await (service as any).getDocumentHtml('doc-1') as string;
    const pdf = await (service as any).generatePDFBuffer(html) as Buffer;

    expect(pdfHasHeader(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 60000);

  it('disables scripts and blocks browser network and file requests during PDF rendering', async () => {
    const browser = await browserPoolService.getBrowser() as Browser;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const target = `http://127.0.0.1:${port}`;
    const attemptedRequests: string[] = [];

    try {
      page.on('request', (request) => attemptedRequests.push(request.url()));
      await configureIsolatedPage(page);
      await page.setContent(`
        <p>initial</p>
        <img src="${target}/image">
        <iframe src="${target}/frame"></iframe>
        <style>.private { background-image: url("${target}/css"); }</style>
        <script>document.body.dataset.execution='ran'; fetch('${target}/script')</script>
        <button onclick="document.body.dataset.clicked='ran'">click</button>
      `, { waitUntil: 'domcontentloaded' });
      await page.click('button');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const activeContentRan = await page.evaluate(() =>
        document.body.dataset.execution === 'ran' || document.body.dataset.clicked === 'ran'
      );
      expect(activeContentRan).toBe(false);
      await expect(page.goto('file:///etc/hostname')).rejects.toThrow();
      expect(attemptedRequests.some((url) => url.startsWith('file:'))).toBe(true);
    } finally {
      await page.close();
      await context.close();
      await browserPoolService.releaseBrowser(browser);
    }

    expect(requests).toEqual([]);
  }, 60000);

  it('keeps repeated exports isolated while rendering permitted inline image assets', async () => {
    const service = new PDFGenerationService('tenant-1');
    const browserBefore = await browserPoolService.getBrowser();
    await browserPoolService.releaseBrowser(browserBefore);

    documentRows.content = '# First export\n\n<script>document.cookie="leak=yes"</script>';
    const first = await (service as any).generatePDFBuffer(await (service as any).getDocumentHtml('doc-1')) as Buffer;

    documentRows.content = [
      '# Second export',
      '',
      '![inline image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)',
      `<img src="http://127.0.0.1:${port}/second-image">`,
      `<iframe src="http://127.0.0.1:${port}/second-frame"></iframe>`,
      `<style>.private { background-image: url("http://127.0.0.1:${port}/second-css"); }</style>`,
      '<p>Second export content</p>',
    ].join('\n');
    const second = await (service as any).generatePDFBuffer(await (service as any).getDocumentHtml('doc-1')) as Buffer;

    expect(pdfHasHeader(first)).toBe(true);
    expect(pdfHasHeader(second)).toBe(true);
    expect(second.toString('latin1')).not.toContain('leak=yes');
    expect(second.toString('latin1')).not.toContain(INTERNAL_SECRET);
    expect(requests).toEqual([]);
  }, 60000);
});
