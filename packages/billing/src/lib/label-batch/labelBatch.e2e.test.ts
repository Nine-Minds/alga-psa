/**
 * End to end: label view models -> template evaluate -> barcode prepass -> composed HTML -> Chromium
 * PDF -> rasterize with pdftoppm -> decode the codes -> compare with the canonical record URL.
 * Needs a Chromium that Puppeteer can launch (PUPPETEER_EXECUTABLE_PATH or its own download) and
 * `pdftoppm` and `pdfinfo` (poppler) on PATH. Both are required: this test fails, not skips, when they are absent.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jsQR from 'jsqr';
import { createRequire } from 'node:module';
// pngjs ships no types (and ambient *.d.ts files are gitignored here), so type the one call we use.
const { PNG } = createRequire(import.meta.url)('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
};
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { afterAll, describe, expect, it } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

import { browserPoolService } from '../../services/browserPoolService';
import { renderHtmlToPdf } from '../../services/labelPdfService';
import { renderLabelBatchHtml, type LabelPrintItem } from './renderLabelBatchHtml';
import {
  STANDARD_LABEL_ASSET_CODE,
  STANDARD_LABEL_ASSET_CODE128_CODE,
  STANDARD_LABEL_RMA_CODE,
  STANDARD_LABEL_STOCK_UNIT_CODE,
  STANDARD_LABEL_TICKET_WORK_TAG_CODE,
} from '../label-template-ast/standardTemplates';
import type { LabelBatchLayout } from './layout';

const BASE = 'https://psa.example.com';
const DPI = 300;
const PT_PER_IN = 72;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ticketLabel = (n: number): LabelPrintItem => ({
  viewModel: {
    labelClass: 'ticket-work-tag',
    entityType: 'ticket',
    recordId: uuid(n),
    url: recordUrl('ticket', uuid(n), BASE),
    identifier: `TIC-${String(1000 + n)}`,
    code128Value: null,
    title: `Item ${n}`,
    clientName: 'Emerald City Dental',
    detail: 'Diagnose power fault',
    secondaryIdentifier: null,
    serialSuffix: null,
  } satisfies LabelViewModel,
});

const assetLabel = (n: number, tag?: string): LabelPrintItem => ({
  templateCode: STANDARD_LABEL_ASSET_CODE128_CODE,
  viewModel: {
    labelClass: 'asset-identity',
    entityType: 'asset',
    recordId: uuid(500 + n),
    url: recordUrl('asset', uuid(500 + n), BASE),
    identifier: tag ?? `AT-${String(100 + n).padStart(6, '0')}`,
    code128Value: tag ?? `AT-${String(100 + n).padStart(6, '0')}`,
    title: `Laptop ${n}`,
    clientName: 'Emerald City Dental',
    detail: null,
    secondaryIdentifier: null,
    serialSuffix: null,
  } satisfies LabelViewModel,
});

// Worst-case real data: an RMM-imported asset tag (39 chars, no break opportunities), a tag at the
// 29-character Code 128 limit, and long free text everywhere else.
const RMM_TAG = 'levelio:Z2lkOi8vbGV2ZWwvRGV2aWNlLzkwMDE';
const CODE128_LIMIT_TAG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012';
const LONG_TITLE = 'Dell Latitude 7440 Ultralight Business Laptop with Docking Station and Spare Charger';
const LONG_CLIENT = 'Emerald City Dental and Orthodontic Associates of the Greater Oz Metropolitan Area';
const LONG_DETAIL = 'Customer reports intermittent power loss when docked; replace DC jack and test battery under load';

const worstCase = (
  templateCode: string,
  overrides: Partial<LabelViewModel> & Pick<LabelViewModel, 'labelClass' | 'entityType'>
): LabelPrintItem => {
  const recordId = uuid(900);
  return {
    templateCode,
    viewModel: {
      recordId,
      url: recordUrl(overrides.entityType, recordId, BASE),
      identifier: RMM_TAG,
      code128Value: null,
      title: LONG_TITLE,
      clientName: LONG_CLIENT,
      detail: LONG_DETAIL,
      secondaryIdentifier: RMM_TAG,
      serialSuffix: 'SN…ZX81QW77',
      ...overrides,
    } as LabelViewModel,
  };
};

interface ContainmentReport {
  /** Text whose painted glyphs fall outside the label's printable area. */
  outside: string[];
  /** Text whose painted glyphs overlap a barcode. */
  overBarcode: string[];
  /** Identifier text as laid out (must be complete: identifiers are never clipped). */
  identifierText: string[];
  identifierClipped: boolean[];
}

