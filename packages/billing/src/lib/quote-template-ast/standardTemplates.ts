import type { TemplateAst } from '@alga-psa/types';
import { DEFAULT_INVOICE_PRINT_SETTINGS, TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildQuoteTemplateBindings } from './bindings';

const cloneAst = (ast: TemplateAst): TemplateAst =>
  JSON.parse(JSON.stringify(ast)) as TemplateAst;

/**
 * Standard Quote Default — clean, professional layout with logo, party blocks,
 * line items table, totals, terms, and signature block.
 */
const buildStandardQuoteDefaultAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: {
    templateName: 'Standard Quote Default',
    printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
  },
  bindings: buildQuoteTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      // ── Header: logo + quote meta card ────────────────────────────
      {
        id: 'header-top',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' } },
        children: [
          {
            id: 'issuer-brand',
            type: 'stack',
            direction: 'column',
            style: { inline: { gap: '6px' } },
            children: [
              {
                id: 'issuer-logo',
                type: 'image',
                src: { type: 'binding', bindingId: 'tenantLogo' },
                alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } },
                style: { inline: { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' } },
              },
              {
                id: 'issuer-name',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantName' },
                style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.2 } },
              },
              {
                id: 'issuer-address',
                type: 'text',
                content: { type: 'binding', bindingId: 'tenantAddress' },
                style: { inline: { color: '#4b5563', lineHeight: 1.4 } },
              },
            ],
          },
          {
            id: 'quote-meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' } },
            children: [
              { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'QUOTE' }, style: { inline: { fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 } } },
              { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' }, style: { inline: { justifyContent: 'space-between' } } },
              { id: 'quote-date', type: 'field', label: 'Date', binding: { bindingId: 'quoteDate' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'po-number', type: 'field', label: 'PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
            ],
          },
        ],
      },
      // ── Divider ────────────────────────────────────────────────────
      { id: 'header-divider', type: 'divider', style: { inline: { margin: '0 0 20px 0' } } },
      // ── Party blocks: From / Prepared For ─────────────────────────
      {
        id: 'party-blocks',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '24px', margin: '0 0 20px 0' } },
        children: [
          {
            id: 'from-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'from-label', type: 'text', content: { type: 'literal', value: 'From' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'prepared-for-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'prepared-for-label', type: 'text', content: { type: 'literal', value: 'Prepared For' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'client-name', type: 'text', content: { type: 'binding', bindingId: 'clientName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'client-address', type: 'text', content: { type: 'binding', bindingId: 'clientAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
              { id: 'contact-name', type: 'text', content: { type: 'binding', bindingId: 'contactName' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
        ],
      },
      // ── Quote title & scope ───────────────────────────────────────
      {
        id: 'overview-section',
        type: 'stack',
        direction: 'column',
        style: { inline: { margin: '0 0 20px 0', gap: '8px' } },
        children: [
          { id: 'quote-heading', type: 'text', content: { type: 'binding', bindingId: 'title' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.3 } } },
          { id: 'scope-text', type: 'text', content: { type: 'binding', bindingId: 'scope' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
        ],
      },
      // ── Line items table ──────────────────────────────────────────
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: 'No line items',
        columns: [
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: { inline: { width: '50%' } } },
          { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: { inline: { textAlign: 'right', width: '14%' } } },
          { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '18%' } } },
          { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '18%' } } },
        ],
      },
      // ── Totals (right-aligned card) ───────────────────────────────
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'flex-end', margin: '0 0 24px 0' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            style: { inline: { width: '300px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' } },
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
              { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
              { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
              { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
            ],
          },
        ],
      },
      // ── Client notes ──────────────────────────────────────────────
      {
        id: 'client-notes-section',
        type: 'section',
        title: 'Notes',
        children: [
          { id: 'client-notes-copy', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
        ],
      },
      // ── Terms & Conditions ────────────────────────────────────────
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          { id: 'terms-copy', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' }, style: { inline: { color: '#374151', lineHeight: 1.5, fontSize: '13px' } } },
        ],
      },
      // ── Signature block ───────────────────────────────────────────
      {
        id: 'signature-block',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '48px', margin: '40px 0 0 0' } },
        children: [
          {
            id: 'sig-client',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px' } },
            children: [
              { id: 'sig-client-label', type: 'text', content: { type: 'literal', value: 'Accepted By' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
              { id: 'sig-client-line', type: 'divider', style: { inline: { margin: '24px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-client-name', type: 'text', content: { type: 'binding', bindingId: 'acceptedByName' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
              { id: 'sig-client-date-line', type: 'divider', style: { inline: { margin: '20px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-client-date', type: 'text', content: { type: 'binding', bindingId: 'acceptedAt' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
            ],
          },
          {
            id: 'sig-issuer',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px' } },
            children: [
              { id: 'sig-issuer-label', type: 'text', content: { type: 'literal', value: 'Authorized By' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
              { id: 'sig-issuer-line', type: 'divider', style: { inline: { margin: '24px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-issuer-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
              { id: 'sig-issuer-date-line', type: 'divider', style: { inline: { margin: '20px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-issuer-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
            ],
          },
        ],
      },
    ],
  },
});

/**
 * Standard Quote Detailed — includes phases, optional/recurring flags,
 * PO number, version, and a more detailed line items table.
 */
const buildStandardQuoteDetailedAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: {
    templateName: 'Standard Quote Detailed',
    printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
  },
  bindings: buildQuoteTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      // ── Header: logo + quote meta card ────────────────────────────
      {
        id: 'header-top',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' } },
        children: [
          {
            id: 'issuer-brand',
            type: 'stack',
            direction: 'column',
            style: { inline: { gap: '6px' } },
            children: [
              {
                id: 'issuer-logo',
                type: 'image',
                src: { type: 'binding', bindingId: 'tenantLogo' },
                alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } },
                style: { inline: { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' } },
              },
              { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.2 } } },
              { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'quote-meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' } },
            children: [
              { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'QUOTE' }, style: { inline: { fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 } } },
              { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' }, style: { inline: { justifyContent: 'space-between' } } },
              { id: 'quote-date', type: 'field', label: 'Date', binding: { bindingId: 'quoteDate' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'po-number', type: 'field', label: 'PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'version', type: 'field', label: 'Version', binding: { bindingId: 'version' }, style: { inline: { justifyContent: 'space-between' } } },
            ],
          },
        ],
      },
      { id: 'header-divider', type: 'divider', style: { inline: { margin: '0 0 20px 0' } } },
      // ── Party blocks ──────────────────────────────────────────────
      {
        id: 'party-blocks',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '24px', margin: '0 0 20px 0' } },
        children: [
          {
            id: 'from-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'from-label', type: 'text', content: { type: 'literal', value: 'From' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'prepared-for-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'prepared-for-label', type: 'text', content: { type: 'literal', value: 'Prepared For' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'client-name', type: 'text', content: { type: 'binding', bindingId: 'clientName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'client-address', type: 'text', content: { type: 'binding', bindingId: 'clientAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
              { id: 'contact-name', type: 'text', content: { type: 'binding', bindingId: 'contactName' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
        ],
      },
      // ── Overview: title, scope, client notes ──────────────────────
      {
        id: 'overview-section',
        type: 'stack',
        direction: 'column',
        style: { inline: { margin: '0 0 20px 0', gap: '8px' } },
        children: [
          { id: 'quote-heading', type: 'text', content: { type: 'binding', bindingId: 'title' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.3 } } },
          { id: 'scope-text', type: 'text', content: { type: 'binding', bindingId: 'scope' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
          { id: 'client-notes-text', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' }, style: { inline: { color: '#374151', lineHeight: 1.5, fontStyle: 'italic' } } },
        ],
      },
      // ── Phase summary table ───────────────────────────────────────
      {
        id: 'phase-summary',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'phases' }, itemBinding: 'phase' },
        emptyStateText: 'No phases defined',
        columns: [
          { id: 'phase-name', header: 'Project Phase', value: { type: 'path', path: 'name' }, style: { inline: { width: '100%' } } },
        ],
      },
      // ── Detailed line items table ─────────────────────────────────
      {
        id: 'line-items-detailed',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: 'No line items',
        columns: [
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: { inline: { width: '36%' } } },
          { id: 'phase', header: 'Phase', value: { type: 'path', path: 'phase' }, style: { inline: { width: '14%' } } },
          { id: 'optional', header: 'Optional', value: { type: 'path', path: 'is_optional' }, style: { inline: { width: '8%', textAlign: 'center' } } },
          { id: 'recurring', header: 'Recurring', value: { type: 'path', path: 'is_recurring' }, style: { inline: { width: '8%', textAlign: 'center' } } },
          { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: { inline: { textAlign: 'right', width: '8%' } } },
          { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '13%' } } },
          { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '13%' } } },
        ],
      },
      // ── Totals ────────────────────────────────────────────────────
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'flex-end', margin: '0 0 24px 0' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            style: { inline: { width: '300px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' } },
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
              { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
              { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
              { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
            ],
          },
        ],
      },
      // ── Terms & Conditions ────────────────────────────────────────
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          { id: 'terms-copy', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' }, style: { inline: { color: '#374151', lineHeight: 1.5, fontSize: '13px' } } },
        ],
      },
      // ── Signature block ───────────────────────────────────────────
      {
        id: 'signature-block',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '48px', margin: '40px 0 0 0' } },
        children: [
          {
            id: 'sig-client',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px' } },
            children: [
              { id: 'sig-client-label', type: 'text', content: { type: 'literal', value: 'Accepted By' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
              { id: 'sig-client-line', type: 'divider', style: { inline: { margin: '24px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-client-name', type: 'text', content: { type: 'binding', bindingId: 'acceptedByName' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
              { id: 'sig-client-date-line', type: 'divider', style: { inline: { margin: '20px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-client-date', type: 'text', content: { type: 'binding', bindingId: 'acceptedAt' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
            ],
          },
          {
            id: 'sig-issuer',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px' } },
            children: [
              { id: 'sig-issuer-label', type: 'text', content: { type: 'literal', value: 'Authorized By' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
              { id: 'sig-issuer-line', type: 'divider', style: { inline: { margin: '24px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-issuer-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
              { id: 'sig-issuer-date-line', type: 'divider', style: { inline: { margin: '20px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-issuer-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
            ],
          },
        ],
      },
    ],
  },
});

export const STANDARD_QUOTE_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  'standard-quote-default': buildStandardQuoteDefaultAst(),
  'standard-quote-detailed': buildStandardQuoteDetailedAst(),
};

export const getStandardQuoteTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_QUOTE_TEMPLATE_ASTS[code];

  return ast ? cloneAst(ast) : null;
};
