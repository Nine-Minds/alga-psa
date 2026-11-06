import {
  AMP_ALLOWLISTED_TABLES,
  AMP_ENTITY_TABLES,
  AMP_SCHEMA_SQL,
  AMP_TABLE_COLUMNS,
  AMP_LIMITS,
  type AmpManifest,
  type AmpPackageRows,
  type AmpTable,
} from '@alga-psa/migration-spec';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openWritableDatabase } from './sqlite';
import { canonicalContentSha256 } from './hash';
import { createAmpTemporaryDirectory } from './temporary';

export type AmpManifestInput = Omit<AmpManifest, 'content_sha256'>;

export interface AmpAttachmentInput { sha256: string; size: number; filePath: string }

export function canonicalAttachmentsSha256(rows: readonly { sha256: string; size: number }[]): string {
  const unique = new Map<string, number>();
  for (const row of rows) {
    const prior = unique.get(row.sha256);
    if (prior !== undefined && prior !== row.size) throw new Error('Duplicate attachment digest has conflicting sizes');
    unique.set(row.sha256, row.size);
  }
  const canonical = [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([sha, size]) => `${sha}\t${size}\n`).join('');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Produce a conforming AMP package file. Table and column names come only
 * from the spec allowlists — caller data supplies values, never identifiers.
 */
export class AmpPackageBuilder {
  constructor(private readonly path: string) {}

  write(manifest: AmpManifestInput, rows: AmpPackageRows, attachments: readonly AmpAttachmentInput[] = []): AmpManifest {
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
      attachments_sha256: canonicalAttachmentsSha256((rows.attachments ?? []).map(({ sha256, size }) => ({ sha256, size }))),
    };

    const staging = createAmpTemporaryDirectory('package');
    const databasePath = join(staging, 'data.sqlite');
    const db = openWritableDatabase(databasePath);
    try {
      db.exec(AMP_SCHEMA_SQL);
      this.insertRow(db, 'amp_manifest', completedManifest as unknown as Record<string, unknown>);
      for (const [table, tableRows] of Object.entries(rows)) {
        for (const row of tableRows ?? []) {
          this.insertRow(db, table as AmpTable, row as Record<string, unknown>);
        }
      }
      db.close();
      const zip = new AdmZip();
      zip.addLocalFile(databasePath, '');
      const byDigest = new Map<string, AmpAttachmentInput>();
      let expanded = statSync(databasePath).size;
      if (expanded > AMP_LIMITS.packageBytes) throw new Error('AMP package limits exceeded');
      for (const attachment of attachments) {
        if (!/^[a-f0-9]{64}$/.test(attachment.sha256) || !Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > AMP_LIMITS.attachmentBytes) {
          throw new Error('Invalid AMP attachment digest or size');
        }
        const bytes = readFileSync(attachment.filePath);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== attachment.size || digest !== attachment.sha256) throw new Error('AMP attachment bytes do not match their declared digest and size');
        const prior = byDigest.get(digest);
        if (prior && prior.size !== bytes.length) throw new Error('Duplicate attachment digest has conflicting sizes');
        byDigest.set(digest, attachment);
        expanded += bytes.length;
        if (expanded > AMP_LIMITS.packageBytes || zip.getEntries().length >= AMP_LIMITS.zipEntries) throw new Error('AMP package limits exceeded');
        zip.addFile(`attachments/${digest.slice(0, 2)}/${digest}`, bytes);
      }
      const indexed = new Map<string, number>();
      for (const row of rows.attachments ?? []) {
        const previous = indexed.get(row.sha256);
        if (previous !== undefined && previous !== row.size) throw new Error('AMP attachment index declares conflicting sizes');
        indexed.set(row.sha256, row.size);
      }
      if (indexed.size !== byDigest.size || [...indexed].some(([sha, size]) => byDigest.get(sha)?.size !== size)) {
        throw new Error('AMP attachment index and ZIP content do not match');
      }
      zip.writeZip(this.path);
      return completedManifest;
    } finally {
      try { db.close(); } catch { /* already closed after serialization */ }
      rmSync(staging, { recursive: true, force: true });
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
