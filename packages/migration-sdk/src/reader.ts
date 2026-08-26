import {
  AMP_ALLOWLISTED_TABLES,
  AMP_TABLE_COLUMNS,
  type AmpManifest,
  type AmpTable,
} from '@alga-psa/migration-spec';
import { openPackageDatabase, type SqliteDatabase } from './sqlite';

/**
 * Read-only access to an AMP package. All queries are parameterized SELECTs
 * over allowlisted tables and columns; nothing package-supplied is executed.
 */
export class AmpSqliteReader {
  private readonly db: SqliteDatabase;

  constructor(path: string) {
    this.db = openPackageDatabase(path);
  }

  /** Names of every table present in the file, from sqlite_master. */
  tableNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /** @deprecated compatibility alias for the Phase 1 reader seam. */
  tables(): string[] { return this.tableNames(); }

  /** Any triggers or views present in the file. A conforming package has none. */
  forbiddenObjects(): Array<{ name: string; type: string }> {
    return this.db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view') ORDER BY name")
      .all() as Array<{ name: string; type: string }>;
  }

  /** @deprecated compatibility alias for the Phase 1 reader seam. */
  objects(): Array<{ name: string; type: string }> { return this.forbiddenObjects(); }

  /** Column names of a table in the file, via the pragma table-valued function. */
  columnNames(table: string): string[] {
    const rows = this.db
      .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
      .all(table) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /** Every manifest row. A conforming package has exactly one. */
  manifestRows(): AmpManifest[] {
    this.assertAllowlisted('amp_manifest');
    return this.db.prepare('SELECT * FROM amp_manifest').all() as AmpManifest[];
  }

  /** @deprecated compatibility alias for the Phase 1 reader seam. */
  manifests(): AmpManifest[] { return this.manifestRows(); }

  rowCount(table: AmpTable): number {
    this.assertAllowlisted(table);
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    return Number(row.count);
  }

  /** One batch of rows, ordered by package_record_id for determinism. */
  readBatch(table: AmpTable, limit: number, offset: number): Record<string, unknown>[] {
    this.assertAllowlisted(table);
    const columns = AMP_TABLE_COLUMNS[table].join(', ');
    return this.db
      .prepare(`SELECT ${columns} FROM ${table} ORDER BY package_record_id LIMIT ? OFFSET ?`)
      .all(limit, offset) as Record<string, unknown>[];
  }

  /** Iterate a table in bounded batches. */
  *readRows(table: AmpTable, batchSize = 1000): Generator<Record<string, unknown>> {
    let offset = 0;
    for (;;) {
      const batch = this.readBatch(table, batchSize, offset);
      if (batch.length === 0) {
        return;
      }
      yield* batch;
      if (batch.length < batchSize) {
        return;
      }
      offset += batch.length;
    }
  }

  /** All rows of a table. Prefer readRows for large tables. */
  allRows(table: AmpTable): Record<string, unknown>[] {
    return [...this.readRows(table)];
  }

  /** @deprecated compatibility alias for the Phase 1 reader seam. */
  rows(table: AmpTable): Record<string, unknown>[] { return this.allRows(table); }

  close(): void {
    this.db.close();
  }

  private assertAllowlisted(table: string): asserts table is AmpTable {
    if (!(AMP_ALLOWLISTED_TABLES as readonly string[]).includes(table)) {
      throw new Error(`Table "${table}" is not an allowlisted AMP table`);
    }
  }
}
