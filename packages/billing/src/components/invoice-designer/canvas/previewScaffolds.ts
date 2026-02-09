import type { DesignerNode } from '../state/designerStore';

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

const inferContextualValueScaffold = (input: {
  bindingKey: string;
  placeholderHint: string;
  labelHint: string;
  format: string;
}): string => {
  const haystack = normalizeHintText(`${input.bindingKey} ${input.placeholderHint} ${input.labelHint}`);
  if (
    hasAnyKeyword(haystack, [
      /\binvoice (number|no|id)\b/,
      /\binvoice #\b/,
      /\binv #\b/,
      /\binv(?:oice)? number\b/,
    ])
  ) {
    return 'INV-000123';
  }
  if (
    hasAnyKeyword(haystack, [
      /\b(issue|invoice) date\b/,
      /\bissued\b/,
      /\bdue date\b/,
      /\bduedate\b/,
    ])
  ) {
    return 'MM/DD/YYYY';
  }
  if (hasAnyKeyword(haystack, [/\bpo\b/, /\bpo number\b/, /\bpurchase order\b/, /\bpurchaseorder\b/])) {
    return 'Optional';
  }
  if (input.format === 'date') {
    return 'MM/DD/YYYY';
  }
  if (input.format === 'currency') {
    return '$0.00';
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

export const resolveFieldPreviewScaffold = (node: DesignerNode): EditorPreviewScaffold => {
  const metadata = (node.metadata ?? {}) as NodeMetadata;
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
      labelHint: node.name,
      format,
    }),
    isPlaceholder: true,
  };
};

export const resolveLabelPreviewScaffold = (node: DesignerNode): EditorPreviewScaffold => {
  const metadata = (node.metadata ?? {}) as NodeMetadata;
  const text = asTrimmedString(metadata.text);
  if (text.length > 0) {
    return {
      text,
      isPlaceholder: false,
    };
  }
  return {
    text: inferContextualLabelScaffold(node.name),
    isPlaceholder: true,
  };
};
