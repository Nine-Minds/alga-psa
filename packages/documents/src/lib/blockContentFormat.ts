export type BlockContentFormat = 'blocknote' | 'prosemirror' | 'empty' | 'unknown';

export const parseBlockContent = (blockData: unknown): unknown => {
  if (typeof blockData !== 'string') {
    return blockData;
  }

  try {
    return JSON.parse(blockData);
  } catch {
    return blockData;
  }
};

export const detectBlockContentFormat = (blockData: unknown): BlockContentFormat => {
  const parsed = parseBlockContent(blockData);

  if (parsed === null || parsed === undefined) {
    return 'empty';
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return 'empty';
    }

    const first = parsed[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && 'props' in first) {
      return 'blocknote';
    }
    return 'unknown';
  }

  if (typeof parsed === 'object') {
    const maybeDoc = parsed as { type?: string };
    if (maybeDoc.type === 'doc') {
      return 'prosemirror';
    }
  }

  return 'unknown';
};
