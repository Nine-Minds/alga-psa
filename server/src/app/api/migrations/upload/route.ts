import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';

export const runtime = 'nodejs';
export const AMP_MAX_PACKAGE_BYTES = 250 * 1024 * 1024;

/** Upload is deliberately stream-fed; StorageService owns the provider write. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'manage'))) {
    return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size > AMP_MAX_PACKAGE_BYTES) {
    return NextResponse.json({ error: 'AMP_LIMIT_EXCEEDED' }, { status: 400 });
  }
  const lowered = file.name.toLowerCase();
  if (!lowered.endsWith('.amp') && !lowered.endsWith('.sqlite')) {
    return NextResponse.json({ error: 'AMP_NOT_SQLITE' }, { status: 400 });
  }
  const digest = createHash('sha256'); let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length; if (bytes > AMP_MAX_PACKAGE_BYTES) return callback(new Error('AMP_LIMIT_EXCEEDED'));
    digest.update(chunk); callback(null, chunk);
  }});
  const input = Readable.fromWeb(file.stream() as never).pipe(meter);
  try {
    const stored = await StorageService.uploadFile(user.tenant, input, file.name, {
      mime_type: file.type || 'application/vnd.sqlite3', uploaded_by_id: user.user_id,
      metadata: { context: 'amp_migration_package', retention_days: 30 },
    });
    const sha256 = digest.digest('hex');
    const { knex } = await createTenantKnex(user.tenant); const db = tenantDb(knex, user.tenant);
    const migrationJobId = randomUUID();
    await db.table('migration_jobs').insert({ tenant: user.tenant, migration_job_id: migrationJobId, owner_user_id: user.user_id,
      source_file_id: stored.file_id, source_file_name: file.name, package_sha256: sha256,
      package_id: migrationJobId, format_version: 'pending', producer_name: 'pending', producer_version: 'pending', manifest: {}, state: 'uploaded' });
    return NextResponse.json({ migrationJobId, fileId: stored.file_id, sha256 }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AMP_UPLOAD_FAILED' }, { status: 400 });
  }
}
