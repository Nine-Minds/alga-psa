import { createHash } from 'node:crypto';
import { AMP_ENTITY_TABLES } from '@alga-psa/migration-spec';

/**
 * Canonical content hash of a package.
 *
 * Definition (normative, mirrored in docs/reference/amp/spec.md):
 * - Only the six canonical entity tables participate; the manifest and
 *   auxiliary tables are excluded so the hash is never self-referential.
 * - Tables are processed in ascending table-name order; rows in ascending
 *   `package_record_id` order (code-point comparison).
 * - Each row serializes as JSON with keys sorted ascending and null/undefined
 *   values omitted; numbers serialize per JSON; strings are unnormalized.
 * - Each serialized row is prefixed with `<table>:` and rows are joined with
 *   `\n`. The SHA-256 hex digest of the UTF-8 bytes is `content_sha256`.
 */
export function canonicalContentSha256(
  entityRows: Partial<Record<string, ReadonlyArray<Record<string, unknown>>>>
): string {
  const lines: string[] = [];
  const tables = [...AMP_ENTITY_TABLES].sort();
  for (const table of tables) {
    const rows = entityRows[table] ?? [];
    const sorted = [...rows].sort((a, b) =>
      String(a.package_record_id) < String(b.package_record_id)
        ? -1
        : String(a.package_record_id) > String(b.package_record_id)
          ? 1
          : 0
    );
    for (const row of sorted) {
      const entries = Object.entries(row)
        .filter(([, value]) => value !== null && value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      lines.push(`${table}:${JSON.stringify(Object.fromEntries(entries))}`);
    }
  }
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
