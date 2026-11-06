import {
  AMP_ALLOWLISTED_TABLES,
  AMP_TABLE_COLUMNS,
  type AmpManifest,
  type AmpTable,
} from '@alga-psa/migration-spec';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPackageDatabase, type SqliteDatabase } from './sqlite';
import { createAmpTemporaryDirectory } from './temporary';

export class AmpPackageStructureError extends Error {
  constructor(message: string, readonly code: 'AMP_INVALID_PACKAGE_STRUCTURE' | 'AMP_LIMIT_EXCEEDED' | 'AMP_HASH_MISMATCH' = 'AMP_INVALID_PACKAGE_STRUCTURE') {
    super(message);
    this.name = 'AmpPackageStructureError';
  }
}

/**
 * Read-only access to an AMP package. All queries are parameterized SELECTs
 * over allowlisted tables and columns; nothing package-supplied is executed.
 */
export class AmpSqliteReader {
  private readonly db: SqliteDatabase;
  private readonly stagingDirectory?: string;
  private readonly attachmentFiles = new Map<string, string>();
  private readonly packagePath: string;

  constructor(path: string) {
    if (statSync(path).size > 1024 * 1024 * 1024) throw new AmpPackageStructureError('AMP compressed package limit exceeded', 'AMP_LIMIT_EXCEEDED');
    const input = readFileSync(path);
    if (input.subarray(0, 4).toString('hex') !== '504b0304') {
      throw new AmpPackageStructureError('AMP 2 packages must be ZIP archives containing data.sqlite');
    }
    const zip = new AdmZip(input);
    const entries = zip.getEntries();
    if (entries.length === 0 || entries.length > 50_000) throw new AmpPackageStructureError('AMP ZIP entry limit exceeded', 'AMP_LIMIT_EXCEEDED');
    const names = new Set<string>();
    let expandedBytes = 0;
    let sqliteBytes: Buffer | undefined;
    const rawAttachments: Array<{ path: string; bytes: Buffer }> = [];
    for (const entry of entries) {
      const name = entry.entryName;
      if (entry.isDirectory) throw new AmpPackageStructureError(`AMP ZIP directories are not allowed: ${name}`);
      const unixType = (entry.header.attr >>> 16) & 0o170000;
      if (entry.header.encrypted || ![0, 8].includes(entry.header.method) || unixType === 0o120000 ||
          !Number.isSafeInteger(entry.header.compressedSize) || entry.header.compressedSize < 0 || entry.header.compressedSize > 1024 * 1024 * 1024 ||
          !entry.rawEntryName.equals(Buffer.from(name, 'utf8'))) {
        throw new AmpPackageStructureError(`Unsupported or unsafe AMP ZIP entry metadata: ${name}`);
      }
      if (names.has(name)) throw new AmpPackageStructureError(`Duplicate AMP ZIP entry: ${name}`);
      names.add(name);
      if (name.includes('\\') || name.startsWith('/') || name.split('/').some((part) => part === '.' || part === '..' || part.length === 0)) {
        throw new AmpPackageStructureError(`Unsafe AMP ZIP entry path: ${name}`);
      }
      if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 || entry.header.size > 100 * 1024 * 1024 && name !== 'data.sqlite') {
        throw new AmpPackageStructureError(`AMP ZIP entry declared size is invalid: ${name}`, 'AMP_LIMIT_EXCEEDED');
      }
      expandedBytes += entry.header.size;
      if (expandedBytes > 1024 * 1024 * 1024) throw new AmpPackageStructureError('AMP expanded package limit exceeded', 'AMP_LIMIT_EXCEEDED');
      if (name === 'data.sqlite') {
        sqliteBytes = entry.getData();
        if (sqliteBytes.length !== entry.header.size) throw new AmpPackageStructureError('AMP ZIP declared size mismatch', 'AMP_LIMIT_EXCEEDED');
      } else if (/^attachments\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(name)) {
        const bytes = entry.getData();
        if (bytes.length !== entry.header.size) throw new AmpPackageStructureError('AMP ZIP declared size mismatch', 'AMP_LIMIT_EXCEEDED');
        const digest = name.split('/')[2];
        if (digest.slice(0, 2) !== name.split('/')[1] || createHash('sha256').update(bytes).digest('hex') !== digest) {
          throw new AmpPackageStructureError(`AMP attachment content digest mismatch: ${digest}`, 'AMP_HASH_MISMATCH');
        }
        rawAttachments.push({ path: name, bytes });
      } else {
        throw new AmpPackageStructureError(`Unsupported AMP ZIP entry: ${name}`);
      }
    }
    if (!sqliteBytes) throw new AmpPackageStructureError('AMP ZIP is missing data.sqlite');
    this.stagingDirectory = createAmpTemporaryDirectory('reader');
    this.packagePath = join(this.stagingDirectory, 'data.sqlite');
    try {
      writeFileSync(this.packagePath, sqliteBytes, { flag: 'wx', mode: 0o600 });
      for (const { path: entryPath, bytes } of rawAttachments) {
        const digest = entryPath.split('/')[2];
        const filePath = join(this.stagingDirectory, digest);
        writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
        this.attachmentFiles.set(digest, filePath);
      }
      this.db = openPackageDatabase(this.packagePath);
    } catch (error) {
      rmSync(this.stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  attachmentPath(sha256: string): string | undefined { return this.attachmentFiles.get(sha256); }
  attachmentDigests(): string[] { return [...this.attachmentFiles.keys()].sort(); }

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
    if (this.stagingDirectory) rmSync(this.stagingDirectory, { recursive: true, force: true });
  }

  private assertAllowlisted(table: string): asserts table is AmpTable {
    if (!(AMP_ALLOWLISTED_TABLES as readonly string[]).includes(table)) {
      throw new Error(`Table "${table}" is not an allowlisted AMP table`);
    }
  }
}
