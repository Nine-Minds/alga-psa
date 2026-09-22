import type { LogoCropRect } from '@alga-psa/types';

export type { LogoCropRect };

/** Square marks are stored at the same size as avatars so every circle reads them alike. */
export const SQUARE_MARK_DIMENSION = 256;

// How far past the image a crop may reach, in multiples of the image's size.
// The dialog zooms out to 0.5x, so a zone can be twice the image on one axis
// and offset by up to one image-length; anything beyond that is not a crop.
const MAX_OVERHANG = 3;

// Rasterized SVG sources are rendered to roughly this long edge before the cut.
const SVG_RENDER_DIMENSION = 1024;
const SVG_DEFAULT_DENSITY = 72;
const EPSILON = 1e-6;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const isInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min - EPSILON && value <= max + EPSILON;

/**
 * Reads the optional `crop` form field: a JSON {x, y, width, height} in
 * fractions of the source image. The zone may reach past the image (the user
 * zoomed out to leave space around the mark), but it must still overlap it.
 * Absent or empty means "no crop"; anything else that is not such a zone is
 * rejected.
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
  if (
    !isInRange(x, -MAX_OVERHANG, MAX_OVERHANG) ||
    !isInRange(y, -MAX_OVERHANG, MAX_OVERHANG) ||
    !isInRange(width, 0, MAX_OVERHANG) ||
    !isInRange(height, 0, MAX_OVERHANG)
  ) {
    throw new Error('Invalid logo crop: x, y, width and height must be fractions of the image');
  }
  if (width <= EPSILON || height <= EPSILON) {
    throw new Error('Invalid logo crop: zone must be non-empty');
  }
  if (x >= 1 - EPSILON || y >= 1 - EPSILON || x + width <= EPSILON || y + height <= EPSILON) {
    throw new Error('Invalid logo crop: zone must overlap the image');
  }

  return { x, y, width, height };
}

export interface CropPixels {
  /** Zone to extract, in pixels of the padded image. */
  region: { left: number; top: number; width: number; height: number };
  /** Transparent padding to add on each side before extracting; all zero when the zone lies inside. */
  extend: { left: number; top: number; right: number; bottom: number };
}

/**
 * Turns a fractional crop into an integer pixel rectangle over a width x
 * height image. A zone reaching past the image becomes transparent padding on
 * that side, so `extract` always cuts from inside the (padded) canvas and is
 * never empty.
 */
export function resolveCropPixels(crop: LogoCropRect, imageWidth: number, imageHeight: number): CropPixels {
  const left = Math.round(crop.x * imageWidth);
  const top = Math.round(crop.y * imageHeight);
  const width = Math.max(Math.round(crop.width * imageWidth), 1);
  const height = Math.max(Math.round(crop.height * imageHeight), 1);

  const extend = {
    left: Math.max(-left, 0),
    top: Math.max(-top, 0),
    right: Math.max(left + width - imageWidth, 0),
    bottom: Math.max(top + height - imageHeight, 0),
  };

  return {
    region: { left: left + extend.left, top: top + extend.top, width, height },
    extend,
  };
}

// Only the surface of sharp this module touches, so tests can hand in a stub.
export interface SharpLike {
  (input: Buffer, options?: { density?: number }): SharpPipelineLike;
}
export interface SharpPipelineLike {
  metadata(): Promise<{ width?: number; height?: number; orientation?: number }>;
  rotate(): SharpPipelineLike;
  ensureAlpha(): SharpPipelineLike;
  extend(options: { left: number; top: number; right: number; bottom: number; background: typeof TRANSPARENT }): SharpPipelineLike;
  png(): SharpPipelineLike;
  extract(region: { left: number; top: number; width: number; height: number }): SharpPipelineLike;
  resize(width: number, height: number, options: Record<string, unknown>): SharpPipelineLike;
  webp(options: Record<string, unknown>): SharpPipelineLike;
  toBuffer(): Promise<Buffer>;
}

/**
 * Cuts the chosen square zone out of a logo and renders it as a 256px WebP,
 * the same footprint avatars get. SVGs are rasterized large enough to stay
 * crisp; EXIF-rotated photos are oriented first so the fractions the browser
 * measured on the displayed image line up with the pixels we cut. Where the
 * zone reaches past the image, the mark gets transparent padding.
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

  const { region, extend } = resolveCropPixels(crop, width, height);
  let oriented = source.rotate();
  if (extend.left || extend.top || extend.right || extend.bottom) {
    // sharp always pads after extracting, so the padded canvas is materialized
    // first (as PNG: a JPEG would flatten the transparent margin to black).
    const padded = await oriented.ensureAlpha().extend({ ...extend, background: TRANSPARENT }).png().toBuffer();
    oriented = sharp(padded);
  }

  return oriented
    .extract(region)
    .resize(SQUARE_MARK_DIMENSION, SQUARE_MARK_DIMENSION, { fit: 'cover' })
    .webp({ quality: 85 })
    .toBuffer();
}
