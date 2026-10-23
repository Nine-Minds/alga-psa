/**
 * Identity namespace for a spreadsheet import, keyed on the uploaded source
 * bytes.
 *
 * `migration_identity_mappings` is unique on (tenant, namespace, entity_type,
 * source_record_id), so the namespace must distinguish sheets. A single
 * per-tenant namespace made every spreadsheet share derived `row-<n>` ids, and
 * a later upload collided with the first one's mappings and silently imported
 * nothing. Hashing the source file keeps re-uploading the identical file
 * idempotent while two different files can never share an identity key. Hash
 * the source bytes, not the converted `.amp`: the package digest depends on the
 * namespace this function derives.
 */
export function spreadsheetImportNamespace(tenant: string, sourceSha256: string): string {
  return `csv:${tenant}:${sourceSha256}`;
}