/**
 * Lay the composed document out in Chromium and measure every painted text fragment (Range client
 * rects, so glyphs that overflow their box count) against the cell's printable area and the barcodes.
 */
async function measureContainment(html: string): Promise<ContainmentReport[]> {
  const browser = await browserPoolService.getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMediaType('print');
    return await page.evaluate(() => {
      const slack = 0.5; // CSS px of rounding slack
      const inside = (r: DOMRect, box: { l: number; t: number; r: number; b: number }) =>
        r.left >= box.l - slack && r.top >= box.t - slack && r.right <= box.r + slack && r.bottom <= box.b + slack;
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack;
      return Array.from(document.querySelectorAll<HTMLElement>('.label-cell')).map((cell) => {
        // Printable area = the label cell inset by the template margin (the document root's padding).
        const rect = cell.getBoundingClientRect();
        const cs = getComputedStyle(cell.querySelector<HTMLElement>('#root') ?? cell);
        const box = {
          l: rect.left + parseFloat(cs.paddingLeft),
          t: rect.top + parseFloat(cs.paddingTop),
          r: rect.right - parseFloat(cs.paddingRight),
          b: rect.bottom - parseFloat(cs.paddingBottom),
        };
        const barcodes = Array.from(cell.querySelectorAll<HTMLElement>('svg')).map((svg) => svg.getBoundingClientRect());
        const outside: string[] = [];
        const overBarcode: string[] = [];
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          // Visible part only: a capped block (overflow hidden) legitimately hides its overflow.
          let clip: DOMRect | null = null;
          for (let el = node.parentElement; el && el !== cell; el = el.parentElement) {
            if (getComputedStyle(el).overflow !== 'visible') {
              clip = el.getBoundingClientRect();
              break;
            }
          }
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of Array.from(range.getClientRects())) {
            if (clip && (r.top >= clip.bottom - slack || r.bottom <= clip.top + slack)) continue;
            const visible = clip
              ? new DOMRect(r.left, Math.max(r.top, clip.top), r.width, Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top))
              : r;
            if (!inside(visible, box)) outside.push(node.textContent.trim());
            if (barcodes.some((b) => overlaps(visible, b))) overBarcode.push(node.textContent.trim());
          }
        }
        const identifiers = Array.from(cell.querySelectorAll<HTMLElement>('#asset-tag, #ticket-number, #unit-code'));
        return {
          outside: Array.from(new Set(outside)),
          overBarcode: Array.from(new Set(overBarcode)),
          identifierText: identifiers.map((el) => el.textContent ?? ''),
          identifierClipped: identifiers.map((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
        };
      });
    });
  } finally {
    await page.close().catch(() => undefined);
    await browserPoolService.releaseBrowser(browser).catch(() => undefined);
  }
}

interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const workDir = mkdtempSync(path.join(tmpdir(), 'label-e2e-'));
afterAll(async () => {
  rmSync(workDir, { recursive: true, force: true });
  await browserPoolService.cleanup();
});

function writePdf(pdf: Buffer, name: string): string {
  const pdfPath = path.join(workDir, `${name}.pdf`);
  writeFileSync(pdfPath, pdf);
  return pdfPath;
}

