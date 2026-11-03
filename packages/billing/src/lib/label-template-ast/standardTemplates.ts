import type { LabelClass, TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildLabelTemplateBindings } from './bindings';

/**
 * One standard template per label class. Each renders ONE label cell sized for a 4 x 2 in
 * thermal label (`customPageSize`); the batch layer reuses the same cell for n-up sheets.
 * QR content is only the canonical record URL (binding `recordUrl`), never a token or secret.
 */
export const STANDARD_LABEL_TICKET_WORK_TAG_CODE = 'standard-ticket-work-tag';
export const STANDARD_LABEL_ASSET_CODE = 'standard-asset-label';
export const STANDARD_LABEL_ASSET_CODE128_CODE = 'standard-asset-label-code128';
export const STANDARD_LABEL_STOCK_UNIT_CODE = 'standard-stock-unit-label';
export const STANDARD_LABEL_STAGING_CONTAINER_CODE = 'standard-staging-container-label';
export const STANDARD_LABEL_RMA_CODE = 'standard-rma-label';

export const LABEL_STANDARD_CODE_BY_CLASS: Record<LabelClass, string> = {
  'ticket-work-tag': STANDARD_LABEL_TICKET_WORK_TAG_CODE,
  'asset-identity': STANDARD_LABEL_ASSET_CODE,
  'stock-unit-identity': STANDARD_LABEL_STOCK_UNIT_CODE,
  'staging-container': STANDARD_LABEL_STAGING_CONTAINER_CODE,
  'rma-work-tag': STANDARD_LABEL_RMA_CODE,
};

/** The label class a standard code prints (used to validate a requested code against a class). */
export const LABEL_CLASS_BY_STANDARD_CODE: Record<string, LabelClass> = {
  [STANDARD_LABEL_TICKET_WORK_TAG_CODE]: 'ticket-work-tag',
  [STANDARD_LABEL_ASSET_CODE]: 'asset-identity',
  [STANDARD_LABEL_ASSET_CODE128_CODE]: 'asset-identity',
  [STANDARD_LABEL_STOCK_UNIT_CODE]: 'stock-unit-identity',
  [STANDARD_LABEL_STAGING_CONTAINER_CODE]: 'staging-container',
  [STANDARD_LABEL_RMA_CODE]: 'rma-work-tag',
};

/**
 * Where a record that one template refuses can still print. The Code 128 asset label refuses tags longer
 * than ~29 characters (RMM-imported tags run to ~40); the QR-only asset label prints any tag.
 */
export const LABEL_FALLBACK_TEMPLATE_BY_CODE: Record<string, string> = {
  [STANDARD_LABEL_ASSET_CODE128_CODE]: STANDARD_LABEL_ASSET_CODE,
};

const cloneAst = (ast: TemplateAst): TemplateAst => JSON.parse(JSON.stringify(ast)) as TemplateAst;

type Node = Record<string, unknown>;

/**
 * A label is a fixed-size cell, so no text may run past its column: every line wraps at any character
 * (an RMM asset tag such as `levelio:Z2lkOi8v...` has no break opportunities), and a block capped with
 * `maxHeight` clips at the cap instead of spilling into the next line or off the label.
 */
const text = (id: string, bindingId: string, inline: Record<string, unknown>): Node => ({
  id,
  type: 'text',
  content: { type: 'binding', bindingId },
  style: {
    inline: {
      margin: '0',
      overflowWrap: 'anywhere',
      ...(inline.maxHeight ? { overflow: 'hidden' } : {}),
      ...inline,
    },
  },
});

const qr = (id: string, size: string): Node => ({
  id,
  type: 'barcode',
  symbology: 'qr',
  value: { type: 'binding', bindingId: 'recordUrl' },
  style: { inline: { width: size, height: size, flexShrink: '0' } },
});

const code128 = (id: string): Node => ({
  id,
  type: 'barcode',
  symbology: 'code128',
  value: { type: 'binding', bindingId: 'code128Value' },
  // Full-width row: 95 mm holds ~29 characters at the 0.25 mm minimum module (11 modules/char + 55).
  style: { inline: { width: '95mm', height: '9mm', flexShrink: '0' } },
});

/**
 * The issuer logo (inlined as a `data:` URL by the PDF service). It renders nothing when the tenant has no
 * logo or the logo could not be read, and it collapses the text brand line (`tenantBrandText`).
 */
