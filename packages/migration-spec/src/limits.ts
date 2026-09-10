/**
 * AMP security limits. Validators enforce these defaults; deployments may
 * lower them but must never raise the structural ones silently.
 */

export interface AmpLimits {
  /** Maximum package file size in bytes. */
  packageBytes: number;
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
  packageBytes: 250 * 1024 * 1024,
  rowsPerEntity: 500_000,
  rowsPerPackage: 2_000_000,
  textBytes: 64 * 1024,
  extensionJsonBytes: 16 * 1024,
  extensionJsonDepth: 8,
  opaqueIdBytes: 256,
};

/** Retention defaults, enforced server-side rather than by the validator. */
export const AMP_RETENTION = {
  sourcePackageDays: 30,
  reportDays: 90,
} as const;
