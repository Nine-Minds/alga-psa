/**
 * Every server-generated PDF must carry its own fonts.
 *
 * The HTML is pushed into Chromium with page.setContent(), so there is no origin
 * to fetch a font from, and the server image ships no Inter: before the bundled
 * faces were inlined, the default stacks fell through fontconfig to FreeSans,
 * which Chromium embeds as Type 3 glyph outlines that print badly — and to a
 * different face on macOS, in CI and on self-hosted Debian. These renders go all
 * the way to a PDF and read back the font dictionaries with poppler's
 * `pdffonts`, so a regression in the @font-face injection or in the default
 * stacks is caught as what it is.
 *
 * Needs a Chromium Puppeteer can launch (PUPPETEER_EXECUTABLE_PATH or its own
 * download) and `pdffonts` (poppler) on PATH. Both are required: this suite
 * fails, not skips, when they are absent.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => ({
    table: (name: string) => ({
      where: () => ({
        first: async () =>
          name === 'document_content' ? { content: '# Heading\n\nBody text with `inline code`.' } : undefined,
      }),
    }),
  }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));

import { browserPoolService } from './browserPoolService';
import { renderHtmlToPdf } from './labelPdfService';
import { PDFGenerationService } from './pdfGenerationService';
import { evaluateTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { INVOICE_TEMPLATE_BINDING_ALIASES } from '../lib/invoice-template-ast/bindingAliases';
import { renderTemplateAstHtmlDocument } from '../lib/invoice-template-ast/server-render';
import { resolvePdfPrintOptionsFromAst } from '../lib/invoice-template-ast/printSettings';
import {
  STANDARD_INVOICE_DEFAULT_CODE,
  getStandardTemplateAstByCode,
} from '../lib/invoice-template-ast/standardTemplates';
import {
  STANDARD_QUOTE_DEFAULT_CODE,
  getStandardQuoteTemplateAstByCode,
} from '../lib/quote-template-ast/standardTemplates';
import { renderLabelBatchHtml, type LabelPrintItem } from '../lib/label-batch/renderLabelBatchHtml';
import type { LabelBatchLayout } from '../lib/label-batch/layout';
import { INVOICE_PREVIEW_SAMPLE_SCENARIOS } from '../components/invoice-designer/preview/sampleScenarios';
import { QUOTE_PREVIEW_SAMPLE_SCENARIOS } from '../components/invoice-designer/preview/quoteSampleScenarios';

const workDir = mkdtempSync(path.join(tmpdir(), 'pdf-fonts-e2e-'));
afterAll(async () => {
  rmSync(workDir, { recursive: true, force: true });
  await browserPoolService.cleanup();
});

interface EmbeddedFont {
  name: string;
  type: string;
  embedded: boolean;
  subset: boolean;
}

/**
 * The PDF's font dictionaries, read with poppler rather than a PDF parser: the
 * server unit config (which runs this suite in CI) aliases `pdf-lib` to an empty
 * module, and `pdffonts` ships with the `pdfinfo`/`pdftoppm` the label suite
 * already requires. Columns are sliced from the widths of the header rule, so a
 * type with a space in it ("CID TrueType") stays one field.
 */
function embeddedFonts(pdf: Buffer, name: string): EmbeddedFont[] {
  const pdfPath = path.join(workDir, `${name}.pdf`);
  writeFileSync(pdfPath, pdf);
  const lines = execFileSync('pdffonts', [pdfPath], { encoding: 'utf8' }).split('\n');
  const ruleIndex = lines.findIndex((line) => /^-{3,}/.test(line));
  if (ruleIndex < 0) return [];

  const spans: Array<[number, number]> = [];
  const rule = lines[ruleIndex];
  for (const match of rule.matchAll(/-+/g)) {
    spans.push([match.index!, match.index! + match[0].length]);
  }
  const field = (line: string, column: number) => line.slice(spans[column][0], spans[column][1]).trim();

  return lines
    .slice(ruleIndex + 1)
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      name: field(line, 0),
      type: field(line, 1),
      embedded: field(line, 3) === 'yes',
      subset: field(line, 4) === 'yes',
    }));
}

/** What every PDF this app prints must be true of, whatever it renders. */
function expectBundledFontsOnly(fonts: EmbeddedFont[], label: string) {
  expect(fonts.length, `${label}: no fonts at all`).toBeGreaterThan(0);
  for (const font of fonts) {
    expect(font.embedded, `${label}: ${font.name} is not embedded`).toBe(true);
    // Type 3 is the Type-1/CFF fallback path (FreeSans) that printed badly.
    expect(font.type, `${label}: ${font.name} is a Type 3 font`).not.toMatch(/Type 3/i);
    expect(font.type, `${label}: ${font.name} is not a TrueType face`).toMatch(/TrueType/i);
    expect(font.name, `${label}: ${font.name} is not a bundled font`).toMatch(/Inter|JetBrains/i);
  }
}

