import { describe, expect, it, vi } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

const loggerWarn = vi.fn();
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: (...args: any[]) => loggerWarn(...args) } }));

import { inlineWorksheetDescriptionImages } from './inlineWorksheetImages';
import { renderLabelBatchHtml, type LabelPrintItem } from './renderLabelBatchHtml';
import { STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE } from '../label-template-ast/standardTemplates';

const BASE = 'https://psa.example.com';
const FILE_A = '0b6f6a2e-1111-4111-8111-111111111111';
const FILE_B = '0b6f6a2e-2222-4222-8222-222222222222';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const recordId = '00000000-0000-4000-8000-000000000042';

const ticket = (ticketDescriptionRichText: unknown): LabelPrintItem => ({
  templateCode: STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
  viewModel: {
    labelClass: 'ticket-work-tag',
    entityType: 'ticket',
    recordId,
    url: recordUrl('ticket', recordId, BASE),
    identifier: 'TIC-42',
    code128Value: null,
    title: 'Laptop',
    clientName: 'Client',
    detail: null,
    secondaryIdentifier: null,
    serialSuffix: null,
    ticketDescription: 'Screenshot attached',
    ticketDescriptionRichText,
  } satisfies LabelViewModel,
});

const image = (url: string, name = '') => ({ type: 'image', props: { url, name, caption: '' } });
const marker = (name: string | null) => (name ? `[Image not included: ${name}]` : '[Image not included]');

describe('inlineWorksheetDescriptionImages', () => {
  it('inlines this tenant\'s document images, relative or absolute, and nested in list children', async () => {
    const resolve = vi.fn(async (url: string) => (url.includes(FILE_A) ? PNG : null));
    const blocks = [
      image(`/api/documents/view/${FILE_A}`),
      image(`${BASE}/api/documents/view/${FILE_A}?t=1`),
      { type: 'bulletListItem', content: [], children: [image(`/api/documents/view/${FILE_A}`)] },
    ];
    const { items, missingImages } = await inlineWorksheetDescriptionImages([ticket(blocks)], resolve, marker);

    expect(missingImages).toBe(0);
    const out = items[0].viewModel.ticketDescriptionRichText as Array<Record<string, any>>;
    expect(out[0].props.url).toBe(PNG);
    expect(out[1].props.url).toBe(PNG);
    expect(out[2].children[0].props.url).toBe(PNG);
    // Repeated URLs (including query-string variants) for one document are resolved once, path only.
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(`/api/documents/view/${FILE_A}`);
    expect(resolve.mock.calls.every(([url]) => url.startsWith('/api/documents/view/'))).toBe(true);
  });

  it('resolves one document id once across ticket descriptions in the same print batch', async () => {
    const resolve = vi.fn(async () => PNG);
    const { items, missingImages } = await inlineWorksheetDescriptionImages([
      ticket([image(`/api/documents/view/${FILE_A}?t=1`)]),
      {
        ...ticket([image(`/api/documents/view/${FILE_A}?t=2`)]),
        viewModel: { ...ticket([image(`/api/documents/view/${FILE_A}?t=2`)]).viewModel, recordId: 'other-ticket' },
      },
    ], resolve, marker);

    expect(missingImages).toBe(0);
    expect(resolve).toHaveBeenCalledOnce();
    for (const item of items) {
      expect((item.viewModel.ticketDescriptionRichText as Array<Record<string, any>>)[0].props.url).toBe(PNG);
    }
  });

  it('replaces an image it cannot inline with a visible, counted marker instead of dropping it', async () => {
    const resolve = vi.fn(async () => null);
    const nested = { type: 'paragraph', content: [{ type: 'text', text: 'kept child', styles: {} }] };
    const blocks = JSON.stringify([
      { ...image(`/api/documents/view/${FILE_B}`, 'other-tenant.png'), children: [nested] },
      image('/uploads/relative.png'),
    ]);
    const { items, missingImages } = await inlineWorksheetDescriptionImages([ticket(blocks)], resolve, marker);

    expect(missingImages).toBe(2);
    expect(items[0].viewModel.ticketDescriptionRichText).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: '[Image not included: other-tenant.png]', styles: { italic: true } }],
        children: [nested],
      },
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: '[Image not included]', styles: { italic: true } }],
        children: [],
      },
    ]);
  });

  it('leaves embedded and remote images, other blocks and plain text alone', async () => {
    const resolve = vi.fn(async () => PNG);
    const blocks = [image(PNG), image('https://cdn.example.com/a.png'), { type: 'paragraph', content: [] }];
    const plain = ticket('["see appendix"]');
    const { items, missingImages } = await inlineWorksheetDescriptionImages([ticket(blocks), plain, ticket(null)], resolve, marker);

    expect(missingImages).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
    expect(items[0].viewModel.ticketDescriptionRichText).toEqual(blocks);
    expect(items[1]).toBe(plain);
    expect(items[2].viewModel.ticketDescriptionRichText).toBeNull();
  });

  it('inlines images inside ProseMirror doc content (attrs.src) and table rows', async () => {
    const resolve = vi.fn(async (url: string) => (url.includes(FILE_A) ? PNG : null));
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: `/api/documents/view/${FILE_A}`, alt: 'screenshot.png' } }] },
        { type: 'table', content: { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'image', attrs: { src: `/api/documents/view/${FILE_B}`, alt: 'other.png' } }] },
        ] } },
      ],
    };
    const { items, missingImages } = await inlineWorksheetDescriptionImages([ticket(JSON.stringify(doc))], resolve, marker);

    expect(missingImages).toBe(1);
    const out = items[0].viewModel.ticketDescriptionRichText as Record<string, any>;
    expect(out.type).toBe('doc');
    expect(out.content[0].content[0].attrs.src).toBe(PNG);
    const cellImage = out.content[1].content.content[0].content[0];
    expect(cellImage.type).toBe('paragraph');
    expect(cellImage.content[0].text).toBe('[Image not included: other.png]');
  });

  it('logs a resolver failure with the tenant context instead of silently treating it as missing', async () => {
    const resolve = vi.fn(async () => { throw new Error('S3 unreachable'); });
    const { items, missingImages } = await inlineWorksheetDescriptionImages(
      [ticket([image(`/api/documents/view/${FILE_A}`, 'screenshot.png')])],
      resolve,
      marker,
      { tenant: 'tenant-1' }
    );

    expect(missingImages).toBe(1);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const [message, meta] = loggerWarn.mock.calls[0] as [string, Record<string, any>];
    expect(message).toContain('resolver failed');
    expect(meta.tenant).toBe('tenant-1');
    expect(meta.url).toBe(`/api/documents/view/${FILE_A}`);
    expect(meta.error).toBeInstanceOf(Error);
    const out = items[0].viewModel.ticketDescriptionRichText as Array<Record<string, any>>;
    expect(out[0].content[0].text).toBe('[Image not included: screenshot.png]');
  });

  it('prints the inlined image and the marker on the worksheet', async () => {
    const { items } = await inlineWorksheetDescriptionImages(
      [ticket([image(`/api/documents/view/${FILE_A}`), image(`/api/documents/view/${FILE_B}`, 'missing.png')])],
      async (url) => (url.includes(FILE_A) ? PNG : null),
      marker,
    );
    const { html } = await renderLabelBatchHtml(items, { kind: 'one-per-page', pageSize: { width: 8.5, height: 11, unit: 'in' } });
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    expect(body).toContain(`src="${PNG}"`);
    expect(body).toContain('[Image not included: missing.png]');
    expect(body).not.toContain('/api/documents/view/');
  });
});
