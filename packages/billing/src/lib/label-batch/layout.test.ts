import { describe, expect, it } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

import { composeLabelSheets } from './composeLabelSheets';
import {
  LabelLayoutError,
  planLabelBatch,
  resolveCommonTemplatePageSize,
  resolveLabelBatchPdfOptions,
  type GridLayout,
} from './layout';
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

describe('resolveCommonTemplatePageSize', () => {
  it('returns the size a thermal label template declares (62 x 80 mm, 29 x 90 mm)', () => {
    const brother = { width: 62, height: 80, unit: 'mm' } as const;
    expect(resolveCommonTemplatePageSize([brother])).toEqual(brother);
    expect(resolveCommonTemplatePageSize([brother, { ...brother }])).toEqual(brother);
    const small = { width: 29, height: 90, unit: 'mm' } as const;
    expect(resolveCommonTemplatePageSize([small, small])).toEqual(small);
  });

  it('agrees across units within 0.01 mm (4 x 2 in is 101.6 x 50.8 mm)', () => {
    const inches = { width: 4, height: 2, unit: 'in' } as const;
    expect(resolveCommonTemplatePageSize([inches, { width: 101.6, height: 50.8, unit: 'mm' }])).toEqual(inches);
    expect(resolveCommonTemplatePageSize([inches, { width: 101.62, height: 50.8, unit: 'mm' }])).toBeNull();
  });

  it('is null when the templates disagree, when one declares no size, and when none is declared', () => {
    const brother = { width: 62, height: 80, unit: 'mm' } as const;
    expect(resolveCommonTemplatePageSize([brother, { width: 62, height: 100, unit: 'mm' }])).toBeNull();
    expect(resolveCommonTemplatePageSize([brother, undefined])).toBeNull();
    expect(resolveCommonTemplatePageSize([brother, null])).toBeNull();
    expect(resolveCommonTemplatePageSize([])).toBeNull();
  });

  it('is null for a size outside the 10 - 1200 mm range or of the wrong shape', () => {
    expect(resolveCommonTemplatePageSize([{ width: 9, height: 80, unit: 'mm' }])).toBeNull();
    expect(resolveCommonTemplatePageSize([{ width: 62, height: 1300, unit: 'mm' }])).toBeNull();
    expect(resolveCommonTemplatePageSize([{ width: 62, height: 80, unit: 'cm' } as never])).toBeNull();
    expect(resolveCommonTemplatePageSize([{ width: Number.NaN, height: 80, unit: 'mm' }])).toBeNull();
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

  it('refuses a template designed for a bigger label than its cell, with a code the dialog can read', () => {
    const tooSmall = () =>
      composeLabelSheets([cell(0, { widthMm: 101.6, heightMm: 50.8 })], grid({ labelWidth: 2.625, labelHeight: 1 }));
    expect(tooSmall).toThrow(/designed for/);
    try {
      tooSmall();
    } catch (error) {
      expect((error as LabelLayoutError).code).toBe('template-size-mismatch');
    }
  });

  it('accepts a 62 x 80 mm template on a page of its own declared size', () => {
    const { geometry } = composeLabelSheets(
      [cell(0, { widthMm: 62, heightMm: 80 })],
      { kind: 'one-per-page', pageSize: { width: 62, height: 80, unit: 'mm' } },
    );
    expect([geometry.pageWidthMm, geometry.pageHeightMm]).toEqual([62, 80]);
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
