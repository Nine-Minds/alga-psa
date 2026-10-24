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

const astWith = (symbology: 'qr' | 'code128', value: unknown, width?: string, height?: string): TemplateAst =>
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
          ...(width || height ? { style: { inline: { ...(width ? { width } : {}), ...(height ? { height } : {}) } } } : {}),
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

describe('barcode height (1D)', () => {
  const attr = (svg: string, name: string) => svg.match(new RegExp(`<svg[^>]* ${name}="([^"]*)"`))![1];

  it('Code 128 emits the declared mm height, stretches vertically only and never squeezes', async () => {
    const svg = (await renderBarcodeSvgs(astWith('code128', 'AT-000123', '60mm', '9mm'), evaluation)).code;
    expect(attr(svg, 'height')).toBe('9mm');
    expect(attr(svg, 'width')).toBe('60mm');
    expect(attr(svg, 'preserveAspectRatio')).toBe('none');
    expect(svg).not.toContain('height:auto');
    expect(svg).not.toContain('max-width');
  });

  it('module width does not depend on the height', async () => {
    const tall = (await renderBarcodeSvgs(astWith('code128', 'AT-000123', '60mm', '20mm'), evaluation)).code;
    const short = (await renderBarcodeSvgs(astWith('code128', 'AT-000123', '60mm', '5mm'), evaluation)).code;
    const natural = (await renderBarcodeSvgs(astWith('code128', 'AT-000123', '60mm'), evaluation)).code;
    const modulesAcross = (svg: string) => viewBox(svg)[0];
    expect(modulesAcross(tall)).toBe(modulesAcross(short));
    expect(modulesAcross(tall)).toBe(modulesAcross(natural));
    expect(attr(tall, 'width')).toBe(attr(short, 'width'));
  });

  it('without a declared height falls back to the module-ratio height', async () => {
    const svg = (await renderBarcodeSvgs(astWith('code128', 'AT-000123', '60mm'), evaluation)).code;
    const [w, h] = viewBox(svg);
    expect(attr(svg, 'height')).toBe(`${+((60 * h) / w).toFixed(3)}mm`);
    expect(svg).not.toContain('preserveAspectRatio');
  });

  it('still refuses a Code 128 narrower than the minimum module, whatever the height', async () => {
    await expect(renderBarcodeSvgs(astWith('code128', 'REVIEW-NINJA-WS01', '40mm', '9mm'), evaluation)).rejects.toMatchObject({
      code: 'too-small',
    });
  });

  it('QR ignores a declared height: square, uniform scaling, never preserveAspectRatio none', async () => {
    const svg = (await renderBarcodeSvgs(astWith('qr', URL_VALUE, '1in', '5mm'), evaluation)).code;
    expect(attr(svg, 'width')).toBe(attr(svg, 'height'));
    expect(svg).not.toContain('preserveAspectRatio');
    expect(svg).toContain('max-width:100%;height:auto');
  });
});
