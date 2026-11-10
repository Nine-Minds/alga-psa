import { describe, expect, it } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

import { LabelRenderError, renderLabelBatchHtml, type LabelPrintItem } from './renderLabelBatchHtml';
import {
  STANDARD_LABEL_ASSET_CODE,
  STANDARD_LABEL_ASSET_CODE128_CODE,
  STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_A4_CODE,
  STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
  STANDARD_LABEL_TICKET_WORK_TAG_CODE,
  getStandardLabelTemplateAstByCode,
} from '../label-template-ast/standardTemplates';

const BASE = 'https://psa.example.com';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RMM_TAG = 'levelio:Z2lkOi8vbGV2ZWwvRGV2aWNlLzkwMDE'; // 39 chars, over the ~29-char Code 128 limit

const asset = (n: number, tag: string, templateCode = STANDARD_LABEL_ASSET_CODE128_CODE): LabelPrintItem => ({
  templateCode,
  viewModel: {
    labelClass: 'asset-identity',
    entityType: 'asset',
    recordId: uuid(n),
    url: recordUrl('asset', uuid(n), BASE),
    identifier: tag,
    code128Value: tag,
    title: `Laptop ${n}`,
    clientName: 'Emerald City Dental',
    detail: null,
    secondaryIdentifier: null,
    serialSuffix: null,
  } satisfies LabelViewModel,
});

const ONE_PER_PAGE = { kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } } as const;

async function failureOf(items: LabelPrintItem[]): Promise<LabelRenderError> {
  try {
    await renderLabelBatchHtml(items, ONE_PER_PAGE);
  } catch (error) {
    if (error instanceof LabelRenderError) return error;
    throw error;
  }
  throw new Error('expected the batch to be refused');
}

