const INVALID_FILENAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g;
const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_FILENAME_BASE_LENGTH = 150;

const sanitizeBaseName = (name: string): string => name
  .trim()
  .replace(INVALID_FILENAME_CHARACTERS, '')
  .replace(/\s+/g, ' ')
  .replace(/[. ]+$/g, '')
  .replace(/(?:\.pdf)+$/i, '')
  .replace(/[. ]+$/g, '');

const isWindowsReservedBasename = (name: string): boolean =>
  WINDOWS_RESERVED_BASENAME.test(name);

/** Build a portable PDF filename from a user-provided document title. */
export const buildDocumentFileName = (
  preferredName: string | null | undefined,
  fallbackBase: string,
  extension = 'pdf',
): string => {
  const normalizedExtension = extension.replace(/^\.+/, '');
  const preferredBase = sanitizeBaseName(preferredName ?? '');
  const fallback = sanitizeBaseName(fallbackBase);
  let base = preferredBase && !isWindowsReservedBasename(preferredBase)
    ? preferredBase
    : fallback;

  if (!base) {
    base = 'document';
  }

  if (isWindowsReservedBasename(base)) {
    base = `${base}_file`;
  }

  // Array.from counts Unicode code points, so truncation never splits a surrogate pair.
  base = Array.from(base).slice(0, MAX_FILENAME_BASE_LENGTH).join('').replace(/[. ]+$/g, '');
  return `${base}.${normalizedExtension}`;
};
