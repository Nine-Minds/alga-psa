import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import jsQR from 'jsqr';
import { afterAll, describe, expect, it } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

import { browserPoolService } from '../../services/browserPoolService';
import { renderHtmlToPdf } from '../../services/labelPdfService';
import { getStandardLabelTemplateAstByCode, STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE } from '../label-template-ast/standardTemplates';
import { renderLabelBatchHtml, type LabelPrintItem } from './renderLabelBatchHtml';

const { PNG } = createRequire(import.meta.url)('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
};
const pageLayout = { kind: 'one-per-page', pageSize: { width: 8.5, height: 11, unit: 'in' } } as const;
const recordId = '11111111-1111-4111-8111-111111111111';
const viewModel: LabelViewModel = {
  labelClass: 'ticket-work-tag',
  entityType: 'ticket',
  recordId,
  url: recordUrl('ticket', recordId, 'https://psa.example.com'),
  identifier: 'TIC-32108',
  code128Value: null,
  title: 'Desktop cannot connect',
  clientName: 'Customer',
  detail: 'Hardware',
  secondaryIdentifier: 'CFD-DC-2021',
  serialSuffix: null,
  assetSerialNumber: '1234567',
  ticketDescription: 'First paragraph of the customer report.\nSecond paragraph with troubleshooting details.',
  linkedAsset: {
    assetId: '22222222-2222-4222-8222-222222222222',
    name: 'Customer desktop',
    manufacturer: 'Example',
    model: 'Workstation',
    osLine: 'Windows',
    cpuLine: 'Intel Core i7 / 8 cores',
    ramLine: '16 GB',
    storageLine: '512 GB SSD',
  },
};
const item = (description = viewModel.ticketDescription): LabelPrintItem => ({
  templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
  viewModel: { ...viewModel, ticketDescription: description },
});

// Page geometry straight from the PDF: pdf-lib reads the MediaBox of every page, so the checks do
// not need poppler (pdfinfo / pdftotext) on the machine running the suite.
async function pdfPageSizes(pdf: Buffer): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height };
  });
}

afterAll(async () => {
  await browserPoolService.cleanup();
});

