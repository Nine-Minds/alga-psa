import type { DesignerDocumentKind } from './documentKind';

/**
 * The designer shows a work-tag label's record-URL binding as this token (the `label.*` display root of
 * the work-tag binding catalog), and typing it back into a barcode's Value field binds the record URL.
 */
export const WORK_TAG_BARCODE_VALUE_EXAMPLE = '{{label.recordUrl}}';

/** Placeholder for the barcode Value field: a real binding for this document type, or none. */
export const barcodeValuePlaceholder = (documentKind: DesignerDocumentKind): string =>
  documentKind === 'work-tag' ? WORK_TAG_BARCODE_VALUE_EXAMPLE : '';
