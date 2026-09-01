import { NextResponse } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'read'))) return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  const { jobId } = await params; const { knex } = await createTenantKnex(user.tenant); const db = tenantDb(knex, user.tenant);
  const job = await db.table('migration_jobs').where({ migration_job_id: jobId }).first();
  if (!job) return NextResponse.json({ error: 'MIGRATION_NOT_FOUND' }, { status: 404 });
  const rows = await db.table('migration_staged_records').where({ migration_job_id: jobId }).select('entity_type', 'package_record_id', 'source_record_id', 'validation_state', 'validation_errors');
  const format = new URL(request.url).searchParams.get('format') ?? 'json';
  if (format === 'csv') {
    const csv = ['entity_type,package_record_id,source_record_id,validation_state,validation_errors', ...rows.map(row => [row.entity_type, row.package_record_id, row.source_record_id, row.validation_state, JSON.stringify(row.validation_errors)].map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="amp-preflight-${jobId}.csv"` } });
  }
  return NextResponse.json({ job, records: rows });
}