describe('Letter customer worksheet PDF', () => {
  it('prints a rich description with visible tables, heading hierarchy and checklist states', async () => {
    const richText = [
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'New Equipment / System Setup' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Link the device to the client asset record.' }] },
      { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'Setup Requirements' }] },
      { type: 'table', content: { type: 'tableContent', rows: [
        { cells: [
          { type: 'tableCell', content: [{ type: 'text', text: 'Data Transfer' }] },
          { type: 'tableCell', content: [{ type: 'text', text: '50gb' }] },
        ] },
        { cells: [
          { type: 'tableCell', content: [{ type: 'text', text: 'Software to Install' }] },
          { type: 'tableCell', content: [{ type: 'text', text: 'Approved software or none' }] },
        ] },
      ] } },
      { type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'Wi-Fi' }] },
      { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'Ethernet' }] },
    ];
    const { html, printOptions } = await renderLabelBatchHtml([{
      ...item(), viewModel: { ...viewModel, ticketDescriptionRichText: JSON.stringify(richText) },
    }], pageLayout);
    const pdf = await renderHtmlToPdf(html, printOptions);
    expect(await pdfPageSizes(pdf)).toHaveLength(1);
    const printedText = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
    for (const value of ['New Equipment / System Setup', 'Data Transfer', '50gb', 'Wi-Fi', 'Ethernet']) {
      expect(printedText).toContain(value);
    }

    const browser = await browserPoolService.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.emulateMediaType('print');
      const description = await page.$eval('#fld-details', (element) => {
        const cells = Array.from(element.querySelectorAll('td'));
        const table = element.querySelector('table');
        const completed = element.querySelector('s');
        const heading = element.querySelector('h2');
        if (!table || !completed || !heading || !cells.length) throw new Error('Rich description structure is missing');
        return {
          cells: cells.map(cell => cell.textContent),
          borderWidth: getComputedStyle(cells[0]).borderTopWidth,
          borderCollapse: getComputedStyle(table).borderCollapse,
          headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
          bodySize: Number.parseFloat(getComputedStyle(element).fontSize),
          strike: getComputedStyle(completed).textDecorationLine,
          text: element.textContent,
        };
      });
      expect(description.cells).toEqual(['Data Transfer', '50gb', 'Software to Install', 'Approved software or none']);
      expect(description.borderWidth).toBe('1px');
      expect(description.borderCollapse).toBe('collapse');
      expect(description.headingSize).toBeGreaterThan(description.bodySize);
      expect(description.strike).toContain('line-through');
      expect(description.text).toContain('\u2611');
      expect(description.text).toContain('\u2610');
    } finally {
      await page.close();
      await browserPoolService.releaseBrowser(browser);
    }
  }, 120_000);

  it('flows a long rich-description table across pages without clipping its rows', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ cells: [
      { type: 'tableCell', content: [{ type: 'text', text: `Requirement ${index + 1}` }] },
      { type: 'tableCell', content: [{ type: 'text', text: `Approved configuration for requirement ${index + 1}` }] },
    ] }));
    const { html, printOptions } = await renderLabelBatchHtml([{
      ...item(),
      viewModel: {
        ...viewModel,
        ticketDescriptionRichText: [{ type: 'table', content: { type: 'tableContent', headerRows: 1, rows } }],
      },
    }], pageLayout);
    expect(html.match(/<tr>/g)).toHaveLength(rows.length);
    expect(html).toContain('Approved configuration for requirement 60');
    const pdf = await renderHtmlToPdf(html, printOptions);
    expect((await pdfPageSizes(pdf)).length).toBeGreaterThan(1);
    const printedText = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
    for (let index = 1; index <= rows.length; index += 1) {
      expect(printedText).toContain(`Approved configuration for requirement ${index}`);
    }
  }, 120_000);

  it('prints the full serial and multiline description on one Letter page with a canonical QR', async () => {
    const { html, printOptions } = await renderLabelBatchHtml([item()], pageLayout);
    const pdf = await renderHtmlToPdf(html, printOptions);
    const pages = await pdfPageSizes(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBeCloseTo(612, 0);
    expect(pages[0].height).toBeCloseTo(792, 0);
    const printedText = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
    expect(printedText).toContain('CFD-DC-2021');
    expect(printedText).toContain('1234567');
    expect(printedText).toContain('First paragraph of the customer report.');
    expect(printedText).toContain('Second paragraph with troubleshooting details.');
    expect(printedText).toContain('Intel Core i7 / 8 cores');

    const browser = await browserPoolService.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.emulateMediaType('print');
      const fields = await page.evaluate(() => {
        const gapAfterLabel = (id: string) => {
          const [label, value] = Array.from(document.querySelectorAll(`#${id} > span`));
          return value.getBoundingClientRect().left - label.getBoundingClientRect().right;
        };
        return {
          assetTag: document.querySelector('#fld-asset')?.textContent,
          serial: document.querySelector('#fld-serial')?.textContent,
          description: document.querySelector('#fld-details')?.textContent,
          assetTagGap: gapAfterLabel('fld-asset'),
          specGap: gapAfterLabel('spec-cpu'),
        };
      });
      expect(fields.assetTag).toBe('Asset Tag: CFD-DC-2021');
      expect(fields.serial).toContain('1234567');
      expect(fields.description).toBe(viewModel.ticketDescription);
      // Values sit next to their labels instead of being pushed to the far edge of the row.
      expect(fields.assetTagGap).toBeLessThan(16);
      expect(fields.specGap).toBeLessThan(16);
      const qr = await page.$('#qr');
      if (!qr) throw new Error('The worksheet QR code was not rendered');
      const raster = PNG.sync.read(Buffer.from(await qr.screenshot({ type: 'png' })));
      const pixels = new Uint8ClampedArray(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength);
      expect(jsQR(pixels, raster.width, raster.height)?.data).toBe(viewModel.url);
    } finally {
      await page.close();
      await browserPoolService.releaseBrowser(browser);
    }
  }, 120_000);

  it('flows a long description onto continuation pages instead of clipping it', async () => {
    const longDescription = Array.from({ length: 100 }, (_, index) => `Description line ${index + 1}`).join('\n');
    const { html, printOptions } = await renderLabelBatchHtml([item(), item(longDescription)], pageLayout);
    const pdf = await renderHtmlToPdf(html, printOptions);
    // The short worksheet stays on its own page and the 100-line description spills onto more.
    const pages = await pdfPageSizes(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      expect(page.width).toBeCloseTo(612, 0);
      expect(page.height).toBeCloseTo(792, 0);
    }
    const printedText = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8' });
    expect(printedText).toContain('Description line 1');
    expect(printedText).toContain('Description line 100');
    expect(printedText).toContain('First paragraph of the customer report.');
  }, 120_000);

  it('also detects text clipped inside an explicitly sized custom worksheet field', async () => {
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE);
    if (!ast?.layout.children) throw new Error('The worksheet template has no layout children');
    ast.layout.children.push({
      id: 'small-description',
      type: 'text',
      content: { type: 'binding', bindingId: 'ticketDescription' },
      style: { inline: { width: '200px', height: '15px', overflow: 'hidden', whiteSpace: 'pre-wrap' } },
    });
    const { html, printOptions } = await renderLabelBatchHtml([{ ...item(), templateAst: ast }], pageLayout);
    await expect(renderHtmlToPdf(html, printOptions)).rejects.toThrow(/Worksheet 1 contains text that does not fit/);
  }, 120_000);

  it('wraps a long ticket number without clipping it', async () => {
    const identifier = `TIC-${'1234567890'.repeat(6)}`;
    const { html, printOptions } = await renderLabelBatchHtml([
      { ...item(), viewModel: { ...viewModel, identifier } },
    ], pageLayout);
    const pdf = await renderHtmlToPdf(html, printOptions);
    expect(await pdfPageSizes(pdf)).toHaveLength(1);

    const browser = await browserPoolService.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.emulateMediaType('print');
      const ticketNumber = await page.$eval('#ticket-number-value', (element) => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(style.lineHeight),
        };
      });
      expect(ticketNumber.text).toBe(identifier);
      expect(ticketNumber.scrollWidth).toBeLessThanOrEqual(ticketNumber.width + 1);
      expect(ticketNumber.height).toBeGreaterThan(ticketNumber.lineHeight * 1.5);
    } finally {
      await page.close();
      await browserPoolService.releaseBrowser(browser);
    }
  }, 120_000);
});