const logo = (id: string, heightMm: number, extra: Record<string, unknown> = {}): Node => ({
  id,
  type: 'image',
  src: { type: 'binding', bindingId: 'tenantLogo' },
  alt: { type: 'binding', bindingId: 'tenantName' },
  style: {
    inline: {
      height: `${heightMm}mm`,
      maxWidth: '100%',
      objectFit: 'contain',
      objectPosition: 'left',
      flexShrink: '0',
      ...extra,
    },
  },
});

const brandLine = (): Node =>
  text('brand', 'tenantBrandText', { fontSize: '8px', lineHeight: 1.2, maxHeight: '9.6px', color: '#4b5563' });

/**
 * Printable area of the 4 x 2 in cell is 95.6 x 44.8 mm (marginMm 3). Without a footer the content is
 * one 44 mm row. With a footer (full-width Code 128) the layout is a 40 mm column: a 28 mm text+QR row,
 * 2 mm gap, the 9 mm footer, leaving ~5 mm of whitespace below the bars.
 */
const label = (name: string, left: Node[], right: Node[], footer: Node[] = [], textGap = '1mm'): TemplateAst => {
  const row: Node = {
    id: footer.length ? 'label-row' : 'label',
    type: 'stack',
    direction: 'row',
    style: {
      inline: {
        gap: '3mm',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: footer.length ? '28mm' : '44mm',
      },
    },
    children: [
      { id: 'label-text', type: 'stack', direction: 'column', style: { inline: { gap: textGap, flex: '1 1 0', minWidth: '0' } }, children: left },
      { id: 'label-code', type: 'stack', direction: 'column', style: { inline: { gap: '1mm', alignItems: 'center' } }, children: right },
    ],
  };
  const content: Node = footer.length
    ? {
        id: 'label',
        type: 'stack',
        direction: 'column',
        style: { inline: { gap: '2mm', height: '40mm' } },
        children: [row, ...footer],
      }
    : row;
  return {
    kind: 'invoice-template-ast',
    version: TEMPLATE_AST_VERSION,
    metadata: {
      templateName: name,
      printSettings: { paperPreset: 'Letter', marginMm: 3, customPageSize: { width: 4, height: 2, unit: 'in' } },
    },
    bindings: buildLabelTemplateBindings(),
    layout: { id: 'root', type: 'document', children: [content] },
  } as unknown as TemplateAst;
};

/**
 * Free text (names, titles, reasons) is capped at whole lines so a long value never pushes the label past
 * its 44 mm printable height. Identifiers are never capped: they wrap at any character (an RMM tag of 39
 * characters takes three lines at 22 px in the 58 mm text column) and the caps leave room for that.
 */
const lines = (count: number, fontPx: number, lineHeight: number) => ({
  fontSize: `${fontPx}px`,
  lineHeight,
  maxHeight: `${(count * fontPx * lineHeight).toFixed(1)}px`,
});

const identifier = (id: string, fontPx: number): Node =>
  text(id, 'identifier', { fontSize: `${fontPx}px`, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1.1 });

const buildTicketWorkTag = (): TemplateAst =>
  label(
    'Standard Ticket Work Tag',
    [
      brandLine(),
      text('client', 'clientName', { ...lines(1, 13, 1.15), fontWeight: 700 }),
      text('item', 'title', lines(2, 11, 1.2)),
      identifier('ticket-number', 20),
      text('reason', 'detail', { ...lines(1, 10, 1.2), color: '#374151' }),
      // Held client equipment (custody): one line each, collapsing when empty so a tag with no equipment is unchanged.
      text('custody-location', 'custodyLocation', { ...lines(1, 10, 1.2), fontWeight: 700 }),
      text('next-action', 'nextAction', { ...lines(1, 9, 1.2), color: '#374151' }),
      text('asset', 'assetLine', { fontSize: '10px', lineHeight: 1.2, fontFamily: 'monospace' }),
      text('serial', 'serialLine', { ...lines(1, 9, 1.2), color: '#4b5563', fontFamily: 'monospace' }),
    ],
    // Logo above the QR (like the asset label) so the worst-case text column keeps its full height.
    [logo('logo', 6, { objectPosition: 'center' }), qr('qr', '34mm')],
    [],
    '0.5mm',
  );

