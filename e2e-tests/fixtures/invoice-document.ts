import { readFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

/** Parse the bytes downloaded by the shipped UI, not its HTML preview. */
export async function readInvoiceDownload(page: Page, testInfo: TestInfo, number: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.locator('#invoice-download-pdf').click(),
  ]);
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toBe(`${number}.pdf`);
  const file = testInfo.outputPath(`${number}.pdf`);
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await task.promise;
    expect(document.numPages).toBeGreaterThan(0);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const pdfPage = await document.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      pdfPage.cleanup();
    }
    const text = pages.join('\n');
    await testInfo.attach('invoice-pdf-text', { body: text, contentType: 'text/plain' });
    await testInfo.attach('invoice-pdf', { path: file, contentType: 'application/pdf' });
    return text;
  } finally { await task.destroy(); }
}

export async function assertInvoiceDownload(page: Page, testInfo: TestInfo, invoice: {
  number: string; clientName: string; serviceName: string; amountCents: number; forbiddenText?: string[];
}) {
  const text = await readInvoiceDownload(page, testInfo, invoice.number);
  // PDF text runs can split identifiers at visual line wraps.
  const compact = text.replace(/\s/g, '');
  for (const forbidden of invoice.forbiddenText ?? []) expect(compact).not.toContain(forbidden.replace(/\s/g, ''));
  for (const value of [invoice.number, invoice.clientName, invoice.serviceName]) {
    expect(compact).toContain(value.replace(/\s/g, ''));
  }
  expect(text).toMatch(new RegExp(`\\bTotal\\s*\\$?\\s*${(invoice.amountCents / 100).toFixed(2).replace('.', '\\.')}\\b`));
}
