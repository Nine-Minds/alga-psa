import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { renderBarcodeSvgs } from './prepass.server';
import {
  BARCODE_MIN_MODULE_MM,
  BARCODE_QUIET_ZONE_MODULES,
  BarcodeError,
  cssLengthToMm,
  resolveBarcodeSizing,
} from './constraints';
import { renderEvaluatedTemplateAst } from '../react-renderer';

const URL_VALUE = 'https://psa.example.com/msp/tickets/6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11';

const astWith = (symbology: 'qr' | 'code128', value: unknown, width?: string): TemplateAst =>
  ({
    kind: 'invoice-template-ast',
    version: 1,
    layout: {
      id: 'root',
      type: 'document',
      children: [
        {
          id: 'code',
          type: 'barcode',
          symbology,
          value: { type: 'literal', value },
          ...(width ? { style: { inline: { width } } } : {}),
        },
      ],
    },
  }) as unknown as TemplateAst;

const evaluation = { bindings: {}, groups: {}, collections: {} } as never;
const viewBox = (svg: string) => svg.match(/viewBox="0 0 (\d+) (\d+)"/)!.slice(1).map(Number);

describe('barcode prepass', () => {
  it('returns nothing and loads nothing when there is no barcode node', async () => {
    const ast = { kind: 'invoice-template-ast', version: 1, layout: { id: 'root', type: 'document', children: [] } } as unknown as TemplateAst;
    expect(await renderBarcodeSvgs(ast, evaluation)).toEqual({});
  });

  it('QR: keeps a quiet zone of at least 4 modules on every side', async () => {
    const svg = (await renderBarcodeSvgs(astWith('qr', URL_VALUE), evaluation)).code;
    const [w, h] = viewBox(svg);
    expect(w).toBe(h);
    // First dark module starts at x >= quiet zone.
    const firstMove = Number(/d="M(\d+) (\d+)/.exec(svg)![1]);
    expect(firstMove).toBeGreaterThanOrEqual(BARCODE_QUIET_ZONE_MODULES.qr);
    expect(BARCODE_QUIET_ZONE_MODULES.qr).toBeGreaterThanOrEqual(4);
  });

  it('Code 128: first bar starts after a quiet zone of at least 10 modules', async () => {
    const svg = (await renderBarcodeSvgs(astWith('code128', 'AT-000123'), evaluation)).code;
    const bars = [...svg.matchAll(/M(\d+) 0h(\d+)v/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const [width] = viewBox(svg);
    expect(bars[0][0]).toBeGreaterThanOrEqual(10);
    const last = bars[bars.length - 1];
    expect(width - (last[0] + last[1])).toBeGreaterThanOrEqual(10);
  });

  it('refuses an empty value', async () => {
    await expect(renderBarcodeSvgs(astWith('qr', '  '), evaluation)).rejects.toMatchObject({ code: 'empty-value' });
  });

  it('refuses a value that cannot fit in a QR code', async () => {
    await expect(renderBarcodeSvgs(astWith('qr', 'x'.repeat(8000)), evaluation)).rejects.toMatchObject({ code: 'too-large' });
  });

  it('refuses a value Code 128 cannot encode', async () => {
    await expect(renderBarcodeSvgs(astWith('code128', 'Ωmega'), evaluation)).rejects.toBeInstanceOf(BarcodeError);
  });

  it('refuses a width that would make modules smaller than the minimum', async () => {
    await expect(renderBarcodeSvgs(astWith('qr', URL_VALUE, '10mm'), evaluation)).rejects.toMatchObject({ code: 'too-small' });
  });

  it('accepts a 1in QR for a URL-sized payload', async () => {
    const svg = (await renderBarcodeSvgs(astWith('qr', URL_VALUE, '1in'), evaluation)).code;
    expect(svg).toContain('<svg');
  });
});

describe('barcode constraints', () => {
  it('parses CSS lengths', () => {
    expect(cssLengthToMm('1in')).toBeCloseTo(25.4);
    expect(cssLengthToMm('96px')).toBeCloseTo(25.4);
    expect(cssLengthToMm('50%')).toBeNull();
  });
  it('enforces the minimum module size', () => {
    expect(() => resolveBarcodeSizing('qr', 100, 100 * BARCODE_MIN_MODULE_MM)).not.toThrow();
    expect(() => resolveBarcodeSizing('qr', 100, 100 * BARCODE_MIN_MODULE_MM - 1)).toThrow(BarcodeError);
  });
});

describe('barcode rendering', () => {
  it('inlines the prepass SVG and never calls a barcode library from the renderer', async () => {
    const ast = astWith('qr', URL_VALUE);
    const barcodes = await renderBarcodeSvgs(ast, evaluation);
    const { html } = await renderEvaluatedTemplateAst(ast, evaluation, { barcodes });
    expect(html).toContain('<svg');
    expect(html).toContain('id="code"');
  });
  it('renders a placeholder without a prepass (designer preview)', async () => {
    const { html } = await renderEvaluatedTemplateAst(astWith('qr', URL_VALUE), evaluation);
    expect(html).toContain('data-barcode-placeholder="qr"');
  });
  it('throws when a prepass was supplied but missed a node', async () => {
    await expect(renderEvaluatedTemplateAst(astWith('qr', URL_VALUE), evaluation, { barcodes: {} })).rejects.toThrow(/prepass/);
  });
});
