import { describe, expect, it } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

import { composeLabelSheets } from './composeLabelSheets';
import { LabelLayoutError, planLabelBatch, resolveLabelBatchPdfOptions, type GridLayout } from './layout';
import { LabelRenderError, assertCanonicalLabelUrl } from './renderLabelBatchHtml';

const grid = (overrides: Partial<GridLayout> = {}): GridLayout => ({
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
  ...overrides,
});

describe('planLabelBatch', () => {
  it('one-per-page: every label is its own page of the label size, in order', () => {
    const geometry = planLabelBatch({ kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } }, 3);
    expect(geometry.sheets).toBe(3);
    expect(geometry.placements.map((p) => p.sheet)).toEqual([0, 1, 2]);
    expect(geometry.pageWidthMm).toBeCloseTo(101.6);
    expect(resolveLabelBatchPdfOptions(geometry)).toMatchObject({
      width: '101.6mm',
      height: '50.8mm',
      preferCSSPageSize: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
  });

  it('grid: row-major order, spilling onto further sheets', () => {
    const geometry = planLabelBatch(grid({ columns: 2, rows: 2, labelWidth: 3, labelHeight: 2 }), 5);
    expect(geometry.sheets).toBe(2);
    expect(geometry.placements.map((p) => [p.sheet, p.row, p.column])).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [0, 1, 1],
      [1, 0, 0],
    ]);
    const [a, b] = geometry.placements;
    expect(b.leftMm - a.leftMm).toBeCloseTo((3 + 0.188) * 25.4);
    expect(a.topMm).toBeCloseTo(0.5 * 25.4);
  });

  it('grid: Letter, A4 and Legal sheets resolve to their real sizes', () => {
    expect(planLabelBatch(grid({ columns: 1, rows: 1 }), 1).pageHeightMm).toBeCloseTo(279.4);
    expect(planLabelBatch(grid({ paper: 'A4', columns: 1, rows: 1 }), 1).pageWidthMm).toBe(210);
    expect(planLabelBatch(grid({ paper: 'Legal', columns: 1, rows: 1 }), 1).pageHeightMm).toBeCloseTo(355.6);
  });

  it('rejects a grid that does not fit the paper instead of clipping it', () => {
    expect(() => planLabelBatch(grid({ columns: 3 }), 1)).toThrow(LabelLayoutError);
    expect(() => planLabelBatch(grid({ rows: 6 }), 1)).toThrow(/tall/);
  });

  it('rejects empty batches and nonsense numbers', () => {
    expect(() => planLabelBatch(grid(), 0)).toThrow(LabelLayoutError);
    expect(() => planLabelBatch(grid({ columns: 0 }), 1)).toThrow(LabelLayoutError);
    expect(() => planLabelBatch(grid({ gutterX: -1 }), 1)).toThrow(LabelLayoutError);
    expect(() => planLabelBatch({ kind: 'one-per-page', pageSize: { width: 1, height: 1, unit: 'mm' } }, 1)).toThrow(
      LabelLayoutError,
    );
  });
});

describe('composeLabelSheets', () => {
  const cell = (n: number, designed?: { widthMm: number; heightMm: number }) => ({
    html: `<p>cell-${n}</p>`,
    css: '.same{color:#000}',
    designedSizeMm: designed ?? null,
  });

  it('keeps input order, emits the @page rule and dedupes shared css', () => {
    const { html } = composeLabelSheets([cell(0), cell(1), cell(2)], grid());
    expect(html).toContain('@page { size: 215.9mm 279.4mm; margin: 0; }');
    expect(html.indexOf('cell-0')).toBeLessThan(html.indexOf('cell-1'));
    expect(html.indexOf('cell-1')).toBeLessThan(html.indexOf('cell-2'));
    expect(html.match(/\.same\{color:#000\}/g)).toHaveLength(1);
  });

  it('adds no padding of its own: the rendered markup already carries the template margin', () => {
    const { html } = composeLabelSheets([cell(0)], grid());
    expect(html).toMatch(/<div class="label-cell"[^>]*style="[^"]*"/);
    expect(html).not.toMatch(/class="label-cell"[^>]*padding/);
  });

  it('refuses a template designed for a bigger label than its cell', () => {
    expect(() => composeLabelSheets([cell(0, { widthMm: 101.6, heightMm: 50.8 })], grid({ labelWidth: 2.625, labelHeight: 1 }))).toThrow(
      /designed for/,
    );
  });
});

describe('assertCanonicalLabelUrl', () => {
  const base: LabelViewModel = {
    labelClass: 'ticket-work-tag',
    entityType: 'ticket',
    recordId: 'abc',
    url: recordUrl('ticket', 'abc', 'https://psa.example.com'),
    identifier: 'T-1',
    code128Value: null,
    title: null,
    clientName: null,
    detail: null,
    secondaryIdentifier: null,
    serialSuffix: null,
  };

  it('accepts the canonical recordUrl', () => {
    expect(() => assertCanonicalLabelUrl(base)).not.toThrow();
  });

  it.each([
    ['a query token', `${base.url}?token=secret`],
    ['a fragment', `${base.url}#x`],
    ['another record', recordUrl('ticket', 'zzz', 'https://psa.example.com')],
    ['another type', recordUrl('asset', 'abc', 'https://psa.example.com')],
    ['not a URL', '/msp/tickets/abc'],
  ])('rejects %s', (_name, url) => {
    expect(() => assertCanonicalLabelUrl({ ...base, url })).toThrow(LabelRenderError);
  });
});
