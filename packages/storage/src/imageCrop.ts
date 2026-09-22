import type { LogoCropRect } from '@alga-psa/types';

export type { LogoCropRect };

/** Square marks are stored at the same size as avatars so every circle reads them alike. */
export const SQUARE_MARK_DIMENSION = 256;

// Rasterized SVG sources are rendered to roughly this long edge before the cut.
const SVG_RENDER_DIMENSION = 1024;
const SVG_DEFAULT_DENSITY = 72;
const EPSILON = 1e-6;

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -EPSILON && value <= 1 + EPSILON;

/**
 * Reads the optional `crop` form field: a JSON {x, y, width, height} of
 * fractions in 0..1. Absent or empty means "no crop"; anything else that does
 * not describe a non-empty zone inside the image is rejected.
 */
export function parseLogoCrop(raw: unknown): LogoCropRect | null {
  if (raw === null || raw === undefined || raw === '') return null;

  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Invalid logo crop: not valid JSON');
    }
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid logo crop: expected an object');
  }

  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isFraction(x) || !isFraction(y) || !isFraction(width) || !isFraction(height)) {
    throw new Error('Invalid logo crop: x, y, width and height must be fractions between 0 and 1');
  }
  if (width <= EPSILON || height <= EPSILON || x + width > 1 + EPSILON || y + height > 1 + EPSILON) {
    throw new Error('Invalid logo crop: zone must be non-empty and inside the image');
  }

  return { x, y, width, height };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Turns a fractional crop into an integer pixel rectangle that always lies
 * inside a width x height image and is never empty, so `extract` cannot throw
 * on a rounding overshoot.
 */
export function resolveCropPixels(
  crop: LogoCropRect,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(crop.x * imageWidth), 0, Math.max(imageWidth - 1, 0));
  const top = clamp(Math.round(crop.y * imageHeight), 0, Math.max(imageHeight - 1, 0));
  const width = clamp(Math.round(crop.width * imageWidth), 1, Math.max(imageWidth - left, 1));
  const height = clamp(Math.round(crop.height * imageHeight), 1, Math.max(imageHeight - top, 1));
  return { left, top, width, height };
}

// Only the surface of sharp this module touches, so tests can hand in a stub.
export interface SharpLike {
  (input: Buffer, options?: { density?: number }): SharpPipelineLike;
}
export interface SharpPipelineLike {
  metadata(): Promise<{ width?: number; height?: number; orientation?: number }>;
  rotate(): SharpPipelineLike;
  extract(region: { left: number; top: number; width: number; height: number }): SharpPipelineLike;
  resize(width: number, height: number, options: Record<string, unknown>): SharpPipelineLike;
  webp(options: Record<string, unknown>): SharpPipelineLike;
  toBuffer(): Promise<Buffer>;
}

/**
 * Cuts the chosen square zone out of a logo and renders it as a 256px WebP,
 * the same footprint avatars get. SVGs are rasterized large enough to stay
 * crisp; EXIF-rotated photos are oriented first so the fractions the browser
 * measured on the displayed image line up with the pixels we cut.
 */
export async function renderSquareMark(
  sharp: SharpLike,
  buffer: Buffer,
  crop: LogoCropRect,
  isSvg: boolean,
): Promise<Buffer> {
  let source: SharpPipelineLike;
  if (isSvg) {
    const intrinsic = await sharp(buffer).metadata();
    const longEdge = Math.max(intrinsic.width ?? 0, intrinsic.height ?? 0);
    const density = longEdge > 0
      ? Math.round(SVG_DEFAULT_DENSITY * (SVG_RENDER_DIMENSION / longEdge))
      : SVG_DEFAULT_DENSITY;
    source = sharp(buffer, { density: Math.max(SVG_DEFAULT_DENSITY, density) });
  } else {
    source = sharp(buffer);
  }

  const meta = await source.metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error('Could not read image dimensions for logo crop');
  }
  // metadata() reports stored dimensions; orientations 5-8 swap them once rotated.
  if ((meta.orientation ?? 1) >= 5) {
    [width, height] = [height, width];
  }

  const region = resolveCropPixels(crop, width, height);

  return source
    .rotate()
    .extract(region)
    .resize(SQUARE_MARK_DIMENSION, SQUARE_MARK_DIMENSION, { fit: 'cover' })
    .webp({ quality: 85 })
    .toBuffer();
}
