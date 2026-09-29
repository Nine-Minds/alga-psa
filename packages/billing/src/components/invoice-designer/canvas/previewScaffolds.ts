import type { DesignerNode } from '../state/designerStore';
import { resolveLabelText } from '../labelText';
import { formatBoundValue } from '../preview/previewBindings';
import { getNodeMetadata } from '../utils/nodeProps';
import {
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
  type DateFieldPart,
} from '@alga-psa/core/i18n/countryDateFormat';

type NodeMetadata = Record<string, unknown>;

export type EditorPreviewScaffold = {
  text: string;
  isPlaceholder: boolean;
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeHintText = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._\-/#:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const coercePreviewValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (value && typeof value === 'object') {
    const asRecord = value as Record<string, unknown>;
    const nested =
      coercePreviewValue(asRecord.value) ||
      coercePreviewValue(asRecord.text) ||
      coercePreviewValue(asRecord.label);
    if (nested.length > 0) {
      return nested;
    }
  }
  return '';
};

const resolveSampleValue = (metadata: NodeMetadata): string => {
  const candidates = [
    metadata.previewValue,
    metadata.sampleValue,
    metadata.mockValue,
    metadata.value,
    metadata.preview,
    metadata.sample,
    metadata.exampleValue,
    metadata.example,
  ];
  for (const candidate of candidates) {
    const resolved = coercePreviewValue(candidate);
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return '';
};

const hasAnyKeyword = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));

const PART_HINT: Record<DateFieldPart, string> = { day: 'DD', month: 'MM', year: 'YYYY' };

/**
 * The shape hint shown in an unbound date field, e.g. 'DD/MM/YYYY'.
 *
 * A placeholder that advertises the wrong digit order is a small lie about what
 * the rendered document will say, so it follows the same country format the
 * bound value would.
 */
const dateScaffoldHint = (dateFormat: CountryDateFormat = SYSTEM_DATE_FORMAT): string =>
  dateFormat.order.map((part) => PART_HINT[part]).join(dateFormat.separator);

const inferContextualValueScaffold = (input: {
  bindingKey: string;
  placeholderHint: string;
  labelHint: string;
  format: string;
  currencyCode: string;
  dateFormat?: CountryDateFormat;
}): string => {
  const contextHaystack = normalizeHintText(`${input.bindingKey} ${input.labelHint}`);
  if (
    hasAnyKeyword(contextHaystack, [
      /\binvoice (number|no|id)\b/,
      /\binvoice #\b/,
      /\binv #\b/,
      /\binv(?:oice)? number\b/,
    ])
  ) {
    return 'INV-000123';
  }
  if (
    hasAnyKeyword(contextHaystack, [
      /\b(issue|invoice) date\b/,
      /\bissued\b/,
      /\bdue date\b/,
      /\bduedate\b/,
    ])
  ) {
    return dateScaffoldHint(input.dateFormat);
  }
  if (hasAnyKeyword(contextHaystack, [/\bpo\b/, /\bpo number\b/, /\bpurchase order\b/, /\bpurchaseorder\b/])) {
    return 'Optional';
  }
  if (input.format === 'date') {
    return dateScaffoldHint(input.dateFormat);
  }
  if (input.format === 'currency') {
    return formatBoundValue(0, 'currency', input.currencyCode) ?? '';
  }
  if (input.placeholderHint.length > 0) {
    return input.placeholderHint;
  }
  return 'Sample value';
};

const inferContextualLabelScaffold = (labelHint: string): string => {
  const lowered = normalizeHintText(labelHint);
  if (hasAnyKeyword(lowered, [/\binvoice (number|no|id)\b/, /\binvoice #\b/, /\binv #\b/])) {
    return 'Invoice #';
  }
  if (hasAnyKeyword(lowered, [/\b(issue|invoice) date\b/, /\bissued\b/])) {
    return 'Issue Date';
  }
  if (hasAnyKeyword(lowered, [/\bdue date\b/, /\bduedate\b/])) {
    return 'Due Date';
  }
  if (hasAnyKeyword(lowered, [/\bpo\b/, /\bpo number\b/, /\bpurchase order\b/, /\bpurchaseorder\b/])) {
    return 'PO Number';
  }
  return 'Label';
};

const resolveFieldLabelHint = (metadata: NodeMetadata): string =>
  asTrimmedString(metadata.label) ||
  asTrimmedString(metadata.text);

export const resolveFieldPreviewScaffold = (
  node: DesignerNode,
  currencyCode: string = 'USD',
  dateFormat?: CountryDateFormat
): EditorPreviewScaffold => {
  const metadata = getNodeMetadata(node) as NodeMetadata;
  const sampleValue = resolveSampleValue(metadata);
  if (sampleValue.length > 0) {
    return {
      text: sampleValue,
      isPlaceholder: false,
    };
  }

  const bindingKey =
    asTrimmedString(metadata.bindingKey) ||
    asTrimmedString(metadata.binding) ||
    asTrimmedString(metadata.key) ||
    asTrimmedString(metadata.path);
  const placeholderHint = asTrimmedString(metadata.placeholder);
  const format = asTrimmedString(metadata.format).toLowerCase();
  return {
    text: inferContextualValueScaffold({
      bindingKey,
      placeholderHint,
      labelHint: resolveFieldLabelHint(metadata),
      format,
      currencyCode,
      dateFormat,
    }),
    isPlaceholder: true,
  };
};

export const resolveLabelPreviewScaffold = (node: DesignerNode): EditorPreviewScaffold => {
  const explicitLabel = resolveLabelText(node, { includeNameFallback: false }).text;
  if (explicitLabel.length > 0) {
    return {
      text: explicitLabel,
      isPlaceholder: false,
    };
  }
  return {
    text: inferContextualLabelScaffold(resolveLabelText(node, { includeNameFallback: false }).text),
    isPlaceholder: true,
  };
};
