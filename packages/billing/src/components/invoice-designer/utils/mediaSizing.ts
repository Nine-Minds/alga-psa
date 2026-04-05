type MediaSizingStyle = {
  width?: unknown;
  height?: unknown;
  maxWidth?: unknown;
  maxHeight?: unknown;
  aspectRatio?: unknown;
};

const parsePxLength = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const numeric = Number.parseFloat(trimmed.replace(/px$/i, '').trim());
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseAspectRatioNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split('/').map((part) => Number.parseFloat(part.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] > 0 && parts[1] > 0) {
    return parts[0] / parts[1];
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
};

export const resolveMediaFrameSize = (style: MediaSizingStyle): { width?: number; height?: number } => {
  const width = parsePxLength(style.width) ?? parsePxLength(style.maxWidth);
  const height = parsePxLength(style.height) ?? parsePxLength(style.maxHeight);
  const aspectRatio = parseAspectRatioNumber(style.aspectRatio);

  return {
    width: width ?? (height !== undefined && aspectRatio ? height * aspectRatio : undefined),
    height: height ?? (width !== undefined && aspectRatio ? width / aspectRatio : undefined),
  };
};
