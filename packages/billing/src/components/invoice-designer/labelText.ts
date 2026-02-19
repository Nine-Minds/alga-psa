import type { DesignerNode } from './state/designerStore';
import { getNodeMetadata, getNodeName } from './utils/nodeProps';

export type LabelTextSource = 'metadata.text' | 'metadata.label' | 'name' | 'none';

export type ResolveLabelTextOptions = {
  includeNameFallback?: boolean;
  shouldSkip?: (value: string) => boolean;
};

export type ResolvedLabelText = {
  text: string;
  source: LabelTextSource;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const resolveLabelText = (
  node: DesignerNode,
  options: ResolveLabelTextOptions = {}
): ResolvedLabelText => {
  const metadata = asRecord(getNodeMetadata(node));
  const includeNameFallback = options.includeNameFallback === true;
  const candidates: Array<{ source: LabelTextSource; value: string }> = [
    { source: 'metadata.text', value: asTrimmedString(metadata.text) },
    { source: 'metadata.label', value: asTrimmedString(metadata.label) },
  ];

  if (includeNameFallback) {
    candidates.push({ source: 'name', value: asTrimmedString(getNodeName(node)) });
  }

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }
    if (options.shouldSkip?.(candidate.value)) {
      continue;
    }
    return {
      text: candidate.value,
      source: candidate.source,
    };
  }

  return {
    text: '',
    source: 'none',
  };
};