/**
 * Page sizes in PDF points, read by poppler's `pdfinfo` rather than pdf-lib: the server unit
 * config (which runs this suite in CI) aliases `pdf-lib` to an empty module.
 */
function pageSizes(pdfPath: string): Array<{ width: number; height: number }> {
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '100000', pdfPath], { encoding: 'utf8' });
  return [...info.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/gm)].map((m) => ({
    width: Number(m[1]),
    height: Number(m[2]),
  }));
}

function rasterize(pdfPath: string, name: string): Raster[] {
  execFileSync('pdftoppm', ['-r', String(DPI), '-png', pdfPath, path.join(workDir, name)]);
  return readdirSync(workDir)
    .filter((file) => file.startsWith(`${name}-`) && file.endsWith('.png'))
    .sort()
    .map((file) => {
      const png = PNG.sync.read(readFileSync(path.join(workDir, file)));
      return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
    });
}

function crop(image: Raster, leftPx: number, topPx: number, widthPx: number, heightPx: number): Raster {
  const x0 = Math.max(0, Math.round(leftPx));
  const y0 = Math.max(0, Math.round(topPx));
  const w = Math.min(Math.round(widthPx), image.width - x0);
  const h = Math.min(Math.round(heightPx), image.height - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const src = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

const decodeQr = (image: Raster): string | null => jsQR(image.data, image.width, image.height)?.data ?? null;

function decodeCode128(image: Raster): string | null {
  const luminance = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0; i < luminance.length; i += 1) {
    const p = i * 4;
    luminance[i] = (image.data[p] * 299 + image.data[p + 1] * 587 + image.data[p + 2] * 114) / 1000;
  }
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, image.width, image.height)));
    return reader.decode(bitmap).getText();
  } catch {
    return null;
  }
}

const mmToPx = (mm: number) => (mm / 25.4) * DPI;

/** True when the outer `bandMm` of the image is entirely white on all four edges (printable-area margin). */
function edgeBandIsWhite(image: Raster, bandMm = 3): boolean {
  const band = Math.floor(mmToPx(bandMm)) - 1; // one pixel of slack for rasteriser rounding
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const inBand = x < band || y < band || x >= image.width - band || y >= image.height - band;
      if (!inBand) continue;
      const p = (y * image.width + x) * 4;
      if (image.data[p] < 250 || image.data[p + 1] < 250 || image.data[p + 2] < 250) return false;
    }
  }
  return true;
}

/** Rows (from the top) of the lowest non-white pixel: used to prove whitespace remains below the bars. */
function lowestInkRow(image: Raster): number {
  for (let y = image.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < image.width; x += 1) {
      const p = (y * image.width + x) * 4;
      if (image.data[p] < 200) return y;
    }
  }
  return -1;
}

async function printLabels(items: LabelPrintItem[], layout: LabelBatchLayout, name: string) {
  const { html, geometry, printOptions } = await renderLabelBatchHtml(items, layout, {
    tenantClient: { name: 'Example MSP', logoUrl: null },
  });
  const pdf = await renderHtmlToPdf(html, printOptions);
  const pdfPath = writePdf(pdf, name);
  return { html, geometry, pdf, pages: pageSizes(pdfPath), rasters: rasterize(pdfPath, name) };
}

const ONE_PER_PAGE: LabelBatchLayout = { kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } };
// Avery 5163 style: 2 x 5 labels of 4 x 2 in on Letter.
const LETTER_2X5: LabelBatchLayout = {
  kind: 'grid',
  paper: 'Letter',
  columns: 2,
  rows: 5,
  unit: 'in',
  labelWidth: 4,
  labelHeight: 2,
  marginTop: 0.5,
  marginLeft: 0.156,
  gutterX: 0.188,
  gutterY: 0,
};

