/**
 * Every tunable of the attachment content engine, in one place. The V1-V5 client verification
 * (plan section 6) tunes these; nothing else in the engine hard-codes a number.
 */
export const KIB = 1024;
export const MIB = 1024 * 1024;

export interface ContentBudget {
  /** Image blocks per call (photos + rendered pages). */
  maxImages: number;
  /** Base64 length of images + embedded blobs per call. */
  maxEncodedBytes: number;
  /** Characters of text body per call (labels excluded). */
  maxTextChars: number;
  /** Packing-time deadline per call, in ms. */
  deadlineMs: number;
}

export const DEFAULT_BUDGET: ContentBudget = {
  maxImages: 8,
  maxEncodedBytes: 4 * MIB,
  maxTextChars: 60_000,
  deadlineMs: 20_000,
};

export const LIMITS = {
  /** Text unit size: split at line boundaries, never larger. */
  textChunkChars: 60_000,
  /** Safety valve: a single document never yields more than this much text. */
  maxDocumentTextChars: 3_000_000,

  imageMaxEdgePx: 1568,
  imageResizeAboveBytes: 1 * MIB,
  imageJpegQuality: 80,
  imageLimitInputPixels: 100_000_000,

  /** PDFs bigger than this are never opened (pdf.js needs the whole buffer). */
  maxPdfBytes: 50 * MIB,
  /** The original PDF travels as a blob only up to this size (about 2 MiB as base64). */
  pdfEmbedOriginalMaxBytes: 1.5 * MIB,
  /** Set false to stop sending PDF blobs (verification fallback V2). */
  pdfEmbedOriginal: true,
  /** A page with fewer non-whitespace characters than this has no usable text layer. */
  pdfMinTextChars: 16,
  pdfRenderDpi: 150,
  pdfRenderTimeoutMs: 10_000,

  /** Per-type input caps, checked against documents.file_size before any download. */
  maxImageBytes: 50 * MIB,
  maxDocxBytes: 20 * MIB,
  maxTextBytes: 10 * MIB,
  /** Any other file: above this it is never downloaded (it can only fall back anyway). */
  maxAnyFileBytes: 50 * MIB,
} as const;

/** Dev-only override (verification V3): ATTACHMENT_CONTENT_BUDGET_OVERRIDE='{"maxEncodedBytes":8388608}'. */
export function resolveBudget(env: NodeJS.ProcessEnv = process.env): ContentBudget {
  const raw = env.ATTACHMENT_CONTENT_BUDGET_OVERRIDE;
  if (!raw || env.NODE_ENV === 'production') return { ...DEFAULT_BUDGET };
  try {
    const parsed = JSON.parse(raw) as Partial<ContentBudget>;
    const out = { ...DEFAULT_BUDGET };
    for (const key of Object.keys(DEFAULT_BUDGET) as Array<keyof ContentBudget>) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_BUDGET };
  }
}

export type LimitName = 'max_images' | 'max_encoded_bytes' | 'max_text_chars' | 'deadline';