describe('renderLabelBatchHtml failures', () => {
  it('names EVERY record a Code 128 batch cannot print, with the QR-only template as the way out', async () => {
    const error = await failureOf([asset(1, RMM_TAG), asset(2, 'WL-WS-001'), asset(3, `${RMM_TAG}X`)]);
    expect(error.failures.map((f) => [f.index, f.recordId, f.identifier])).toEqual([
      [0, uuid(1), RMM_TAG],
      [2, uuid(3), `${RMM_TAG}X`],
    ]);
    for (const failure of error.failures) {
      expect(failure.templateCode).toBe(STANDARD_LABEL_ASSET_CODE128_CODE);
      expect(failure.suggestedTemplateCode).toBe(STANDARD_LABEL_ASSET_CODE);
      expect(failure.message).toMatch(/below the 0\.25 mm minimum/);
    }
    expect(error.message).toMatch(/^2 of 3 labels cannot be printed, so none were\./);
    expect(error.message).toContain(RMM_TAG);
    expect(error.message).toMatch(/Print them with standard-asset-label instead\.$/);
  });

  describe('ticket worksheet rendering', () => {
    const recordId = uuid(42);
    const viewModel: LabelViewModel = {
      labelClass: 'ticket-work-tag',
      entityType: 'ticket',
      recordId,
      url: recordUrl('ticket', recordId, BASE),
      identifier: 'TIC-42',
      code128Value: null,
      title: 'Laptop',
      clientName: 'Client',
      detail: 'Hardware',
      secondaryIdentifier: 'ASSET-123',
      serialSuffix: null,
      assetSerialNumber: '1234567',
      ticketDescription: 'First paragraph\nSecond <paragraph>',
      linkedAsset: {
        assetId: uuid(43),
        name: 'Customer desktop',
        manufacturer: 'Example make',
        model: 'Example model',
        osLine: 'Example OS',
        cpuLine: 'Example CPU',
        ramLine: '16 GB',
        storageLine: '512 GB SSD',
      },
    };
    const letter = { kind: 'one-per-page', pageSize: { width: 8.5, height: 11, unit: 'in' } } as const;

    it('renders the complete short serial, unprefixed asset tag and multiline ticket description', async () => {
      const { html } = await renderLabelBatchHtml(
        [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE, viewModel }],
        letter,
      );
      const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
      expect(body).toContain('ASSET-123');
      expect(body).not.toContain('Asset ASSET-123');
      expect(body).toContain('1234567');
      expect(body).toContain('First paragraph\nSecond &lt;paragraph&gt;');
      expect(body).toContain('white-space:pre-line');
      // Scoped to the body because the head carries base64 font data that can contain "S/N".
      expect(body).not.toContain('S/N');
    });

    it('renders structured ticket descriptions with rich formatting', async () => {
      const richText = [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First paragraph with ', styles: {} },
            { type: 'text', text: 'emphasis', styles: { bold: true } },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph', styles: { italic: true } }],
        },
      ];
      for (const content of [richText, JSON.stringify(richText)]) {
        const { html } = await renderLabelBatchHtml(
          [{
            templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
            viewModel: { ...viewModel, ticketDescriptionRichText: content },
          }],
          letter,
        );
        const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
        expect(body).toContain('<strong>emphasis</strong>');
        expect(body).toContain('<em>Second paragraph</em>');
        expect(body).toContain('First paragraph with');
      }
    });

    it('renders ProseMirror descriptions and escapes unsafe content', async () => {
      const richText = {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Important', marks: [{ type: 'bold' }] },
            { type: 'text', text: '<script>alert(1)</script>' },
            { type: 'text', text: 'unsafe link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        }],
      };
      for (const content of [richText, JSON.stringify(richText)]) {
        const { html } = await renderLabelBatchHtml(
          [{
            templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
            viewModel: { ...viewModel, ticketDescriptionRichText: content },
          }],
          letter,
        );
        const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
        expect(body).toContain('<strong>Important</strong>');
        expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(body).not.toContain('<script>');
        expect(body).not.toContain('javascript:');
      }
    });

    it('preserves the ticket description table, headings and completed checklist entries', async () => {
      const content = [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Setup Requirements' }] },
        { type: 'table', content: { type: 'tableContent', rows: [
          { cells: [
            { type: 'tableCell', content: [{ type: 'text', text: 'Data Transfer' }] },
            { type: 'tableCell', content: [{ type: 'text', text: '50gb' }] },
          ] },
        ] } },
        { type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'Wi-Fi' }] },
      ];
      const { html } = await renderLabelBatchHtml([{
        templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
        viewModel: { ...viewModel, ticketDescriptionRichText: JSON.stringify(content) },
      }], letter);
      expect(html).toContain('<h2>Setup Requirements</h2>');
      expect(html).toMatch(/<td\b[^>]*>Data Transfer<\/td>/);
      expect(html).toMatch(/<td\b[^>]*>50gb<\/td>/);
      expect(html).toContain('<s>Wi-Fi</s>');
    });

    it('marks worksheet cells as full-page flow sections so long descriptions paginate', async () => {
      const { html } = await renderLabelBatchHtml(
        [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE, viewModel }],
        letter,
      );
      expect(html).toContain('label-sheet label-sheet-flow');
      expect(html).toContain('label-cell label-cell-flow');
      expect(html).toContain('data-flow="true"');
      // A short worksheet still frames one full page: the flow root carries a page-tall minHeight.
      expect(html).toContain('min-height:11in');
    });

    it('renders the standard worksheet headings in the selected locale', async () => {
      const { html } = await renderLabelBatchHtml(
        [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE, viewModel }],
        letter,
        { locale: 'fr' },
      );
      expect(html).toContain('Caractéristiques de l&#x27;actif');
      expect(html).toContain('Détails du ticket');
      expect(html).toContain('Lieu de garde');
      expect(html).toContain('Fabricant');
      expect(html).toContain('Modèle');
      expect(html).toContain('Processeur');
      expect(html).toContain('Mémoire vive');
      expect(html).toContain('Stockage');
      expect(html).toContain('Customer desktop');
      expect(html).toContain('Example make');
      expect(html).toContain('Example model');
      expect(html).toContain('Example CPU');
      expect(html).toContain('16 GB');
      expect(html).toContain('512 GB SSD');
      expect(html).not.toContain('Asset Specifications');
    });

    it('keeps specification labels available when no asset was selected', async () => {
      const { html } = await renderLabelBatchHtml(
        [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE, viewModel: { ...viewModel, linkedAsset: null } }],
        letter,
      );
      for (const id of ['spec-name', 'spec-make', 'spec-model', 'spec-os', 'spec-cpu', 'spec-ram', 'spec-storage']) {
        expect(html).toContain(`id="${id}"`);
      }
      expect(html).toContain('Operating system');
      expect(html).toContain('CPU');
      expect(html).toContain('RAM');
      expect(html).toContain('Storage');
      expect(html).not.toContain('Customer desktop');
    });

    it.each([
      ['en', 1, '1 core'],
      ['en', 8, '8 cores'],
      ['fr', 1, '1 cœur'],
      ['fr', 8, '8 cœurs'],
      ['pl', 2, '2 rdzenie'],
      ['pl', 5, '5 rdzeni'],
    ] as const)('translates a %s CPU core count of %i', async (locale, count, expected) => {
      const { t } = await getServerTranslation(locale, 'documents');
      expect(t('labels.worksheet.cpuCoreCount', {
        count,
        defaultValue: count === 1 ? '{{count}} core' : '{{count}} cores',
      })).toBe(expected);
    });

    it('does not expose worksheet-only data on a normal tag, even through custom bindings', async () => {
      const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_WORK_TAG_CODE)!;
      if (!ast.layout.children) throw new Error('The work tag has no layout children');
      ast.layout.children.push({
        id: 'private-test-field',
        type: 'text',
        content: { type: 'binding', bindingId: 'ticketDescription' },
      });
      ast.layout.children.push({
        id: 'private-rich-test-field',
        type: 'richText',
        content: { type: 'binding', bindingId: 'ticketDescriptionRichText' },
      });
      ast.layout.children.push({
        id: 'serial-test-field',
        type: 'text',
        content: { type: 'binding', bindingId: 'assetSerialNumber' },
      });
      const { html } = await renderLabelBatchHtml([{
        templateAst: ast,
        viewModel: {
          ...viewModel,
          ticketDescriptionRichText: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private rich description' }] }],
        },
      }], ONE_PER_PAGE);
      expect(html).not.toContain('1234567');
      expect(html).not.toContain('First paragraph');
      expect(html).not.toContain('Private rich description');
    });

    it('treats a worksheet template resized to a tag page as a tag, and refuses a 4 x 2 output layout', async () => {
      const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE)!;
      ast.metadata!.printSettings!.customPageSize = { width: 4, height: 2, unit: 'in' };
      // The page size is the only worksheet gate: on a tag page the template prints as a tag, and the
      // worksheet-only bindings render nothing (the model nulls them outside worksheet mode).
      const { html } = await renderLabelBatchHtml([{ templateAst: ast, viewModel }], ONE_PER_PAGE);
      expect(html).not.toContain('1234567');
      const letterAst = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE)!;
      await expect(renderLabelBatchHtml([{ templateAst: letterAst, viewModel }], ONE_PER_PAGE))
        .rejects.toMatchObject({
          failures: [expect.objectContaining({ errorCode: 'worksheetPageSize' })],
        });
    });

    it('prints an A4 worksheet on A4 paper and refuses it on Letter', async () => {
      const a4Layout = { kind: 'one-per-page', pageSize: { width: 210, height: 297, unit: 'mm' } } as const;
      const { html } = await renderLabelBatchHtml(
        [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_A4_CODE, viewModel }],
        a4Layout,
      );
      expect(html).toContain('1234567');
      expect(html).toContain('Ticket Details');
      await expect(renderLabelBatchHtml(
        [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_A4_CODE, viewModel }],
        letter,
      )).rejects.toMatchObject({
        failures: [expect.objectContaining({ errorCode: 'worksheetPageSize' })],
      });
    });

    it('rejects a landscape or square output cell even when it is large enough', async () => {
      for (const width of [11, 12]) {
        await expect(renderLabelBatchHtml(
          [{ templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE, viewModel }],
          { kind: 'one-per-page', pageSize: { width, height: 11, unit: 'in' } },
        )).rejects.toMatchObject({
          failures: [expect.objectContaining({ errorCode: 'worksheetPageSize' })],
        });
      }
    });

    it('uses preset Letter dimensions when a custom worksheet does not declare a custom size', async () => {
      const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE)!;
      delete ast.metadata!.printSettings!.customPageSize;
      await expect(renderLabelBatchHtml([{ templateAst: ast, viewModel }], ONE_PER_PAGE))
        .rejects.toMatchObject({
          failures: [expect.objectContaining({ errorCode: 'worksheetPageSize' })],
        });
      const { html } = await renderLabelBatchHtml([{ templateAst: ast, viewModel }], letter);
      expect(html).toContain('1234567');
    });
  });

  it('the suggested QR-only template prints the same records', async () => {
    const { html } = await renderLabelBatchHtml(
      [asset(1, RMM_TAG, STANDARD_LABEL_ASSET_CODE), asset(3, `${RMM_TAG}X`, STANDARD_LABEL_ASSET_CODE)],
      ONE_PER_PAGE
    );
    expect(html).toContain(RMM_TAG);
  });

  it('does not suggest another template when switching would not help', async () => {
    const item = asset(1, 'WL-WS-001');
    const error = await failureOf([{ ...item, viewModel: { ...item.viewModel, url: `${item.viewModel.url}?token=x` } }]);
    expect(error.failures).toHaveLength(1);
    expect(error.failures[0].suggestedTemplateCode).toBeUndefined();
    expect(error.message).toMatch(/canonical record URL/);
  });
});
