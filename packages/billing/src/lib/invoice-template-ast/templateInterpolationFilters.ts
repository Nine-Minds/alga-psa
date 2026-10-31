export type TemplateTokenFilter = 'currency' | 'daterange';

export type ParsedTemplateToken = {
  path: string;
  filter?: TemplateTokenFilter;
};

const normalizeFilterName = (value: string): string => value.trim().toLowerCase();

export const parseTemplateToken = (rawToken: string): ParsedTemplateToken | null => {
  const normalized = rawToken.trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.split('|');
  if (segments.length === 1) {
    const path = segments[0].trim();
    return path ? { path } : null;
  }

  if (segments.length !== 2) {
    return null;
  }

  const path = segments[0].trim();
  const filter = normalizeFilterName(segments[1] ?? '');
  if (!path || !filter) {
    return null;
  }

  if (filter === 'currency') {
    return { path, filter: 'currency' };
  }

  // Bundle component period label: `component.periodLabelStart|daterange`
  // formats the start and the sibling `periodLabelEnd` as "start – end".
  if (filter === 'daterange') {
    return { path, filter: 'daterange' };
  }

  return null;
};

export const encodeTemplatePathExpression = (
  path: string,
  filter?: TemplateTokenFilter
): string => (filter ? `${path}|${filter}` : path);

export const decodeTemplatePathExpression = (
  encodedPath: string
): ParsedTemplateToken => {
  const parsed = parseTemplateToken(encodedPath);
  if (parsed) {
    return parsed;
  }
  return { path: encodedPath.trim() };
};