describe('label PDF end to end', () => {
  it('prints a 4x2in single label whose QR decodes to exactly its recordUrl', async () => {
    const item = ticketLabel(1);
    const { pages, rasters } = await printLabels([item], ONE_PER_PAGE, 'single');

    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBeCloseTo(4 * PT_PER_IN, 0);
    expect(pages[0].height).toBeCloseTo(2 * PT_PER_IN, 0);
    expect(decodeQr(rasters[0])).toBe(item.viewModel.url);
  }, 120_000);

  it('prints each label on its own page, in order, for a thermal roll', async () => {
    const items = [ticketLabel(1), ticketLabel(2), ticketLabel(3)];
    const { pages, rasters } = await printLabels(items, ONE_PER_PAGE, 'roll');
    expect(pages).toHaveLength(3);
    expect(rasters.map(decodeQr)).toEqual(items.map((i) => i.viewModel.url));
  }, 120_000);

  it('lays three records out n-up on Letter in record order, each QR decoding to its own recordUrl', async () => {
    const items = [ticketLabel(1), ticketLabel(2), ticketLabel(3)];
    const { geometry, pages, rasters } = await printLabels(items, LETTER_2X5, 'nup');

    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBeCloseTo(8.5 * PT_PER_IN, 0);
    expect(pages[0].height).toBeCloseTo(11 * PT_PER_IN, 0);
    expect(rasters).toHaveLength(1);

    // Row-major: 0 -> (col0,row0), 1 -> (col1,row0), 2 -> (col0,row1).
    expect(geometry.placements.map((p) => [p.column, p.row])).toEqual([[0, 0], [1, 0], [0, 1]]);
    const decoded = geometry.placements.map((p) =>
      decodeQr(crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm)))
    );
    expect(decoded).toEqual(items.map((i) => i.viewModel.url));
  }, 120_000);

  it('continues on a second sheet when the first one is full, still in order', async () => {
    const items = Array.from({ length: 11 }, (_, i) => ticketLabel(i + 1));
    const { geometry, pages, rasters } = await printLabels(items, LETTER_2X5, 'nup2');
    expect(pages).toHaveLength(2);
    const last = geometry.placements[10];
    expect(last.sheet).toBe(1);
    const decoded = decodeQr(
      crop(rasters[1], mmToPx(last.leftMm), mmToPx(last.topMm), mmToPx(last.widthMm), mmToPx(last.heightMm))
    );
    expect(decoded).toBe(items[10].viewModel.url);
  }, 120_000);

  it('Code 128 decodes to its identifier and the QR on the same label to its recordUrl (n-up)', async () => {
    const items = [assetLabel(1), assetLabel(2), assetLabel(3)];
    const { geometry, rasters } = await printLabels(items, LETTER_2X5, 'code128');
    geometry.placements.forEach((p, i) => {
      const cell = crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm));
      expect(decodeQr(cell)).toBe(items[i].viewModel.url);
      expect(decodeCode128(cell)).toBe(items[i].viewModel.code128Value);
    });
  }, 120_000);

  it('Code 128 on a single 4x2in label decodes', async () => {
    const item = assetLabel(7);
    const { rasters } = await printLabels([item], ONE_PER_PAGE, 'code128-single');
    expect(decodeCode128(rasters[0])).toBe(item.viewModel.code128Value);
    expect(decodeQr(rasters[0])).toBe(item.viewModel.url);
  }, 120_000);

  it('4x2in Code 128 label: 3 mm white margin on all edges, whitespace under the bars, both codes decode', async () => {
    const item = assetLabel(8);
    const { rasters } = await printLabels([item], ONE_PER_PAGE, 'code128-margin');
    expect(edgeBandIsWhite(rasters[0])).toBe(true);
    // Bars end at least 2 mm above the 3 mm margin band, i.e. visible whitespace below the bars.
    expect(rasters[0].height - lowestInkRow(rasters[0])).toBeGreaterThan(mmToPx(3 + 2));
    expect(decodeCode128(rasters[0])).toBe(item.viewModel.code128Value);
    expect(decodeQr(rasters[0])).toBe(item.viewModel.url);
  }, 120_000);

  it('renders and decodes a 17-character asset tag (no sizing refusal)', async () => {
    const item = assetLabel(9, 'REVIEW-NINJA-WS01');
    const { rasters } = await printLabels([item], ONE_PER_PAGE, 'code128-long');
    expect(decodeCode128(rasters[0])).toBe('REVIEW-NINJA-WS01');
    expect(decodeQr(rasters[0])).toBe(item.viewModel.url);
    expect(edgeBandIsWhite(rasters[0])).toBe(true);
  }, 120_000);

  it('keeps the Code 128 label inside its cell on a Letter 2x5 sheet (cell-edge band is white)', async () => {
    const items = [assetLabel(1, 'REVIEW-NINJA-WS01'), assetLabel(2)];
    const { geometry, rasters } = await printLabels(items, LETTER_2X5, 'code128-cell');
    geometry.placements.forEach((p, i) => {
      const cell = crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm));
      expect(edgeBandIsWhite(cell)).toBe(true);
      expect(decodeCode128(cell)).toBe(items[i].viewModel.code128Value);
    });
  }, 120_000);

  describe('long text never leaves the label or covers a code', () => {
    const cases: Array<[string, LabelPrintItem]> = [
      [
        'QR-only asset label, 39-char RMM tag (the Code 128 fallback)',
        worstCase(STANDARD_LABEL_ASSET_CODE, { labelClass: 'asset-identity', entityType: 'asset' }),
      ],
      [
        'Code 128 asset label, tag at the 29-char Code 128 limit',
        worstCase(STANDARD_LABEL_ASSET_CODE128_CODE, {
          labelClass: 'asset-identity',
          entityType: 'asset',
          identifier: CODE128_LIMIT_TAG,
          code128Value: CODE128_LIMIT_TAG,
        }),
      ],
      [
        'ticket work tag, long ticket number and linked RMM tag',
        worstCase(STANDARD_LABEL_TICKET_WORK_TAG_CODE, {
          labelClass: 'ticket-work-tag',
          entityType: 'ticket',
          identifier: 'TICKET-2026-0000123456789',
        }),
      ],
      [
        'ticket work tag with held equipment, longest location/bin and next-action strings (they replace the reason line)',
        worstCase(STANDARD_LABEL_TICKET_WORK_TAG_CODE, {
          labelClass: 'ticket-work-tag',
          entityType: 'ticket',
          identifier: 'TICKET-2026-0000123456789',
          custodyLocation: 'Main Office Headquarters Annex / Rack 14 Shelf B3 Upper Left Bin',
          nextAction: 'Waiting on vendor, Oct 29 and then a very long trailing explanation',
        }),
      ],
      [
        'stock unit label, long unit code',
        worstCase(STANDARD_LABEL_STOCK_UNIT_CODE, { labelClass: 'stock-unit-identity', entityType: 'stock_unit' }),
      ],
    ];

    for (const [name, item] of cases) {
      for (const [layoutName, layout] of [
        ['4x2in', ONE_PER_PAGE],
        ['Letter 2x5', LETTER_2X5],
      ] as const) {
        it(`${name} (${layoutName})`, async () => {
          const { html } = await renderLabelBatchHtml([item, item], layout, {
            tenantClient: { name: 'Example MSP', logoUrl: null },
          });
          for (const report of await measureContainment(html)) {
            expect(report.outside).toEqual([]);
            expect(report.overBarcode).toEqual([]);
            expect(report.identifierText).toEqual([item.viewModel.identifier]);
            expect(report.identifierClipped).toEqual([false]);
          }
          const { rasters, geometry } = await printLabels([item], layout, `contain-${layoutName}-${item.templateCode}`);
          const p = geometry.placements[0];
          const cell = crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm));
          expect(edgeBandIsWhite(cell)).toBe(true);
          expect(decodeQr(cell)).toBe(item.viewModel.url);
          if (item.viewModel.code128Value) expect(decodeCode128(cell)).toBe(item.viewModel.code128Value);
        }, 120_000);
      }
    }
  });

  describe('RMA work tag (T033, F022.4)', () => {
    const rmaItem = (n: number, overrides: Partial<LabelViewModel> = {}, withTemplateCode = false): LabelPrintItem => ({
      ...(withTemplateCode ? { templateCode: STANDARD_LABEL_RMA_CODE } : {}),
      viewModel: {
        labelClass: 'rma-work-tag',
        entityType: 'rma',
        recordId: uuid(700 + n),
        url: recordUrl('rma', uuid(700 + n), BASE),
        identifier: `RMA-${String(n).padStart(5, '0')}`,
        code128Value: null,
        title: 'Dell Latitude 7440 Laptop',
        clientName: 'Emerald City Dental',
        detail: 'Dell Technologies / 1234-5678-90',
        secondaryIdentifier: 'AT-000123',
        serialSuffix: 'SN…ZX81QW77',
        rma: { statusLabel: 'Sent to vendor', returnBy: '2026-11-15', shipping: 'UPS 1Z999AA10123456784', ticketNumber: 'TIC-1042' },
        ...overrides,
      } as LabelViewModel,
    });

    it('the QR URL is the canonical /msp/inventory/rma?rmaId= record URL', () => {
      const item = rmaItem(1);
      expect(item.viewModel.url).toBe(`${BASE}/msp/inventory/rma?rmaId=${uuid(701)}`);
    });

    it('renders the standard rma-work-tag on a 4x2in cell and its QR decodes to the RMA record URL', async () => {
      const item = rmaItem(1);
      const { html, pages, rasters } = await printLabels([item], ONE_PER_PAGE, 'rma-single');
      expect(html).toContain('RMA-00001');
      expect(pages).toHaveLength(1);
      expect(pages[0].width).toBeCloseTo(4 * PT_PER_IN, 0);
      expect(pages[0].height).toBeCloseTo(2 * PT_PER_IN, 0);
      expect(decodeQr(rasters[0])).toBe(item.viewModel.url);
      expect(edgeBandIsWhite(rasters[0])).toBe(true);
    }, 120_000);

    it('decodes per record when n-up on Letter 2x5', async () => {
      const items = [rmaItem(1), rmaItem(2, {}, true), rmaItem(3)];
      const { geometry, rasters } = await printLabels(items, LETTER_2X5, 'rma-nup');
      geometry.placements.forEach((p, i) => {
        const cell = crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm));
        expect(decodeQr(cell)).toBe(items[i].viewModel.url);
      });
    }, 120_000);

    for (const [layoutName, layout] of [
      ['4x2in', ONE_PER_PAGE],
      ['Letter 2x5', LETTER_2X5],
    ] as const) {
      it(`all text stays inside the cell and clear of the QR, with worst-case long data (${layoutName})`, async () => {
        const item = worstCase(STANDARD_LABEL_RMA_CODE, {
          labelClass: 'rma-work-tag',
          entityType: 'rma',
          identifier: 'RMA-2026-000000123456789',
          detail: `${LONG_CLIENT} / VENDOR-REFERENCE-0000000000000000000001`,
          rma: {
            statusLabel: 'Replacement received from vendor',
            returnBy: '2026-11-15',
            shipping: 'UPS 1Z999AA10123456784-WITH-A-VERY-LONG-TRAILING-REFERENCE',
            ticketNumber: 'TICKET-2026-0000123456789',
          },
        });
        const { html } = await renderLabelBatchHtml([item, item], layout, { tenantClient: { name: 'Example MSP', logoUrl: null } });
        for (const report of await measureContainment(html)) {
          expect(report.outside).toEqual([]);
          expect(report.overBarcode).toEqual([]);
        }
        const { rasters, geometry } = await printLabels([item], layout, `rma-contain-${layoutName}`);
        const p = geometry.placements[0];
        const cell = crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm));
        expect(edgeBandIsWhite(cell)).toBe(true);
        expect(decodeQr(cell)).toBe(item.viewModel.url);
      }, 120_000);
    }
  });

  describe('a real tenant logo (data URL) on every standard template', () => {
    // A wide 600x200 logo, the shape that stresses the header most; inlined exactly as labelPdfService does.
    const logoPng = (() => {
      const { PNG: Writer } = createRequire(import.meta.url)('pngjs') as {
        PNG: new (o: { width: number; height: number }) => { data: Buffer };
      } & { sync: { write(p: unknown): Buffer } };
      const img = new Writer({ width: 600, height: 200 });
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = 20;
        img.data[i + 1] = 90;
        img.data[i + 2] = 200;
        img.data[i + 3] = 255;
      }
      return (Writer as unknown as { sync: { write(p: unknown): Buffer } }).sync.write(img);
    })();
    const logoUrl = `data:image/png;base64,${logoPng.toString('base64')}`;
    const withLogo = { tenantClient: { name: 'Example MSP', logoUrl } };

    const cases: Array<[string, LabelPrintItem]> = [
      ['ticket work tag', worstCase(STANDARD_LABEL_TICKET_WORK_TAG_CODE, { labelClass: 'ticket-work-tag', entityType: 'ticket', identifier: 'TICKET-2026-0000123456789' })],
      ['QR-only asset label', worstCase(STANDARD_LABEL_ASSET_CODE, { labelClass: 'asset-identity', entityType: 'asset' })],
      [
        'Code 128 asset label',
        worstCase(STANDARD_LABEL_ASSET_CODE128_CODE, {
          labelClass: 'asset-identity',
          entityType: 'asset',
          identifier: CODE128_LIMIT_TAG,
          code128Value: CODE128_LIMIT_TAG,
        }),
      ],
      ['stock unit label', worstCase(STANDARD_LABEL_STOCK_UNIT_CODE, { labelClass: 'stock-unit-identity', entityType: 'stock_unit' })],
    ];

    for (const [name, item] of cases) {
      for (const [layoutName, layout] of [
        ['4x2in', ONE_PER_PAGE],
        ['Letter 2x5', LETTER_2X5],
      ] as const) {
        it(`${name} with logo (${layoutName})`, async () => {
          const { html } = await renderLabelBatchHtml([item, item], layout, withLogo);
          // The logo is really in the page for templates that show it (and never replaces a code).
          if (item.viewModel.entityType !== 'stock_unit') expect(html).toContain('data:image/png;base64,');
          for (const report of await measureContainment(html)) {
            expect(report.outside).toEqual([]);
            expect(report.overBarcode).toEqual([]);
            expect(report.identifierText).toEqual([item.viewModel.identifier]);
            expect(report.identifierClipped).toEqual([false]);
          }
          const { html: printedHtml, geometry, pdf } = await (async () => {
            const r = await renderLabelBatchHtml([item], layout, withLogo);
            return { ...r, pdf: await renderHtmlToPdf(r.html, r.printOptions) };
          })();
          if (item.viewModel.entityType !== 'stock_unit') expect(printedHtml).toContain('<img');
          const pdfPath = writePdf(pdf, `logo-${layoutName}-${item.templateCode}`);
          const rasters = rasterize(pdfPath, `logo-${layoutName}-${item.templateCode}`);
          const p = geometry.placements[0];
          const cell = crop(rasters[0], mmToPx(p.leftMm), mmToPx(p.topMm), mmToPx(p.widthMm), mmToPx(p.heightMm));
          expect(edgeBandIsWhite(cell)).toBe(true);
          expect(decodeQr(cell)).toBe(item.viewModel.url);
          if (item.viewModel.code128Value) expect(decodeCode128(cell)).toBe(item.viewModel.code128Value);
        }, 120_000);
      }
    }
  });
});
