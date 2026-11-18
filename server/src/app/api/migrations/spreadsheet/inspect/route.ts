import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextResponse } from 'next/server';
import { runWithTenant } from '@alga-psa/db';
import { featureFlags } from '@alga-psa/core/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import { PRICE_BOOK_FEATURE_FLAG } from '@alga-psa/billing/lib/catalog/priceBookFlag';
import { AMP_MAX_PACKAGE_BYTES } from '../../upload/route';

export const runtime = 'nodejs';

/**
 * Reads a price book spreadsheet's headers, a few sample rows and the inferred
 * column mapping, so the operator can confirm or correct the mapping before the
 * upload converts anything. Writes nothing: the file lives in a temp directory
 * for the duration of the request.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'manage'))) return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  if (!(await featureFlags.isEnabled(PRICE_BOOK_FEATURE_FLAG, { userId: user.user_id, tenantId: user.tenant }))) return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 });
  if (!(await hasPermission(user, 'billing', 'read'))) return NextResponse.json({ error: 'PRICE_BOOK_PERMISSION_DENIED' }, { status: 403 });

  const encodedName = request.headers.get('x-amp-file-name');
  const name = encodedName ? decodeURIComponent(encodedName) : '';
  if (!request.body || !name || !/\.(csv|xlsx)$/i.test(name)) return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 });

  const directory = await mkdtemp(join(tmpdir(), 'amp-inspect-'));
  const inputPath = join(directory, name.toLowerCase().endsWith('.xlsx') ? 'source.xlsx' : 'source.csv');
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > AMP_MAX_PACKAGE_BYTES ? new Error('AMP_LIMIT_EXCEEDED') : null, chunk); } });
  try {
    return await runWithTenant(user.tenant, async () => {
      await pipeline(Readable.fromWeb(request.body as never), meter, createWriteStream(inputPath, { mode: 0o600 }));
      const { inspectSpreadsheet } = await import('@alga-psa/migration-connectors/csv');
      const inspection = await inspectSpreadsheet(inputPath, { sampleRows: 5 });
      return NextResponse.json(inspection, { status: 200 });
    });
  } catch {
    return NextResponse.json({ error: 'AMP_SPREADSHEET_FAILED' }, { status: 400 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
