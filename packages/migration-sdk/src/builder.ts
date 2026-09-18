import {
  AMP_ALLOWLISTED_TABLES,
  AMP_ENTITY_TABLES,
  AMP_SCHEMA_SQL,
  AMP_TABLE_COLUMNS,
  type AmpManifest,
  type AmpPackageRows,
  type AmpTable,
} from '@alga-psa/migration-spec';
import { openWritableDatabase } from './sqlite';
import { canonicalContentSha256 } from './hash';

export type AmpManifestInput = Omit<AmpManifest, 'content_sha256'>;

/**
 * Produce a conforming AMP package file. Table and column names come only
 * from the spec allowlists — caller data supplies values, never identifiers.
 */
export class AmpPackageBuilder {
  constructor(private readonly path: string) {}

  write(manifest: AmpManifestInput, rows: AmpPackageRows): AmpManifest {
    for (const table of Object.keys(rows)) {
      if (!(AMP_ALLOWLISTED_TABLES as readonly string[]).includes(table) || table === 'amp_manifest') {
        throw new Error(`Cannot write non-allowlisted table "${table}" into an AMP package`);
      }
    }

    const entityRows: Partial<Record<string, ReadonlyArray<Record<string, unknown>>>> = {};
    for (const table of AMP_ENTITY_TABLES) {
      entityRows[table] = (rows[table] ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
    }
    const completedManifest: AmpManifest = {
      ...manifest,
      content_sha256: canonicalContentSha256(entityRows),
    };

    const db = openWritableDatabase(this.path);
    try {
      db.exec(AMP_SCHEMA_SQL);
      this.insertRow(db, 'amp_manifest', completedManifest as unknown as Record<string, unknown>);
      for (const [table, tableRows] of Object.entries(rows)) {
        for (const row of tableRows ?? []) {
          this.insertRow(db, table as AmpTable, row as Record<string, unknown>);
        }
      }
      return completedManifest;
    } finally {
      db.close();
    }
  }

  private insertRow(
    db: ReturnType<typeof openWritableDatabase>,
    table: AmpTable,
    row: Record<string, unknown>
  ): void {
    const allowedColumns = AMP_TABLE_COLUMNS[table];
    for (const column of Object.keys(row)) {
      if (!allowedColumns.includes(column)) {
        throw new Error(`Column "${column}" is not allowlisted for AMP table "${table}"`);
      }
    }
    const columns = allowedColumns.filter((column) => row[column] !== undefined);
    const placeholders = columns.map(() => '?').join(', ');
    const statement = db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
    );
    statement.run(...columns.map((column) => row[column] ?? null));
  }
}