const hasFamily = (fonts: EmbeddedFont[], pattern: RegExp) => fonts.some((font) => pattern.test(font.name));

async function printTemplate(
  code: 'invoice' | 'quote',
  name: string
): Promise<{ pdf: Buffer; fonts: EmbeddedFont[]; html: string }> {
  const ast =
    code === 'invoice'
      ? getStandardTemplateAstByCode(STANDARD_INVOICE_DEFAULT_CODE)!
      : getStandardQuoteTemplateAstByCode(STANDARD_QUOTE_DEFAULT_CODE)!;
  const data = (
    code === 'invoice' ? INVOICE_PREVIEW_SAMPLE_SCENARIOS[0].data : QUOTE_PREVIEW_SAMPLE_SCENARIOS[0].data
  ) as unknown as Record<string, unknown>;
  const evaluation = evaluateTemplateAst(
    ast,
    data,
    code === 'invoice' ? { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES } : undefined
  );
  const html = await renderTemplateAstHtmlDocument(ast, evaluation, { title: name, locale: 'en' });
  const pdf = await renderHtmlToPdf(html, resolvePdfPrintOptionsFromAst(ast));
  return { pdf, fonts: embeddedFonts(pdf, name), html };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const assetLabel = (n: number): LabelPrintItem => ({
  viewModel: {
    labelClass: 'asset-identity',
    entityType: 'asset',
    recordId: uuid(n),
    url: recordUrl('asset', uuid(n), 'https://psa.example.com'),
    identifier: `AT-${String(100 + n).padStart(6, '0')}`,
    code128Value: null,
    title: `Laptop ${n}`,
    clientName: 'Emerald City Dental',
    detail: null,
    secondaryIdentifier: null,
    serialSuffix: 'SN12345678',
  } satisfies LabelViewModel,
});

const ONE_PER_PAGE: LabelBatchLayout = { kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } };

describe('bundled fonts are embedded in every generated PDF', () => {
  it('prints a standard invoice in Inter, with nothing from the system stack', async () => {
    const { pdf, fonts, html } = await printTemplate('invoice', 'invoice');

    expect(html).toContain('@font-face');
    expectBundledFontsOnly(fonts, 'invoice');
    expect(hasFamily(fonts, /Inter/i), `invoice fonts: ${fonts.map((f) => f.name).join(', ')}`).toBe(true);
    expect(fonts.every((font) => font.subset)).toBe(true);
    // Chromium subsets what it embeds, so a one-page invoice lands around 25 KB
    // even though the inlined woff2 payloads are ~500 KB of source.
    expect(pdf.byteLength).toBeLessThan(150 * 1024);
  }, 120_000);

  it('prints a standard quote in Inter', async () => {
    const { fonts } = await printTemplate('quote', 'quote');

    expectBundledFontsOnly(fonts, 'quote');
    expect(hasFamily(fonts, /Inter/i), `quote fonts: ${fonts.map((f) => f.name).join(', ')}`).toBe(true);
  }, 120_000);

  it('prints a label batch in Inter with its identifiers in JetBrains Mono', async () => {
    const { html, printOptions } = await renderLabelBatchHtml([assetLabel(1), assetLabel(2)], ONE_PER_PAGE, {
      tenantClient: { name: 'Example MSP', logoUrl: null },
    });
    const pdf = await renderHtmlToPdf(html, printOptions);
    const fonts = embeddedFonts(pdf, 'labels');

    expect(html).toContain('@font-face');
    expectBundledFontsOnly(fonts, 'labels');
    const names = fonts.map((font) => font.name).join(', ');
    expect(hasFamily(fonts, /Inter/i), `label fonts: ${names}`).toBe(true);
    expect(hasFamily(fonts, /JetBrains/i), `label fonts: ${names}`).toBe(true);
  }, 120_000);

  it('prints an exported document in Inter with its code spans in JetBrains Mono', async () => {
    const service = new PDFGenerationService('tenant-1');
    (service as any).getDocumentRecord = async () => ({
      document_id: 'doc-1',
      document_name: 'Runbook',
      mime_type: 'text/markdown',
      tenant: 'tenant-1',
    });
    const html: string = await (service as any).getDocumentHtml('doc-1');
    const pdf = await renderHtmlToPdf(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    const fonts = embeddedFonts(pdf, 'document');

    expect(html).toContain('@font-face');
    expectBundledFontsOnly(fonts, 'document');
    const names = fonts.map((font) => font.name).join(', ');
    expect(hasFamily(fonts, /Inter/i), `document fonts: ${names}`).toBe(true);
    expect(hasFamily(fonts, /JetBrains/i), `document fonts: ${names}`).toBe(true);
  }, 120_000);
});
