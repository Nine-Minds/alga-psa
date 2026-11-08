import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer';
import { JSDOM } from 'jsdom';
import { configureIsolatedPage, prepareHtmlForIsolatedRendering } from '@alga-psa/core/rendering/isolatedRendering';
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

function withPdfFile<T>(pdf: Buffer, inspect: (pdfPath: string, directory: string) => T): T {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'document-pdf-ssrf-'));
  const pdfPath = path.join(directory, 'export.pdf');
  writeFileSync(pdfPath, pdf);
  try {
    return inspect(pdfPath, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function extractPdfText(pdf: Buffer): string {
  return withPdfFile(pdf, (pdfPath) => execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }));
}

function countRedPixelsInPdf(pdf: Buffer): number {
  return withPdfFile(pdf, (pdfPath, directory) => {
    const prefix = path.join(directory, 'page');
    execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-r', '96', pdfPath, prefix]);
    const ppm = readFileSync(`${prefix}.ppm`);
    let offset = 0;
    const nextToken = (): string => {
      while (offset < ppm.length) {
        if (ppm[offset] === 35) {
          while (offset < ppm.length && ppm[offset] !== 10) offset++;
        } else if (ppm[offset] <= 32) {
          offset++;
        } else {
          break;
        }
      }
      const start = offset;
      while (offset < ppm.length && ppm[offset] > 32) offset++;
      return ppm.subarray(start, offset).toString('ascii');
    };
    expect(nextToken()).toBe('P6');
    const width = Number(nextToken());
    const height = Number(nextToken());
    expect(nextToken()).toBe('255');
    if (ppm[offset] === 13 && ppm[offset + 1] === 10) offset += 2;
    else offset++;

    let redPixels = 0;
    for (let pixel = 0; pixel < width * height; pixel++) {
      const red = ppm[offset + pixel * 3];
      const green = ppm[offset + pixel * 3 + 1];
      const blue = ppm[offset + pixel * 3 + 2];
      if (red > 200 && green < 80 && blue < 80) redPixels++;
    }
    return redPixels;
  });
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
      `<style>@import "${target}/import.css"; .private { background-image: url("file:///etc/hostname"); }</style>`,
      '<p onclick="document.body.dataset.clicked=true">Click me</p>',
      '<p class="private">Visible paragraph</p>',
    ].join('\n');

    const service = new PDFGenerationService('tenant-1');
    const html = await (service as any).getDocumentHtml('doc-1') as string;
    const title = new JSDOM(html).window.document.title;
    expect(title).toBe('Quarterly <script>alert(1)</script> & Report');

    const prepared = await prepareHtmlForIsolatedRendering(html);
    expect(prepared).not.toContain('@import');
    expect(prepared).not.toContain('file:///etc/hostname');
    expect(prepared).not.toContain(`${target}/import.css`);

    const pdf = await (service as any).generatePDFBuffer(html) as Buffer;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pdfText = extractPdfText(pdf);

    expect(pdfHasHeader(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(requests).toEqual([]);
    expect(pdfText).toContain('Safe document heading');
    expect(pdfText).toContain('Visible paragraph');
    expect(pdfText).not.toContain(INTERNAL_SECRET);
  }, 60000);

  it('still produces a printable PDF for ordinary stored Markdown', async () => {
    documentRows.content = '# Quarterly report\n\nOrdinary Markdown remains printable.\n\n- Revenue\n- Expenses';
    const service = new PDFGenerationService('tenant-1');
    const html = await (service as any).getDocumentHtml('doc-1') as string;
    const pdf = await (service as any).generatePDFBuffer(html) as Buffer;

    expect(pdfHasHeader(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 60000);

  it('inlines validated image assets and removes unsupported image and CSS resource schemes', async () => {
    const fetched: string[] = [];
    const prepared = await prepareHtmlForIsolatedRendering(`
      <img src="https://assets.example.test/allowed.png" alt="validated image">
      <img src="file:///etc/hostname" alt="blocked file">
      <style>
        @import "http://127.0.0.1:${port}/a.css";
        @import url("https://assets.example.test/import.css");
        @im\\70ort "http://127.0.0.1:${port}/escaped-quoted.css";
        @im\\70ort url("http://127.0.0.1:${port}/escaped-url.css");
        .file { background-image: url(file:///etc/hostname); }
        .set { background-image: image-set("http://127.0.0.1:${port}/remote.png" 1x); }
        .valid { background-image: url("https://assets.example.test/allowed.png"); }
      </style>
    `, {
      fetchAsset: async (url) => {
        fetched.push(url);
        return { bytes: Buffer.from('approved-image-bytes'), contentType: 'image/png' };
      },
    });

    expect(fetched).toEqual(['https://assets.example.test/allowed.png']);
    expect(prepared).toContain('data:image/png;base64,YXBwcm92ZWQtaW1hZ2UtYnl0ZXM=');
    expect(prepared).not.toContain('@import');
    expect(prepared).not.toContain('file:///etc/hostname');
    expect(prepared).not.toContain('127.0.0.1');
    expect(prepared).not.toContain('assets.example.test/import.css');
  });

  it('preserves inline style declarations and removes escaped CSS imports before Chromium loads the page', async () => {
    const target = `http://127.0.0.1:${port}`;
    const fetched: string[] = [];
    const prepared = await prepareHtmlForIsolatedRendering(`
      <div id="styled-box" style="color: rgb(255, 0, 0); width: 100px; height: 100px; background-color: rgb(0, 0, 255);"></div>
      <style>
        @im\\70ort "${target}/escaped-quoted.css";
        @im\\70ort url("${target}/escaped-url.css");
      </style>
    `, {
      fetchAsset: async (url) => {
        fetched.push(url);
        throw new Error(`Unexpected asset fetch: ${url}`);
      },
    });

    expect(fetched).toEqual([]);
    expect(prepared).not.toContain('escaped-quoted.css');
    expect(prepared).not.toContain('escaped-url.css');

    const browser = await browserPoolService.getBrowser() as Browser;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const attemptedRequests: string[] = [];
    try {
      page.on('request', (request) => attemptedRequests.push(request.url()));
      await configureIsolatedPage(page);
      await page.setContent(prepared, { waitUntil: 'load' });
      const computed = await page.evaluate(() => {
        const box = document.querySelector('#styled-box')!;
        const style = getComputedStyle(box);
        return {
          width: style.width,
          height: style.height,
          color: style.color,
          backgroundColor: style.backgroundColor,
        };
      });

      expect(computed).toEqual({
        width: '100px',
        height: '100px',
        color: 'rgb(255, 0, 0)',
        backgroundColor: 'rgb(0, 0, 255)',
      });
    } finally {
      await page.close();
      await context.close();
      await browserPoolService.releaseBrowser(browser);
    }

    expect(attemptedRequests).toEqual([]);
    expect(requests).toEqual([]);
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
    const browser = await browserPoolService.getBrowser() as Browser;
    await browserPoolService.releaseBrowser(browser);
    const createContext = browser.createBrowserContext.bind(browser);
    const target = `http://127.0.0.1:${port}`;
    let contextCount = 0;
    let firstContextCookie: string[] = [];
    let secondContextCookies: string[] = [];
    const createContextSpy = vi.spyOn(browser, 'createBrowserContext').mockImplementation(async (...args) => {
      const context = await createContext(...args);
      contextCount++;
      if (contextCount === 1) {
        await context.setCookie({ name: 'first-export-state', value: 'isolated-value', domain: '127.0.0.1', path: '/' });
        firstContextCookie = (await context.cookies()).map((cookie) => cookie.name);
      } else if (contextCount === 2) {
        secondContextCookies = (await context.cookies()).map((cookie) => cookie.name);
      }
      return context;
    });

    let first: Buffer;
    let second: Buffer;
    try {
      documentRows.content = '# First export\n\nThe first PDF establishes isolated browser state.';
      first = await (service as any).generatePDFBuffer(await (service as any).getDocumentHtml('doc-1')) as Buffer;

      const redSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#e00000"/></svg>').toString('base64');
      documentRows.content = [
        '# Second export',
        '',
        `![permitted red image](data:image/svg+xml;base64,${redSvg})`,
        `<img src="${target}/second-image">`,
        `<iframe src="${target}/second-frame"></iframe>`,
        `<style>@import "${target}/second-import.css"; .private { background-image: url("file:///etc/hostname"); }</style>`,
        '<p>Second export content</p>',
      ].join('\n');
      second = await (service as any).generatePDFBuffer(await (service as any).getDocumentHtml('doc-1')) as Buffer;
    } finally {
      createContextSpy.mockRestore();
    }

    const secondText = extractPdfText(second!);

    expect(contextCount).toBe(2);
    expect(firstContextCookie).toContain('first-export-state');
    expect(secondContextCookies).not.toContain('first-export-state');
    expect(pdfHasHeader(first!)).toBe(true);
    expect(pdfHasHeader(second!)).toBe(true);
    expect(secondText).toContain('Second export content');
    expect(secondText).not.toContain(INTERNAL_SECRET);
    expect(countRedPixelsInPdf(second!)).toBeGreaterThan(100);
    expect(requests).toEqual([]);
  }, 60000);
});
