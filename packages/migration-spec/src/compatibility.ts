/**
 * AMP format versioning. Additive changes (new optional columns or tables)
 * bump the minor version; any breaking semantic change bumps the major
 * version. A consumer accepts a documented range and reports exactly why a
 * version is refused.
 */

export const AMP_FORMAT_VERSION = '1.0.0';

export const AMP_COMPATIBILITY = {
  /** Format major version this implementation understands. */
  supportedMajor: 1,
  /** Highest minor version this implementation understands within the major. */
  supportedMinor: 0,
} as const;

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseFormatVersion(
  version: string
): { major: number; minor: number; patch: number } | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * A package is supported when its major version matches and its minor version
 * is not newer than what this implementation understands. Patch versions never
 * affect compatibility.
 */
export function isSupportedFormatVersion(version: string): boolean {
  const parsed = parseFormatVersion(version);
  if (!parsed) {
    return false;
  }
  return (
    parsed.major === AMP_COMPATIBILITY.supportedMajor &&
    parsed.minor <= AMP_COMPATIBILITY.supportedMinor
  );
}

export function unsupportedVersionReason(version: string): string {
  const parsed = parseFormatVersion(version);
  if (!parsed) {
    return `Format version "${version}" is not a semantic version.`;
  }
  if (parsed.major !== AMP_COMPATIBILITY.supportedMajor) {
    return `Format major version ${parsed.major} is not supported; this consumer supports major version ${AMP_COMPATIBILITY.supportedMajor}.`;
  }
  return `Format version ${version} is newer than the highest supported ${AMP_COMPATIBILITY.supportedMajor}.${AMP_COMPATIBILITY.supportedMinor}.x.`;
}
