import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextResponse } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import { MigrationStager } from '@/lib/migrations/MigrationStager';
import { AMP_MAX_PACKAGE_BYTES } from '../upload/route';

export const runtime = 'nodejs';
const ENTITY_TYPES = new Set(['organizations', 'locations', 'contacts', 'tickets', 'ticket_comments', 'assets']);

/** Streams both the browser upload and the converted AMP artifact; request
 * payloads are never materialized as File.arrayBuffer() or a Buffer. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'manage'))) return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  const encodedName = request.headers.get('x-amp-file-name'); const name = encodedName ? decodeURIComponent(encodedName) : '';
  const entityType = request.headers.get('x-amp-entity-type') ?? ''; const declaredSize = Number(request.headers.get('content-length') ?? 0);
  if (!request.body || !name || !ENTITY_TYPES.has(entityType) || !Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > AMP_MAX_PACKAGE_BYTES || !/\.(csv|xlsx)$/i.test(name)) return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 });
  const directory = await mkdtemp(join(tmpdir(), 'amp-spreadsheet-'));
  const inputPath = join(directory, name.toLowerCase().endsWith('.xlsx') ? 'source.xlsx' : 'source.csv');
  const outputPath = join(directory, 'converted.amp');
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > AMP_MAX_PACKAGE_BYTES ? new Error('AMP_LIMIT_EXCEEDED') : null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(request.body as never), meter, createWriteStream(inputPath, { mode: 0o600 }));
    if (bytes !== declaredSize) throw new Error('AMP_UPLOAD_SIZE_MISMATCH');
    const { convertSpreadsheets, inferSpreadsheetMapping } = await import('@alga-psa/migration-connectors/csv'); const mapping = await inferSpreadsheetMapping(inputPath, entityType as never);
    if (Object.keys(mapping).length === 0) throw new Error('AMP_SPREADSHEET_NO_RECOGNIZED_HEADERS');
    const conversion = await convertSpreadsheets({ outputPath, namespace: `csv:${user.tenant}`, sourceSystem: 'csv-upload', files: [{ entityType: entityType as never, path: inputPath, mapping }] }, directory);
    const { size: packageSize } = await stat(outputPath);
    const digest = createHash('sha256'); const storageInput = new PassThrough();
    const packageStream = createReadStream(outputPath); packageStream.on('data', (chunk) => digest.update(chunk));
    const upload = StorageService.uploadStream(user.tenant, storageInput, `${name}.amp`, { mime_type: 'application/vnd.sqlite3', uploaded_by_id: user.user_id, size: packageSize, metadata: { context: 'amp_migration_package', retention_days: 30, converted_from: name } });
    const [stored] = await Promise.all([upload, pipeline(packageStream, storageInput)]); const sha256 = digest.digest('hex');
    const { knex } = await createTenantKnex(user.tenant); const db = tenantDb(knex, user.tenant); const [inserted] = await db.table('migration_jobs').insert({ tenant: user.tenant, owner_user_id: user.user_id, source_file_id: stored.file_id, source_file_name: `${name}.amp`, package_sha256: sha256, state: 'inspecting' }).returning('migration_job_id'); const migrationJobId = inserted.migration_job_id ?? inserted;
    const staged = await new MigrationStager(knex, user.tenant).stage(migrationJobId, outputPath);
    return NextResponse.json({ migrationJobId, state: staged.rejected ? 'rejected' : 'needs_configuration', diagnostics: staged.validation.diagnostics, rowCounts: staged.validation.rowCounts, conversionDiagnostics: conversion.diagnostics }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'AMP_SPREADSHEET_FAILED' }, { status: 400 }); } finally { await rm(directory, { recursive: true, force: true }); }
}
