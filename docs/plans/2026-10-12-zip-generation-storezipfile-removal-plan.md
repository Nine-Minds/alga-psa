# Remove dead `ZipGenerationService.storeZipFile` and hoist the tenant connection

- Card: db-query-outside-transaction / `related_writes_without_transaction` (696cfca4-21ef-45f0-bffc-5643c3c9873a)
- PSA ticket: alga-2026-0002679
- Fingerprint: `services/zip-generation.service.ts#ZipGenerationService.storeZipFile`
- Branch: `feature/db-query-outside-transaction-related-writes-with`

## Finding, confirmed against the code

`server/src/services/zip-generation.service.ts:61-80` (`storeZipFile`) takes a pool handle from
`createTenantKnex()` (line 62), then runs two related inserts on it with no transaction:

1. `FileStoreModel.create(knex, …)` (line 63) inserts into `external_files`.
2. `FileStoreModel.createDocumentSystemEntry(knex, …)` (line 73) inserts into `document_system_entries`
   for the row created in step 1.

If step 2 fails, step 1 leaves an orphaned `external_files` row. The finding is real.

The method is also dead code. A repo-wide search (`server`, `packages`, `ee`, `shared`, docs, tests)
finds `storeZipFile` only at its definition. The service's only consumer,
`server/src/lib/jobs/handlers/invoiceZipHandler.ts`, calls only `generateZipFromFileRecords`
(line 232). It stores the archive itself with `StorageService.uploadFile` and does its related
writes (`DocumentModel.insert` and `DocumentAssociation.create`) inside
`withTransaction(knex, trx => …)` (lines 265-289). The method shows other signs of being abandoned
too: `file_size: 0` is never updated, and `uploaded_by_id: 'system'` is not a user id.

## Decision

Delete `storeZipFile`; don't wrap it in a transaction (captain's scope note). The handler already
does this job correctly, so a transactional version of the method would be a second, unused way to
do the same thing. Don't add a `withTransaction` fallback or a `knexOrTrx` parameter.

## Changes (single file: `server/src/services/zip-generation.service.ts`)

1. **Delete `storeZipFile`**: lines 61-80, plus the blank line before it, so the class ends right
   after `generateZipFromFileRecords`.
2. **Remove the import it leaves dead**: `import { v4 as uuidv4 } from 'uuid';` (line 5). It has no
   other use in the file. Keep the other imports. `FileStoreModel` (`findById`), `StorageService`,
   `createTenantKnex`, `archiver` and `createWriteStream` are all still used. Also remove the unused
   `readFileSync` from the `fs` import on line 1; nothing in the file uses it.
3. **Hoist `createTenantKnex()` out of the per-record loop** in `generateZipFromFileRecords`:
   - Move `const { knex } = await createTenantKnex();` from line 31 (inside the inner per-record
     `try`) to just inside the outer `try` (line 26), before the `for` loop.
   - The loop body keeps `FileStoreModel.findById(knex, record.file_id)` and the rest unchanged.
   - Behaviour change, intended: today a failure to get a connection is caught by the per-record
     `catch` on every record, and the method ends with the misleading "No files were successfully
     added to the zip". After the change, the outer `catch` rejects once with the real connection
     error. Per-record failures (missing file, storage read error) are still skipped as before.
   - `findById` is a single read on the pool handle. The `related_writes` check doesn't cover it,
     and it doesn't need a transaction.

No other files change. `invoiceZipHandler.ts` stays as it is because its use of the service is
unaffected.

## Out of scope (noted, not touched)

- When `successCount === 0`, the method rejects without destroying `output` or `archive`, so the
  `/tmp` file handle stays open until GC. This was already the case and has nothing to do with this
  lens.
- `generateZipFromFileRecords` uses `new Promise(async …)`, an anti-pattern that also predates this
  change. Leave it.

## Verification

1. `grep -rn "storeZipFile" --exclude-dir=node_modules .` returns nothing.
2. Typecheck the server: `cd server && npx tsc --noEmit -p .`, or the repo's equivalent typecheck
   script. It must not report new errors in `zip-generation.service.ts` or `invoiceZipHandler.ts`.
3. Lint the changed file (`npx eslint server/src/services/zip-generation.service.ts`).
4. Runtime smoke test (optional, the path is unchanged except for the hoisted connection): trigger an
   invoice bundle download (bulk "Download PDFs" on invoices) on the dev server and confirm that the
   ZIP job completes and the bundle document appears.
5. Acceptance: the `scan-clean` check re-runs `db-query-outside-transaction` on the fingerprint.
   With the method gone, the subject no longer exists and the finding clears.