const buildAssetLabel = (name: string, withCode128: boolean): TemplateAst =>
  label(
    name,
    [
      brandLine(),
      identifier('asset-tag', 22),
      // With the Code 128 footer the text+QR row is 28 mm: one line each for name and client.
      text('asset-name', 'title', { ...lines(withCode128 ? 1 : 2, 12, 1.2), fontWeight: 600 }),
      text('client', 'clientName', lines(withCode128 ? 1 : 2, 11, 1.2)),
    ],
    // The logo sits above the QR so the text column keeps its full height; the Code 128 variant has a
    // 28 mm row, so its QR shrinks to leave room for a 4 mm logo.
    [logo('logo', withCode128 ? 4 : 8, { objectPosition: 'center' }), qr('qr', withCode128 ? '23mm' : '34mm')],
    withCode128 ? [code128('code128')] : [],
  );

const buildStockUnitLabel = (): TemplateAst =>
  label(
    'Standard Stock Unit Label',
    [
      brandLine(),
      text('product', 'title', { ...lines(2, 13, 1.2), fontWeight: 700 }),
      identifier('unit-code', 18),
      text('serial', 'serialSuffix', { ...lines(1, 11, 1.2), fontFamily: 'monospace' }),
      text('detail', 'detail', { ...lines(2, 10, 1.2), color: '#374151' }),
    ],
    [qr('qr', '34mm')],
  );

/**
 * A project staging box (C6): who and what it is for, a large "Box n of m", the box identifier and its
 * Code 128, and the QR of the box's record URL.
 */
const buildStagingContainerLabel = (): TemplateAst =>
  label(
    'Standard Staging Box Label',
    [
      brandLine(),
      text('client', 'clientName', { ...lines(1, 12, 1.15), fontWeight: 700 }),
      text('project', 'title', lines(1, 11, 1.2)),
      text('task', 'detail', { ...lines(1, 10, 1.2), color: '#374151' }),
      text('box-position', 'sequenceLine', { fontSize: '20px', fontWeight: 800, lineHeight: 1.1 }),
      identifier('box-identifier', 13),
    ],
    [logo('logo', 4, { objectPosition: 'center' }), qr('qr', '23mm')],
    [code128('code128')],
    '0.5mm',
  );

/**
 * An RMA bench tag (C5): RMA number large, who and what is going back, vendor and reference, status with the
 * return-by date, the latest carrier and tracking, and the originating ticket. QR = the RMA record URL.
 * Line budget on the 44 mm cell (no text brand line, the logo sits above the QR): ~154 px worst case.
 */
const buildRmaLabel = (): TemplateAst =>
  label(
    'Standard RMA Label',
    [
      text('client', 'clientName', { ...lines(1, 12, 1.15), fontWeight: 700 }),
      identifier('rma-number', 20),
      text('item', 'title', { ...lines(1, 11, 1.2), fontWeight: 600 }),
      text('vendor', 'detail', { ...lines(1, 10, 1.2), color: '#374151' }),
      text('status', 'rmaStatus', { ...lines(1, 10, 1.2), fontWeight: 700 }),
      text('return-by', 'rmaReturnBy', { ...lines(1, 9, 1.2), color: '#374151' }),
      text('shipping', 'rmaShipping', { ...lines(1, 9, 1.2), fontFamily: 'monospace' }),
      text('asset', 'assetLine', { ...lines(1, 9, 1.2), fontFamily: 'monospace' }),
      text('serial', 'serialLine', { ...lines(1, 9, 1.2), color: '#4b5563', fontFamily: 'monospace' }),
      text('ticket', 'rmaTicket', { ...lines(1, 9, 1.2), color: '#4b5563' }),
    ],
    [logo('logo', 6, { objectPosition: 'center' }), qr('qr', '34mm')],
    [],
    '0.4mm',
  );

export const STANDARD_LABEL_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  [STANDARD_LABEL_TICKET_WORK_TAG_CODE]: buildTicketWorkTag(),
  [STANDARD_LABEL_ASSET_CODE]: buildAssetLabel('Standard Asset Label', false),
  [STANDARD_LABEL_ASSET_CODE128_CODE]: buildAssetLabel('Standard Asset Label with Code 128', true),
  [STANDARD_LABEL_STOCK_UNIT_CODE]: buildStockUnitLabel(),
  [STANDARD_LABEL_STAGING_CONTAINER_CODE]: buildStagingContainerLabel(),
  [STANDARD_LABEL_RMA_CODE]: buildRmaLabel(),
};

export const getStandardLabelTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_LABEL_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};
