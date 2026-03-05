export type InvoiceTemplateTokenFilter = 'currency';

export type ParsedInvoiceTemplateToken = {
  path: string;
  filter?: InvoiceTemplateTokenFilter;
};

const normalizeFilterName = (value: string): string => value.trim().toLowerCase();

export const parseInvoiceTemplateToken = (rawToken: string): ParsedInvoiceTemplateToken | null => {
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

  return null;
};

export const encodeInvoiceTemplatePathExpression = (
  path: string,
  filter?: InvoiceTemplateTokenFilter
): string => (filter ? `${path}|${filter}` : path);

export const decodeInvoiceTemplatePathExpression = (
  encodedPath: string
): ParsedInvoiceTemplateToken => {
  const parsed = parseInvoiceTemplateToken(encodedPath);
  if (parsed) {
    return parsed;
  }
  return { path: encodedPath.trim() };
};
