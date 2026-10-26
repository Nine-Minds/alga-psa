import type { TemplateAst } from '@alga-psa/types';
import { DEFAULT_INVOICE_PRINT_SETTINGS, TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildStagingManifestTemplateBindings } from './bindings';

/**
 * Standard packing manifest for one project staging box (C6): who and what the box is for, its position
 * among the project's boxes, a QR code to the box, and one row per member with a check column for the
 * technician at the site. Labels are translatable keys in the `documents` namespace.
 */
export const STANDARD_STAGING_MANIFEST_CODE = 'standard-staging-manifest';

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

const buildStandardStagingManifestAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Standard Packing Manifest', printSettings: DEFAULT_INVOICE_PRINT_SETTINGS },
  bindings: buildStagingManifestTemplateBindings(),
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
              { id: 'title', type: 'text', content: { type: 'i18n', i18nKey: 'labels.stagingManifestTitle', defaultValue: 'PACKING MANIFEST' }, style: { inline: { fontSize: '22px', fontWeight: 700, margin: '8px 0 0 0' } } },
              { id: 'box-identifier', type: 'text', content: { type: 'binding', bindingId: 'boxIdentifier' }, style: { inline: { fontSize: '20px', fontWeight: 800, fontFamily: 'monospace' } } },
              { id: 'box-name', type: 'text', content: { type: 'binding', bindingId: 'boxName' }, style: { inline: { color: '#374151' } } },
            ],
          },
          {
            id: 'meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '260px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '12px 14px', backgroundColor: '#f9fafb', gap: '5px' } },
            children: [
              field('box-position', 'boxNumber', 'Box no.', 'boxPosition'),
              field('project-number', 'project', 'Project', 'projectNumber'),
              { id: 'project-name', type: 'text', content: { type: 'binding', bindingId: 'projectName' }, style: { inline: { color: '#374151', textAlign: 'right' } } },
              field('client-name', 'client', 'Client', 'clientName'),
              field('task-name', 'task', 'Task', 'taskName'),
              field('box-status', 'status', 'Status', 'boxStatus'),
              field('sealed-at', 'sealedOn', 'Sealed', 'sealedAt', { format: 'date' }),
              field('sealed-by', 'sealedBy', 'Sealed by', 'sealedBy'),
              field('box-location', 'location', 'Location', 'boxLocation'),
            ],
          },
          {
            id: 'box-qr',
            type: 'barcode',
            symbology: 'qr',
            value: { type: 'binding', bindingId: 'recordUrl' },
            style: { inline: { width: '30mm', height: '30mm', flexShrink: '0' } },
          },
        ],
      },
      { id: 'divider', type: 'divider', style: { inline: { margin: '0 0 14px 0' } } },
      {
        id: 'members',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'members' }, itemBinding: 'item' },
        emptyStateText: { i18nKey: 'labels.emptyState.noItemsInBox', defaultValue: 'This box is empty' },
        columns: [
          { id: 'check', header: { i18nKey: 'labels.checked', defaultValue: 'Checked' }, value: { type: 'literal', value: '☐' }, style: { inline: { width: '8%', textAlign: 'center' } } },
          { id: 'qty', header: { i18nKey: 'labels.qty', defaultValue: 'Qty' }, value: { type: 'path', path: 'quantity' }, format: 'number', style: { inline: { width: '7%', textAlign: 'right' } } },
          { id: 'item', header: { i18nKey: 'labels.item', defaultValue: 'Item' }, value: { type: 'path', path: 'description' }, style: { inline: { width: '29%' } } },
          { id: 'sku', header: { i18nKey: 'labels.skuOrTag', defaultValue: 'SKU / tag' }, value: { type: 'path', path: 'sku' }, style: { inline: { width: '15%' } } },
          { id: 'serial', header: { i18nKey: 'labels.serialNumber', defaultValue: 'Serial number' }, value: { type: 'path', path: 'serial' }, style: { inline: { width: '17%', fontFamily: 'monospace' } } },
          { id: 'owner', header: { i18nKey: 'labels.owner', defaultValue: 'Owner' }, value: { type: 'path', path: 'owner' }, style: { inline: { width: '9%' } } },
          { id: 'task', header: { i18nKey: 'labels.task', defaultValue: 'Task' }, value: { type: 'path', path: 'taskName' }, style: { inline: { width: '15%' } } },
        ],
      },
      { id: 'notes-section', type: 'section', title: { i18nKey: 'labels.notes', defaultValue: 'Notes' }, children: [
        { id: 'notes-copy', type: 'text', content: { type: 'binding', bindingId: 'boxNotes' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
      ] },
      { id: 'checked-by', type: 'text', content: { type: 'i18n', i18nKey: 'labels.note.checkedBy', defaultValue: 'Checked by: ____________________     Date: ____________' }, style: { inline: { color: '#374151', margin: '24px 0 0 0' } } },
    ],
  },
} as unknown as TemplateAst);

export const STANDARD_STAGING_MANIFEST_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  [STANDARD_STAGING_MANIFEST_CODE]: buildStandardStagingManifestAst(),
};

export const getStandardStagingManifestTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_STAGING_MANIFEST_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};
