/**
 * End to end: label view models -> template evaluate -> barcode prepass -> composed HTML -> Chromium
 * PDF -> rasterize with pdftoppm -> decode the codes -> compare with the canonical record URL.
 * Needs a Chromium that Puppeteer can launch (PUPPETEER_EXECUTABLE_PATH or its own download) and
 * `pdftoppm` (poppler) on PATH. Both are required: this test fails, not skips, when they are absent.
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
import { PDFDocument } from 'pdf-lib';
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
import { STANDARD_LABEL_ASSET_CODE128_CODE } from '../label-template-ast/standardTemplates';
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

function rasterize(pdf: Buffer, name: string): Raster[] {
  const pdfPath = path.join(workDir, `${name}.pdf`);
  writeFileSync(pdfPath, pdf);
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
  const doc = await PDFDocument.load(pdf);
  return { html, geometry, pdf, pages: doc.getPages().map((p) => p.getSize()), rasters: rasterize(pdf, name) };
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
});
