import type { TFunction } from 'i18next';
import { isDocumentType } from '@alga-psa/billing/lib/document-templates/registry';

/**
 * The translated name of a document type.
 *
 * The registry carries English labels ('Sales Order', 'Packing Slip') because it
 * is a pure data module with no access to i18n. Those labels get interpolated
 * into sentences — "{{type}} Layouts", "Failed to save {{type}} layout" — so
 * reading them straight from the registry puts an English noun inside a German
 * sentence once the frame is translated.
 *
 * Written as a switch of literal keys rather than a lookup table so every key is
 * statically visible to scripts/find-missing-i18n-keys.cjs; a computed
 * `t(\`...types.${type}\`)` would resolve at runtime and silently escape it.
 */
export function documentTypeLabel(documentType: string, t: TFunction): string {
  if (!isDocumentType(documentType)) {
    return t('documentTemplates.defaultTypeLabel', { defaultValue: 'Document' });
  }

  switch (documentType) {
    case 'sales-order':
      return t('documentTemplates.types.salesOrder', { defaultValue: 'Sales Order' });
    case 'packing-slip':
      return t('documentTemplates.types.packingSlip', { defaultValue: 'Packing Slip' });
    case 'pick-list':
      return t('documentTemplates.types.pickList', { defaultValue: 'Pick List' });
    default:
      // A type in the registry but not here: fall back to its English label
      // rather than a raw key, so a newly added type degrades gracefully.
      return t('documentTemplates.defaultTypeLabel', { defaultValue: 'Document' });
  }
}
