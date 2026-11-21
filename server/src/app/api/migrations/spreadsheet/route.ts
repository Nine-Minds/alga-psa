import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextResponse } from 'next/server';
import { createTenantKnex, runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import { featureFlags } from '@alga-psa/core/server';
import { isSupportedCurrency } from '@alga-psa/core/formatters';
import { PRICE_BOOK_FEATURE_FLAG } from '@alga-psa/billing/lib/catalog/priceBookFlag';
import { findOrCreateDraftPriceBook } from '@alga-psa/billing/lib/catalog/priceBooks';
import { isServiceCatalogPricingError, todayCalendarDate } from '@alga-psa/billing/lib/catalog/serviceCatalogPricing';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import { MigrationStager } from '@/lib/migrations/MigrationStager';
import {
  logMigrationUploadFailure,
  migrationUploadErrorCode,
} from '@/lib/migrations/migrationUploadErrors';
import { spreadsheetImportNamespace } from '@/lib/migrations/spreadsheetNamespace';
import { resolveConfiguredTenantCurrency } from '@alga-psa/inventory/lib/tenantCurrency';
import { AMP_MAX_PACKAGE_BYTES } from '../upload/route';

export const runtime = 'nodejs';
const ENTITY_TYPES = new Set(['organizations', 'locations', 'contacts', 'tickets', 'ticket_comments', 'assets', 'products', 'vendor_products']);
/** Entity types behind the `catalog-price-books` flag. */
const PRICE_BOOK_ENTITY_TYPES = new Set(['services', 'catalog_prices']);
const PRICE_BOOK_PROFILE = 'price_book';

const header = (request: Request, name: string): string => {
  const raw = request.headers.get(name);
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
};

/** Streams both the browser upload and the converted AMP artifact; request
 * payloads are never materialized as File.arrayBuffer() or a Buffer. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.tenant || !(await hasPermission(user, 'import_export', 'manage'))) return NextResponse.json({ error: 'IMPORT_EXPORT_PERMISSION_DENIED' }, { status: 403 });
  const encodedName = request.headers.get('x-amp-file-name'); const name = encodedName ? decodeURIComponent(encodedName) : '';
  const profile = request.headers.get('x-amp-import-profile') ?? '';
  const isPriceBook = profile === PRICE_BOOK_PROFILE;
  // The price book profile fans one sheet out to items plus prices, instead of the single `x-amp-entity-type`.
  const entityType = isPriceBook ? 'catalog_prices' : request.headers.get('x-amp-entity-type') ?? '';
  if (profile && !isPriceBook) return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 });
  if (isPriceBook || PRICE_BOOK_ENTITY_TYPES.has(entityType)) {
    // Flagged off: the profile and its entity types do not exist for this account.
    if (!(await featureFlags.isEnabled(PRICE_BOOK_FEATURE_FLAG, { userId: user.user_id, tenantId: user.tenant }))) return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 });
    // The preview reveals contract rates, so the upload also needs billing:read (docs/plans/2026-11-18 §7).
    if (!(await hasPermission(user, 'billing', 'read'))) return NextResponse.json({ error: 'PRICE_BOOK_PERMISSION_DENIED' }, { status: 403 });
  }
  const priceBookName = header(request, 'x-amp-price-book-name').trim();
  const priceBookDate = header(request, 'x-amp-price-book-effective-date').trim();
  const jobCurrency = header(request, 'x-amp-job-currency').trim().toUpperCase();
  let confirmedMapping: Record<string, string> | undefined;
  const mappingHeader = header(request, 'x-amp-column-mapping');
  if (mappingHeader) {
    try {
      const parsed = JSON.parse(mappingHeader);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('mapping');
      confirmedMapping = parsed as Record<string, string>;
    } catch { return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 }); }
  }
  if (isPriceBook) {
    if (!priceBookName || !/^\d{4}-\d{2}-\d{2}$/.test(priceBookDate) || priceBookDate < todayCalendarDate() || (jobCurrency && !isSupportedCurrency(jobCurrency))) return NextResponse.json({ error: 'PRICE_BOOK_INVALID' }, { status: 400 });
  }
  const declaredSizeHeader = request.headers.get('x-amp-file-size');
  const declaredSize = declaredSizeHeader === null ? NaN : Number(declaredSizeHeader);
  if (!request.body || !name || !(ENTITY_TYPES.has(entityType) || PRICE_BOOK_ENTITY_TYPES.has(entityType)) || declaredSizeHeader === null || !/^\d+$/.test(declaredSizeHeader) || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > AMP_MAX_PACKAGE_BYTES || !/\.(csv|xlsx)$/i.test(name)) return NextResponse.json({ error: 'AMP_SPREADSHEET_INVALID' }, { status: 400 });
  const directory = await mkdtemp(join(tmpdir(), 'amp-spreadsheet-'));
  const inputPath = join(directory, name.toLowerCase().endsWith('.xlsx') ? 'source.xlsx' : 'source.csv');
  const outputPath = join(directory, 'converted.amp');
  let bytes = 0;
  // The source hash is captured in the same streaming pass as the size check.
  // It must come from the uploaded bytes, not `package_sha256`: the converted
  // package is produced by convertSpreadsheets and its digest depends on the
  // namespace this hash derives.
  const sourceDigest = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; sourceDigest.update(chunk); callback(bytes > AMP_MAX_PACKAGE_BYTES ? new Error('AMP_LIMIT_EXCEEDED') : null, chunk); } });
  try {
    // Storage/file-store layers resolve the tenant from AsyncLocalStorage, so
    // the whole ingest runs inside the session user's tenant context.
    return await runWithTenant(user.tenant, async () => {
      await pipeline(Readable.fromWeb(request.body as never), meter, createWriteStream(inputPath, { mode: 0o600 }));
      if (bytes !== declaredSize) throw new Error('AMP_UPLOAD_SIZE_MISMATCH');
      const { convertSpreadsheets, convertPriceBookSpreadsheet, inferSpreadsheetMapping, inferPriceBookMapping } = await import('@alga-psa/migration-connectors/csv');
      // A confirmed mapping (the operator's corrections) replaces the inferred one; inference is only the default.
      const mapping = confirmedMapping ?? (isPriceBook ? await inferPriceBookMapping(inputPath) : await inferSpreadsheetMapping(inputPath, entityType as never));
      if (Object.keys(mapping).length === 0) throw new Error('AMP_SPREADSHEET_NO_RECOGNIZED_HEADERS');
      // Money cells are parsed to minor units with the exponent of the row's currency;
      // a blank currency cell uses the tenant currency (never a hardcoded default), and
      // the assumption is recorded so the applier can verify it at apply time.
      const { knex: currencyKnex } = await createTenantKnex(user.tenant);
      // The job currency (the upload form's picker) outranks the tenant default for blank currency cells.
      const defaultCurrency = (jobCurrency || (await resolveConfiguredTenantCurrency(currencyKnex, user.tenant))) ?? undefined;
      const namespace = spreadsheetImportNamespace(user.tenant, sourceDigest.digest('hex'));
      const conversion = isPriceBook
        ? await convertPriceBookSpreadsheet({ outputPath, namespace, sourceSystem: 'csv-upload', defaultCurrency, path: inputPath, mapping }, directory)
        : await convertSpreadsheets({ outputPath, namespace, sourceSystem: 'csv-upload', defaultCurrency, files: [{ entityType: entityType as never, path: inputPath, mapping }] }, directory);
      if (!MigrationStager.hasImportableRecords(outputPath)) throw new Error('AMP_PACKAGE_NO_IMPORTABLE_RECORDS');
      const { size: packageSize } = await stat(outputPath);
      const digest = createHash('sha256'); const storageInput = new PassThrough();
      const packageStream = createReadStream(outputPath); packageStream.on('data', (chunk) => digest.update(chunk));
      // No `metadata` option: external_files has no metadata column; package
      // provenance (source name, sha256) lives on the migration_jobs row.
      const upload = StorageService.uploadStream(user.tenant, storageInput, `${name}.amp`, { mime_type: 'application/vnd.sqlite3', uploaded_by_id: user.user_id, size: packageSize, origin: 'system-artifact' });
      const [stored] = await Promise.all([upload, pipeline(packageStream, storageInput)]); const sha256 = digest.digest('hex');
      const { knex } = await createTenantKnex(user.tenant); const db = tenantDb(knex, user.tenant); const [inserted] = await db.table('migration_jobs').insert({ tenant: user.tenant, owner_user_id: user.user_id, source_file_id: stored.file_id, source_file_name: `${name}.amp`, package_sha256: sha256, state: 'inspecting' }).returning('migration_job_id'); const migrationJobId = inserted.migration_job_id ?? inserted;
      let priceBookId: string | null = null;
      if (isPriceBook) {
        // The draft price book exists from upload on, so the job and the book share one id for the whole flow.
        const created = await withTransaction(knex, (trx) => findOrCreateDraftPriceBook(trx, user.tenant, { name: priceBookName, effectiveDate: priceBookDate, createdBy: user.user_id, sourceMigrationJobId: migrationJobId }));
        priceBookId = created.priceBook.price_book_id;
        await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({ configuration: JSON.stringify({ priceBook: { priceBookId, effectiveDate: priceBookDate, currency: jobCurrency || null } }) });
      }
      const staged = await new MigrationStager(knex, user.tenant).stage(migrationJobId, outputPath);
      return NextResponse.json({ migrationJobId, priceBookId, state: staged.rejected ? 'rejected' : 'needs_configuration', diagnostics: staged.validation.diagnostics, rowCounts: staged.validation.rowCounts, conversionDiagnostics: conversion.diagnostics }, { status: 201 });
    });
  } catch (error) {
    if (isServiceCatalogPricingError(error)) return NextResponse.json({ error: 'PRICE_BOOK_INVALID', message: error.message }, { status: 400 });
    const code = migrationUploadErrorCode(error, 'AMP_SPREADSHEET_FAILED');
    if (code === 'AMP_SPREADSHEET_FAILED' || code === 'AMP_STORAGE_REJECTED') {
      logMigrationUploadFailure('/api/migrations/spreadsheet', user.tenant, error);
    }
    return NextResponse.json({ error: code }, { status: 400 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
