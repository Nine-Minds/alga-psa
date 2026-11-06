/**
 * AMP security limits. Validators enforce these defaults; deployments may
 * lower them but must never raise the structural ones silently.
 */

export interface AmpLimits {
  /** Maximum expanded package size in bytes (ZIP metadata + all expanded entries). */
  packageBytes: number;
  /** Maximum expanded size of one attachment. */
  attachmentBytes: number;
  /** Maximum number of ZIP entries, including data.sqlite. */
  zipEntries: number;
  /** Maximum rows in any single entity table. */
  rowsPerEntity: number;
  /** Maximum rows across all entity tables. */
  rowsPerPackage: number;
  /** Maximum byte length of any text value. */
  textBytes: number;
  /** Maximum serialized byte length of extension_json / value_json. */
  extensionJsonBytes: number;
  /** Maximum nesting depth of extension_json / value_json. */
  extensionJsonDepth: number;
  /** Maximum byte length of opaque identifiers (package/source record ids, namespaces). */
  opaqueIdBytes: number;
}

export const AMP_LIMITS: AmpLimits = {
  packageBytes: 1024 * 1024 * 1024,
  attachmentBytes: 100 * 1024 * 1024,
  zipEntries: 50_000,
  rowsPerEntity: 500_000,
  rowsPerPackage: 2_000_000,
  textBytes: 64 * 1024,
  extensionJsonBytes: 16 * 1024,
  extensionJsonDepth: 8,
  opaqueIdBytes: 256,
};

/** Retention defaults, enforced server-side rather than by the validator. */
export const AMP_RETENTION = {
  abandonedPackageHours: 24,
  sourcePackageDays: 30,
  reportDays: 90,
} as const;
