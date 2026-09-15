/**
 * Closed set of error codes the migration upload routes may return. The routes
 * emit only these; the upload dialog maps each to localized copy. Keeping the
 * set in one module stops a raw storage or engine string from leaking into the
 * browser and keeps the two routes and the UI in lockstep.
 */
export const MIGRATION_UPLOAD_ERROR_CODES = [
  'IMPORT_EXPORT_PERMISSION_DENIED',
  'AMP_SPREADSHEET_INVALID',
  'AMP_NOT_SQLITE',
  'AMP_LIMIT_EXCEEDED',
  'AMP_UPLOAD_SIZE_MISMATCH',
  'AMP_SPREADSHEET_NO_RECOGNIZED_HEADERS',
  'AMP_PACKAGE_NO_IMPORTABLE_RECORDS',
  'AMP_STORAGE_REJECTED',
  'AMP_SPREADSHEET_FAILED',
  'AMP_UPLOAD_FAILED',
] as const;

export type MigrationUploadErrorCode = (typeof MIGRATION_UPLOAD_ERROR_CODES)[number];

const MIGRATION_UPLOAD_ERROR_CODE_SET: ReadonlySet<string> = new Set(MIGRATION_UPLOAD_ERROR_CODES);

/** True when a thrown error's message is one of the route-thrown codes. */
export function isMigrationUploadErrorCode(value: string): value is MigrationUploadErrorCode {
  return MIGRATION_UPLOAD_ERROR_CODE_SET.has(value);
}

/**
 * Storage-layer rejections get their own code so a genuinely misconfigured
 * deployment is diagnosable from the response without reading pod logs. The
 * message text is the storage layer's own wording; it never reaches the client.
 */
export function isStorageRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('File type not allowed') || message.includes('File size exceeds limit of ');
}

/**
 * Map a thrown error to a code from the closed set. A route-thrown code passes
 * through, a storage rejection becomes `AMP_STORAGE_REJECTED`, and anything
 * else becomes the route's generic code.
 */
export function migrationUploadErrorCode(
  error: unknown,
  genericCode: Extract<MigrationUploadErrorCode, 'AMP_SPREADSHEET_FAILED' | 'AMP_UPLOAD_FAILED'>
): MigrationUploadErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (isMigrationUploadErrorCode(message)) {
    return message;
  }
  if (isStorageRejection(error)) {
    return 'AMP_STORAGE_REJECTED';
  }
  return genericCode;
}

/** Log an unrecognized (or storage-layer) throw with tenant and route context. */
export function logMigrationUploadFailure(route: string, tenant: string | undefined, error: unknown): void {
  console.error(`[migrations] ${route} failed for tenant ${tenant ?? 'unknown'}`, error);
}
