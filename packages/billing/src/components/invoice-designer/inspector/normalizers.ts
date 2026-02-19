export const normalizeString = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

// Preserve user-authored whitespace while typing; canonical trim still happens on commit/blur.
export const normalizeStringLive = (raw: string): string | undefined => {
  if (raw.length === 0) return undefined;
  return raw;
};

export const normalizeCssLength = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  // Convenience: allow entering "12" and treat it as px.
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }

  return trimmed;
};

export const normalizeCssColor = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const normalizeNumber = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
};
