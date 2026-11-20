import { LIMITS } from './limits';

async function loadSharp() {
  const mod = await import('sharp');
  return (mod as any).default ?? (mod as any);
}

export interface NormalizedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  scaled: boolean;
  passthrough: boolean;
  sourceMime: string | null;
}

const CLIENT_NATIVE: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/**
 * Decode with sharp (decompression-bomb guard), apply EXIF orientation, strip metadata, and bound the
 * result: long edge <= 1568 px and <= 1 MiB. Already-small client-native formats pass through unchanged.
 * Everything else is re-encoded as JPEG q80, or PNG when the source has alpha. Throws when sharp cannot
 * decode the file; the caller turns that into a fallback.
 */
export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  const sharp = await loadSharp();
  const open = () => sharp(input, { limitInputPixels: LIMITS.imageLimitInputPixels, failOn: 'error' });

  const meta = await open().metadata();
  if (!meta.width || !meta.height) throw new Error('image has no dimensions');
  const swap = (meta.orientation ?? 1) >= 5;
  const sourceWidth = swap ? meta.height : meta.width;
  const sourceHeight = swap ? meta.width : meta.height;
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const oversized = longEdge > LIMITS.imageMaxEdgePx || input.length > LIMITS.imageResizeAboveBytes;
  const nativeMime = meta.format ? CLIENT_NATIVE[meta.format] : undefined;
  const needsOrientation = (meta.orientation ?? 1) > 1;

  if (nativeMime && !oversized && !needsOrientation) {
    return {
      data: input,
      mimeType: nativeMime,
      width: sourceWidth,
      height: sourceHeight,
      sourceWidth,
      sourceHeight,
      scaled: false,
      passthrough: true,
      sourceMime: nativeMime,
    };
  }

  // rotate() applies the EXIF orientation; metadata is dropped unless withMetadata() is called.
  let pipeline = open().rotate().resize({
    width: LIMITS.imageMaxEdgePx,
    height: LIMITS.imageMaxEdgePx,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const hasAlpha = Boolean(meta.hasAlpha);
  pipeline = hasAlpha ? pipeline.png() : pipeline.jpeg({ quality: LIMITS.imageJpegQuality });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    data,
    mimeType: hasAlpha ? 'image/png' : 'image/jpeg',
    width: info.width,
    height: info.height,
    sourceWidth,
    sourceHeight,
    scaled: info.width !== sourceWidth || info.height !== sourceHeight,
    passthrough: false,
    sourceMime: nativeMime ?? null,
  };
}
