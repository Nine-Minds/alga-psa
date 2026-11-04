import type { TemplateAst } from '@alga-psa/types';
import { DEFAULT_INVOICE_PRINT_SETTINGS, TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildRmaReturnSlipTemplateBindings } from './bindings';

/**
 * Standard RMA return slip (C5): who and what is going back, to which vendor under which reference, how it
 * ships, the return-by date and the return address, a QR to the RMA, and a signature line. Labels are
 * translatable keys in the `documents` namespace.
 */
export const STANDARD_RMA_RETURN_SLIP_CODE = 'standard-rma-return-slip';

const cloneAst = (ast: TemplateAst): TemplateAst => JSON.parse(JSON.stringify(ast)) as TemplateAst;

const field = (id: string, key: string, defaultValue: string, bindingId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  label: { i18nKey: `labels.${key}`, defaultValue },
  binding: { bindingId },
  emptyValue: '-',
  style: { inline: { justifyContent: 'space-between', gap: '12px' } },
  ...extra,
});

const card = (id: string, titleKey: string, titleDefault: string, children: unknown[]) => ({
  id,
  type: 'stack',
  direction: 'column',
  style: { inline: { flex: '1 1 0', minWidth: '0', border: '1px solid #d1d5db', borderRadius: '10px', padding: '12px 14px', backgroundColor: '#f9fafb', gap: '5px' } },
  children: [
    { id: `${id}-title`, type: 'text', content: { type: 'i18n', i18nKey: titleKey, defaultValue: titleDefault }, style: { inline: { fontWeight: 700, margin: '0 0 4px 0' } } },
    ...children,
  ],
});

const buildStandardRmaReturnSlipAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Standard RMA Return Slip', printSettings: DEFAULT_INVOICE_PRINT_SETTINGS },
  bindings: buildRmaReturnSlipTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header-top',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', margin: '0 0 16px 0' } },
        children: [
          {
            id: 'issuer-brand',
            type: 'stack',
            direction: 'column',
            style: { inline: { gap: '6px', flex: '1 1 0', minWidth: '0' } },
            children: [
              { id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantLogo' }, alt: { type: 'literal', value: 'logo' }, style: { inline: { width: '160px', maxHeight: '64px', objectFit: 'contain', objectPosition: 'left' } } },
              { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '16px', fontWeight: 700 } } },
              { id: 'title', type: 'text', content: { type: 'i18n', i18nKey: 'labels.rmaReturnSlipTitle', defaultValue: 'RMA RETURN SLIP' }, style: { inline: { fontSize: '22px', fontWeight: 700, margin: '8px 0 0 0' } } },
              { id: 'rma-number', type: 'text', content: { type: 'binding', bindingId: 'rmaNumber' }, style: { inline: { fontSize: '20px', fontWeight: 800, fontFamily: 'monospace' } } },
            ],
          },
          {
            id: 'rma-qr',
            type: 'barcode',
            symbology: 'qr',
            value: { type: 'binding', bindingId: 'recordUrl' },
            style: { inline: { width: '30mm', height: '30mm', flexShrink: '0' } },
          },
        ],
      },
      { id: 'divider', type: 'divider', style: { inline: { margin: '0 0 14px 0' } } },
      {
        id: 'details-row',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '16px', alignItems: 'stretch', margin: '0 0 16px 0' } },
        children: [
          card('device-card', 'labels.device', 'Device', [
            field('client-name', 'client', 'Client', 'clientName'),
            field('asset-name', 'asset', 'Asset', 'assetName'),
            field('asset-serial', 'serialNumber', 'Serial number', 'assetSerialNumber'),
            field('asset-tag', 'assetTag', 'Asset tag', 'assetTag'),
            field('replacement-serial', 'replacementSerial', 'Replacement serial', 'replacementSerialNumber'),
            field('ticket-number', 'ticket', 'Ticket', 'ticketNumber'),
          ]),
          card('vendor-card', 'labels.vendor', 'Vendor', [
            field('vendor-name', 'vendor', 'Vendor', 'vendorName'),
            field('vendor-reference', 'vendorReference', 'Vendor reference', 'vendorReference'),
            field('shipping', 'shipping', 'Shipping', 'shippingSummary'),
            field('return-by', 'returnBy', 'Return by', 'returnBy', { format: 'date' }),
            field('printed-on', 'date', 'Date', 'printedOn', { format: 'date' }),
          ]),
        ],
      },
      { id: 'ship-to-section', type: 'section', title: { i18nKey: 'labels.returnShipTo', defaultValue: 'Return ship to' }, children: [
        { id: 'ship-to-copy', type: 'text', content: { type: 'binding', bindingId: 'returnShipTo' }, style: { inline: { color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-line' } } },
      ] },
      { id: 'signature-line', type: 'text', content: { type: 'i18n', i18nKey: 'labels.note.releasedBy', defaultValue: 'Released by: ____________________     Signature: ____________________     Date: ____________' }, style: { inline: { color: '#374151', margin: '32px 0 0 0' } } },
    ],
  },
} as unknown as TemplateAst);

export const STANDARD_RMA_RETURN_SLIP_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  [STANDARD_RMA_RETURN_SLIP_CODE]: buildStandardRmaReturnSlipAst(),
};

export const getStandardRmaReturnSlipTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_RMA_RETURN_SLIP_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};
