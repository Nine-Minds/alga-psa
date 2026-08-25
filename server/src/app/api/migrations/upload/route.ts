import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import { MigrationStager } from '@/lib/migrations/MigrationStager';

export const runtime = 'nodejs';
export const AMP_MAX_PACKAGE_BYTES = 250 * 1024 * 1024;

/** The browser sends the File as the raw body, rather than multipart FormData,
 * so Next never buffers the package before it reaches this route. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'manage'))) {
    return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  }
  const encodedName = request.headers.get('x-amp-file-name');
  const fileName = encodedName ? decodeURIComponent(encodedName) : '';
  const declaredSizeHeader = request.headers.get('x-amp-file-size');
  const declaredSize = declaredSizeHeader === null ? NaN : Number(declaredSizeHeader);
  if (!fileName || !request.body || declaredSizeHeader === null || !/^\d+$/.test(declaredSizeHeader) || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > AMP_MAX_PACKAGE_BYTES) {
    return NextResponse.json({ error: 'AMP_LIMIT_EXCEEDED' }, { status: 400 });
  }
  const lowered = fileName.toLowerCase();
  if (!lowered.endsWith('.amp') && !lowered.endsWith('.sqlite')) {
    return NextResponse.json({ error: 'AMP_NOT_SQLITE' }, { status: 400 });
  }
  const directory = await mkdtemp(join(tmpdir(), 'amp-upload-'));
  const packagePath = join(directory, 'package.amp');
  const digest = createHash('sha256'); let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length; if (bytes > AMP_MAX_PACKAGE_BYTES) return callback(new Error('AMP_LIMIT_EXCEEDED'));
    digest.update(chunk); callback(null, chunk);
  }});
  const storageInput = new PassThrough();
  const tempOutput = createWriteStream(packagePath, { mode: 0o600 });
  try {
    // Storage/file-store layers resolve the tenant from AsyncLocalStorage, so
    // the whole ingest runs inside the session user's tenant context.
    return await runWithTenant(user.tenant, async () => {
      await pipeline(Readable.fromWeb(request.body as never), meter, tempOutput);
      if (bytes !== declaredSize) throw new Error('AMP_UPLOAD_SIZE_MISMATCH');
      // No `metadata` option: external_files has no metadata column; package
      // provenance (source name, sha256) lives on the migration_jobs row.
      const upload = StorageService.uploadStream(user.tenant, storageInput, fileName, {
        mime_type: request.headers.get('content-type') || 'application/vnd.sqlite3', uploaded_by_id: user.user_id,
        size: declaredSize,
      });
      const [stored] = await Promise.all([upload, pipeline(createReadStream(packagePath), storageInput)]);
      const sha256 = digest.digest('hex');
      const { knex } = await createTenantKnex(user.tenant); const db = tenantDb(knex, user.tenant);
      const [inserted] = await db.table('migration_jobs').insert({ tenant: user.tenant, owner_user_id: user.user_id,
        source_file_id: stored.file_id, source_file_name: fileName, package_sha256: sha256,
        state: 'inspecting' }).returning('migration_job_id');
      const migrationJobId = inserted.migration_job_id ?? inserted;
      const staged = await new MigrationStager(knex, user.tenant).stage(migrationJobId, packagePath);
      return NextResponse.json({ migrationJobId, state: staged.rejected ? 'rejected' : 'needs_configuration', diagnostics: staged.validation.diagnostics, rowCounts: staged.validation.rowCounts }, { status: 201 });
    });
  } catch (error) {
    storageInput.destroy(error as Error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AMP_UPLOAD_FAILED' }, { status: 400 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
