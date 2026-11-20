export const DEFAULT_MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

const IMAGE_MIME_PREFIX = 'image/';
const FALLBACK_IMAGE_EXTENSION = 'png';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function isClipboardImageMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return mimeType.toLowerCase().startsWith(IMAGE_MIME_PREFIX);
}

export function extractClipboardImageFiles(
  items: ArrayLike<{
    kind?: string;
    type?: string;
    getAsFile?: () => File | null;
  }>
): File[] {
  const files: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind !== 'file') continue;
    if (!isClipboardImageMimeType(item.type)) continue;
    const file = item.getAsFile?.() ?? null;
    if (!file) continue;
    files.push(file);
  }
  return files;
}

export function fileExtensionForImageMimeType(mimeType: string | null | undefined): string {
  if (!isClipboardImageMimeType(mimeType)) return FALLBACK_IMAGE_EXTENSION;
  const normalized = String(mimeType).toLowerCase();
  const slashIndex = normalized.indexOf('/');
  if (slashIndex < 0 || slashIndex === normalized.length - 1) return FALLBACK_IMAGE_EXTENSION;

  const subtype = normalized.slice(slashIndex + 1).split(';')[0]?.trim() || '';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (!subtype) return FALLBACK_IMAGE_EXTENSION;
  return subtype;
}

export function createClipboardImageFilename(params: {
  timestamp: Date;
  sequence: number;
  mimeType?: string | null;
}): string {
  const { timestamp, sequence, mimeType } = params;
  const extension = fileExtensionForImageMimeType(mimeType);

  const yyyy = timestamp.getUTCFullYear();
  const mm = pad(timestamp.getUTCMonth() + 1);
  const dd = pad(timestamp.getUTCDate());
  const hh = pad(timestamp.getUTCHours());
  const min = pad(timestamp.getUTCMinutes());
  const ss = pad(timestamp.getUTCSeconds());
  const seq = String(sequence).padStart(3, '0');

  return `clipboard-image-${yyyy}${mm}${dd}-${hh}${min}${ss}-${seq}.${extension}`;
}

export function renameClipboardImageForUpload(params: {
  file: File;
  timestamp: Date;
  sequence: number;
}): File {
  const { file, timestamp, sequence } = params;
  const fileName = createClipboardImageFilename({
    timestamp,
    sequence,
    mimeType: file.type,
  });

  return new File([file], fileName, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

export function validateClipboardImageFile(
  file: Pick<File, 'type' | 'size'>,
  maxBytes = DEFAULT_MAX_CLIPBOARD_IMAGE_BYTES
): { valid: boolean; error?: string } {
  if (!isClipboardImageMimeType(file.type)) {
    return {
      valid: false,
      error: 'Only image clipboard content can be attached to ticket comments.',
    };
  }

  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `Clipboard image exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB upload limit.`,
    };
  }

  return { valid: true };
}
