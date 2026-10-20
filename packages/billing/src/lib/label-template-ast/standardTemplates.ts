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

export const LABEL_STANDARD_CODE_BY_CLASS: Record<LabelClass, string> = {
  'ticket-work-tag': STANDARD_LABEL_TICKET_WORK_TAG_CODE,
  'asset-identity': STANDARD_LABEL_ASSET_CODE,
  'stock-unit-identity': STANDARD_LABEL_STOCK_UNIT_CODE,
};

/** The label class a standard code prints (used to validate a requested code against a class). */
export const LABEL_CLASS_BY_STANDARD_CODE: Record<string, LabelClass> = {
  [STANDARD_LABEL_TICKET_WORK_TAG_CODE]: 'ticket-work-tag',
  [STANDARD_LABEL_ASSET_CODE]: 'asset-identity',
  [STANDARD_LABEL_ASSET_CODE128_CODE]: 'asset-identity',
  [STANDARD_LABEL_STOCK_UNIT_CODE]: 'stock-unit-identity',
};

const cloneAst = (ast: TemplateAst): TemplateAst => JSON.parse(JSON.stringify(ast)) as TemplateAst;

type Node = Record<string, unknown>;

const text = (id: string, bindingId: string, inline: Record<string, unknown>): Node => ({
  id,
  type: 'text',
  content: { type: 'binding', bindingId },
  style: { inline: { margin: '0', ...inline } },
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
  style: { inline: { width: '60mm', height: '9mm' } },
});

const brandLine = (): Node =>
  text('brand', 'tenantName', { fontSize: '8px', color: '#4b5563' });

const label = (name: string, left: Node[], right: Node[]): TemplateAst =>
  ({
    kind: 'invoice-template-ast',
    version: TEMPLATE_AST_VERSION,
    metadata: {
      templateName: name,
      printSettings: { paperPreset: 'Letter', marginMm: 3, customPageSize: { width: 4, height: 2, unit: 'in' } },
    },
    bindings: buildLabelTemplateBindings(),
    layout: {
      id: 'root',
      type: 'document',
      children: [
        {
          id: 'label',
          type: 'stack',
          direction: 'row',
          style: { inline: { gap: '3mm', alignItems: 'center', justifyContent: 'space-between', height: '44mm' } },
          children: [
            { id: 'label-text', type: 'stack', direction: 'column', style: { inline: { gap: '1mm', flex: '1 1 0', minWidth: '0' } }, children: left },
            { id: 'label-code', type: 'stack', direction: 'column', style: { inline: { gap: '1mm', alignItems: 'center' } }, children: right },
          ],
        },
      ],
    },
  }) as unknown as TemplateAst;

const buildTicketWorkTag = (): TemplateAst =>
  label(
    'Standard Ticket Work Tag',
    [
      brandLine(),
      text('client', 'clientName', { fontSize: '13px', fontWeight: 700, lineHeight: 1.15 }),
      text('item', 'title', { fontSize: '11px', lineHeight: 1.2, maxHeight: '13mm' }),
      text('ticket-number', 'identifier', { fontSize: '20px', fontWeight: 800, fontFamily: 'monospace' }),
      text('reason', 'detail', { fontSize: '10px', color: '#374151', lineHeight: 1.2, maxHeight: '8mm' }),
      text('asset', 'secondaryIdentifier', { fontSize: '10px', fontFamily: 'monospace' }),
      text('serial', 'serialSuffix', { fontSize: '9px', color: '#4b5563', fontFamily: 'monospace' }),
    ],
    [qr('qr', '34mm')],
  );

const buildAssetLabel = (name: string, withCode128: boolean): TemplateAst =>
  label(
    name,
    [
      brandLine(),
      text('asset-tag', 'identifier', { fontSize: '22px', fontWeight: 800, fontFamily: 'monospace' }),
      text('asset-name', 'title', { fontSize: '12px', fontWeight: 600, lineHeight: 1.2, maxHeight: '14mm' }),
      text('client', 'clientName', { fontSize: '11px', lineHeight: 1.2 }),
      ...(withCode128 ? [code128('code128')] : []),
    ],
    [qr('qr', withCode128 ? '30mm' : '34mm')],
  );

const buildStockUnitLabel = (): TemplateAst =>
  label(
    'Standard Stock Unit Label',
    [
      brandLine(),
      text('product', 'title', { fontSize: '13px', fontWeight: 700, lineHeight: 1.2, maxHeight: '16mm' }),
      text('unit-code', 'identifier', { fontSize: '18px', fontWeight: 800, fontFamily: 'monospace' }),
      text('serial', 'serialSuffix', { fontSize: '11px', fontFamily: 'monospace' }),
      text('detail', 'detail', { fontSize: '10px', color: '#374151' }),
    ],
    [qr('qr', '34mm')],
  );

export const STANDARD_LABEL_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  [STANDARD_LABEL_TICKET_WORK_TAG_CODE]: buildTicketWorkTag(),
  [STANDARD_LABEL_ASSET_CODE]: buildAssetLabel('Standard Asset Label', false),
  [STANDARD_LABEL_ASSET_CODE128_CODE]: buildAssetLabel('Standard Asset Label with Code 128', true),
  [STANDARD_LABEL_STOCK_UNIT_CODE]: buildStockUnitLabel(),
};

export const getStandardLabelTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_LABEL_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};
