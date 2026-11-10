import { describe, expect, it, vi } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

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
    // The storage read is given the path only, never an origin a description could choose.
    expect(resolve).toHaveBeenCalledWith(`/api/documents/view/${FILE_A}?t=1`);
    expect(resolve.mock.calls.every(([url]) => url.startsWith('/api/documents/view/'))).toBe(true);
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
