/**
 * Stable AMP validation error codes. Every rejection a validator produces
 * carries one of these codes so producers and operators can act on it without
 * parsing message text.
 */

export type AmpErrorCode =
  | 'AMP_FILE_NOT_FOUND'
  | 'AMP_NOT_SQLITE'
  | 'AMP_UNKNOWN_TABLE'
  | 'AMP_SCHEMA_MISMATCH'
  | 'AMP_FORBIDDEN_SQLITE_OBJECT'
  | 'AMP_EXTENSION_FORBIDDEN'
  | 'AMP_INVALID_MANIFEST'
  | 'AMP_UNSUPPORTED_VERSION'
  | 'AMP_LIMIT_EXCEEDED'
  | 'AMP_INVALID_VALUE'
  | 'AMP_DUPLICATE_RECORD_ID'
  | 'AMP_INVALID_REFERENCE'
  | 'AMP_HASH_MISMATCH'
  | 'AMP_CROSS_TENANT_REFERENCE';

export const AMP_ERROR_CODES: Record<AmpErrorCode, string> = {
  AMP_FILE_NOT_FOUND: 'The package file does not exist or is unreadable.',
  AMP_NOT_SQLITE: 'The file is not a SQLite database.',
  AMP_UNKNOWN_TABLE: 'The package contains a table that AMP does not allow.',
  AMP_SCHEMA_MISMATCH: 'An allowlisted table does not match the AMP column set.',
  AMP_FORBIDDEN_SQLITE_OBJECT:
    'The package contains a trigger or view; AMP packages must contain tables only.',
  AMP_EXTENSION_FORBIDDEN: 'SQLite extensions are forbidden and never loaded.',
  AMP_INVALID_MANIFEST: 'The manifest is missing, duplicated, or incomplete.',
  AMP_UNSUPPORTED_VERSION: 'The package format version is outside the supported range.',
  AMP_LIMIT_EXCEEDED: 'The package exceeds a configured security limit.',
  AMP_INVALID_VALUE: 'A package value does not meet AMP value rules.',
  AMP_DUPLICATE_RECORD_ID: 'A package_record_id is duplicated within its table.',
  AMP_INVALID_REFERENCE: 'A package relationship does not resolve to a package record.',
  AMP_HASH_MISMATCH: 'content_sha256 does not match the canonical package content.',
  AMP_CROSS_TENANT_REFERENCE:
    'The package references a target outside the migration tenant.',
};

/**
 * CLI exit codes. 0 = valid; anything else names the failure class.
 */
export const AMP_CLI_EXIT_CODES = {
  ok: 0,
  invalidPackage: 2,
  ioError: 3,
  usage: 64,
} as const;
