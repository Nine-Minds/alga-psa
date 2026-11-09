# Asset numbering and paired labels — Draft Implementation record

Ticket `alga-2026-0003120` · existing PSA ticket `8ea5fb98-0142-429d-9896-14e510033663`

This artifact records the Draft Implementation work and keeps the Ryan smoke scenario and unsent response draft reviewable. It describes the current implementation plus checks that remain for a live environment.

## Specification used

`git log main..HEAD --name-only -- docs/plans/` returned no files, and there is no committed asset-numbering implementation plan under `docs/plans/`. The card dossier identifies an approved design packet attached to Design Session run `c48ee70c-5102-4a38-917a-c89533c9c2a1`, but that packet is not available in the local worktree or local Alga Dev cache. This repair uses the already committed implementation, its preserved evidence, and the explicit acceptance criteria; it does not infer missing design decisions. The card dossier identifies Ryan Hoffmann at FTS Technology Group as the requester. Nine Minds LLC is the retained inbound-default ticket association and does not change the customer context. No new PSA ticket was created and no customer response was sent.

Assets use `SharedNumberingService.getNextNumber` and the existing atomic allocator. One tenant-wide numeric sequence is formatted with `clients.asset_prefix`; an unset client prefix adds nothing. Preview uses the shared formatter, including optional date prefixes, without initializing or consuming the sequence. Existing printed tags are retained across client, prefix, ownership, and Level resync changes.

`asset_tag_claims` owns the normalized namespace. Its primary key is `(tenant, normalized_tag)`. Assets and reservations have mandatory colocated foreign keys to their claims. Database-generated asset keys prevent a writer from bypassing claims or borrowing another asset's claim. Migration captures exact original `(tenant, asset_id, normalized_tag)` bindings for legacy duplicates and blanks. Duplicate groups hold their tags until reviewed reconciliation. A new asset ID cannot use a grandfathered binding, and a new claim cannot take a legacy duplicate group's tag. The migration never changes an existing physical tag. Activation promotes the remaining original owners to mandatory claims for one tenant without requiring other tenants to reconcile first.

Label-first intake commits a minimal asset before printing. Reservations have reserved, committed, expired, and released states with 15-minute expiry metadata. Expiration or release retains the tag claim; scanning can resume the same reserved number. The reservation's origin stays bound while ownership transfers atomically to one asset. Failed writes roll the transfer back. Completed transfers can be retried for the same asset, and concurrent completion cannot create a second asset.

Tag matching trims boundary ASCII spaces and folds ASCII `a-z` to `A-Z`; other code points remain unchanged. Sequence-continuation review applies that same normalization before reading numeric suffixes. Asset creation across UI, REST, imports, inventory delivery, and RMM ingestion prepares identity through the shared service before inserting the asset. Inventory serials, stock-unit IDs, and integration external IDs remain separate from the physical tag.

The Citus-compatible migrations use generated columns, colocated foreign keys, batched legacy backfills, concurrent indexes, and separate constraint-validation migrations. Retrying an interrupted concurrent index build removes its invalid index artifact before rebuilding. Feature tables follow the repository's tenant-scoped query facade; they do not rely on session-GUC row-level security on Citus workers.

Tenant lifecycle metadata orders reservation and asset deletion before claim deletion and exports identity metadata with the assets. Client merges move pending reservations to the surviving client without changing their stored tags or claim ownership. Hudu import results return the persisted allocated tag rather than the empty automatic-numbering request.

## Repair diagnosis: `stack-up`

The Wire Up exit criterion is:

```sh
{ docker compose -p "{{state.composeProject}}" ps --status running -q 2>/dev/null || sg docker -c "docker compose -p '{{state.composeProject}}' ps --status running -q"; } | grep -q . \
  && c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "{{state.devOrigin}}") \
  && [ "$c" != "000" ]
```

The recorded Wire Up run `dba38f86-d507-44b9-b2e8-f492d787a268` completed host wiring and logged `signin answered HTTP 307` at the configured origin on port 3578. Its associated `stack-up` verification recorded `exit 7: no output`. The workflow verification history and run `1865ea19-e11b-4b3c-9e52-617d1bd8f690` identify the service lifecycle mismatch: the dev-server was suspended after Wire Up because the following ticket-link step did not use it, before the verifier's HTTP probe.

This repair round was required to keep the application server stopped. Read-only checks found two running Compose containers and no listener on port 3578. A direct probe reproduced the exact failing cause without starting anything:

```text
curl -sS -o /dev/null -w 'HTTP=%{http_code} CURL_EXIT=%{exitcode}\n' --max-time 3 http://feature-asset-numbering-client-prefixes-and-paired-label.localhost:3578
curl: (7) Failed to connect ... Could not connect to server
HTTP=000 CURL_EXIT=7
```

The failing command is the `curl` part of the verifier, not application code or dependency wiring. Its precondition conflicts with the deliberate server-off state. The verification was not weakened, and the full `stack-up` command was not rerun. Live HTTP/UI checks belong to a later server-on step. The board-owned `dev-server` service was concluded after discovering that the workflow system had resumed it; it is currently stopped. The earlier `stack-up` failure therefore remains accurately reported as an environment/lifecycle mismatch rather than being relabeled as passed.

## Ryan smoke scenario for a reviewer / server-on step

Use an isolated tenant with two clients, for example `FTS` and `NORTH`, and a reviewed starting value of `004281`. Do not use or alter Ryan's production inventory for the smoke test.

1. In an isolated pre-migration database, seed representative legacy FTS tags with variable-length prefixes, a blank tag, exact duplicates, and tags differing only by case or surrounding spaces. Apply all four asset-numbering migrations. Confirm every physical tag remains unchanged and the audit reports the conflicts. New imports must reject normalized duplicates; reconcile those incoming rows before importing.
2. Configure `FTS` and `NORTH` as distinct client prefixes. Confirm that a same-tenant duplicate prefix is rejected, and that an unset prefix formats as the sequence alone. Review the continuation preview across the variable-length legacy tags and explicitly set/approve the next sequence value. Confirm the configured padding.
3. Open and cancel both full Add Asset and Quick Add; preview the next value; open print and cancel. Confirm the sequence has not advanced. Create two assets concurrently for different clients. Confirm they receive adjacent values from the same tenant sequence, formatted with the respective prefixes, and are distinct under the documented trim-and-case-fold comparison.
4. Attempt a manual edit and import that collide after normalization with a committed tag. Confirm both fail at the persistence boundary and neither creates a partial asset. Retry a corrected import and verify the supplied legacy tag remains unchanged. Repeat the check in a second tenant to confirm isolation.
5. Start label-first intake for a minimal asset and print its stored tag. Scan the label and complete details on that same asset. If scanning finds a still-pending durable reservation, continue it without allocating again. Race commit, retry, expiration, and release requests; verify at most one asset claims the reservation and released/expired values are never reissued. Confirm a preview-only value cannot be printed.
6. Print one asset and a batch using the existing label layouts with copies per asset set to two. Inspect rendered output for populated fields, page breaks, deterministic adjacent order (`A, A, B, B`), identical visible tags, and Code 128 payloads. Decode representative barcodes where available. Reprint an existing asset and verify its stored tag and next sequence are unchanged. Confirm scan lookup resolves that asset within tenant and normal user permissions.
7. Change client assignment, client prefix, and MSP/client ownership fields; verify the physical tag remains stable and ownership semantics are preserved. Resync a Level-discovered record and link a manually numbered record; confirm external IDs stay in their external identity fields, no printed tag changes, and no duplicate asset appears. Exercise equivalent Hudu/shared-ingestion paths touched by the implementation.
8. Repeat through full Add Asset, Quick Add repeated intake, REST creation, and bulk/import behavior. Check that validation failures/retries do not duplicate rows or replace a committed tag. Verify other shared-numbered entities retain their existing formatting and allocation behavior.

The complete Ryan click-through scenario has not been run against a live tenant. Do not use Ryan's production inventory. Offline rendered label evidence is provided as `paired-asset-labels.pdf`; its render test verifies pair order, populated asset tags, QR record URLs, and Code 128 payloads. PostgreSQL integration tests exercise the real REST and UI write cores, concurrent allocations and completion, normalized manual/import conflicts, rollback, reviewed activation, tag stability, and Level resync. The PostgreSQL and Citus verification harnesses exercise mandatory database bindings, actual shared numbering/reservation services, legacy holding-claim promotion, concurrent client-prefixed allocation, and the independent ticket sequence. Component tests cover Full Add preview/cancel, automatic/manual tags, custom-field validation, and repeated intake. Browser UI, normal-permission lookup in a live session, live scanner, and physical-printer results remain unperformed.

## Customer-ready procedure draft

1. Retain printed tags already stored in Alga. For SharePoint import, map the actual physical-tag column and review normalized duplicates before importing. Reconcile conflicting source rows with the customer; imports reject duplicate tags. A blank incoming tag requests a new number, so supply every existing printed tag. Legacy blanks and duplicates already in Alga remain unchanged and appear in the audit.
2. In Settings → Assets → Asset numbering, review the suffix scan and suggested continuation across tags of any prefix length. Agree on the continuation value with the customer, then explicitly set the ASSET sequence starting/last value and padding. The suggestion is advisory and is never applied automatically. Set distinct client prefixes or leave a prefix unset; prefixes change presentation, not the tenant-wide counter.
3. Reconcile normalized duplicates by locating each asset and recording the human decision. Edit only a physical tag the customer agrees to change; do not bulk-rewrite or merge assets. Record the review notes, then activate the reconciled tenant. Activation binds each retained tag to its remaining original asset. Intentionally blank legacy tags can remain blank. New writes are already protected by database claims.
4. For new assets, use Full add or Quick Add and choose automatic numbering, or enter an existing/scanned tag to preserve it. Full add uses the tenant asset type registry, including custom types and their required attributes. For label-first intake, choose the client and create a minimal durable record before printing. Scan its tag in the asset workspace to open that record for completion; if a pending reservation is scanned, continue it without allocating another number. Expired or released numbers remain held so printed identifiers cannot be reassigned.
5. Print one or many selected assets with Copies per asset set to two. Choose an asset template with Code 128 when using a tag scanner. Labels print in adjacent pairs (`A, A, B, B`) using the selected layout. Attach one copy to the equipment and one to its box. In the asset workspace, use Scan or enter a tag to find the record, then select Edit to finish its details. A QR label opens the same record URL.
6. Reprint a stored asset label to replace a damaged copy. Previewing, opening/cancelling intake, printing, and reprinting do not allocate. Issued numbers and collision skips are never reused, so sequence gaps can occur.

## Customer response draft — unsent

Hi Ryan,

The draft supports one numbering sequence across your clients, client prefixes, and two identical labels for each asset. You can retain existing printed tags, review the next value in settings, and create a minimal asset before printing its equipment and box labels. Scanning the box label later finds that same record so you can finish its details. Reprinting keeps the stored tag and does not issue another number.

Before importing SharePoint inventory, we should review duplicate tags and agree on the continuation value. Existing Alga tags are preserved during migration. Sequence gaps can occur because issued or abandoned labels are not reassigned. Level's device identifiers remain separate from the physical tag.

Database and rendered-label checks are complete in test environments. The next step is a live walkthrough with your scanner and label layout before rollout.

Regards,
Alga Support

This response is saved for review and has not been sent or posted to ticket `8ea5fb98-0142-429d-9896-14e510033663`.

## Verification record

- `node scripts/verify-asset-tag-bindings.mjs` against fresh dedicated PostgreSQL 15 and Citus 12.1/PostgreSQL 16 databases: migrations, legacy preservation, pending/committed reservation upgrade, re-entry, direct insert/edit enforcement, forged exemptions, namespace holding claims, concurrent identity ownership, reservation transfer, and rollback. See `postgres-binding-verification.txt` and `citus-binding-verification.txt`.
- `tsx --tsconfig tsconfig.base.json scripts/verify-asset-numbering-services.ts` follows the binding harness in the same scratch database. It exercises actual shared services, two client prefixes sharing a concurrent sequence, non-consuming preview, reservation recovery/completion, reviewed activation, and unchanged ticket-number defaults.
- `cd server && npx vitest run src/test/integration/assetNumberingPersistence.integration.test.ts --coverage.enabled=false --maxWorkers=1`: real database verification of the REST service and UI write core. See `postgres-integration-verification.txt`. The suite uses a dedicated `asset_numbering_test_*` database; it never targets `.env.localtest`'s `server` database.
- Assets component/action/formatting suites: Full Add custom fields and create modes, preview/cancel, repeated intake, scan authorization, conflict presentation, normalization and formatting.
- Inventory delivery tests: serial/internal unit IDs stay separate from automatic physical tags, and bidirectional inventory links are retained.
- Existing numbering/format and REST extension/assignment unit suites: preserve other entity formatting and existing asset behavior. Unit database doubles mock identity preparation; real claim behavior is covered by the database suites above.
- Paired-label render test: `npm run test --workspace=@alga-psa/billing -- --run src/lib/label-batch/labelBatch.e2e.test.ts -t 'renders adjacent physical asset pairs'`. The regenerated `paired-asset-labels.pdf` contains adjacent identical FTS and NORTH pairs; Code 128 and QR payloads decode in the test.
- Typechecks cover assets, clients, inventory, integrations, reference-data, UI, and the full server. The full server check requires `NODE_OPTIONS=--max-old-space-size=12288` on this worktree; earlier builder attempts with 8 GB exhausted the heap. The DB package has no `typecheck` npm script; its TypeScript build checks it. See `typecheck-verification.txt`.
- Package builds cover DB, clients, assets, and inventory. Migration lint checks all four asset-numbering migrations. `node scripts/validate-translations.cjs` passes for all ten locales, including the added conflict message.
- Final focused results: 15 PostgreSQL integration tests; 28 assets component/action/format tests; 2 inventory-delivery tests; 1 settings authorization test; 2 copy-order tests; 120 shared numbering, REST, tenant-lifecycle, and client-merge tests; 50 Hudu/Level tests; and the paired-label render/decode case. The 32 other renderer cases were not rerun in this takeover.

To reproduce the binding/service checks, create an empty `asset_numbering_test_*` database and set `ASSET_NUMBERING_VERIFY_URL`. For Citus, create the same empty database with the Citus extension on the worker; set `ASSET_NUMBERING_CITUS_COORDINATOR_HOST` and `ASSET_NUMBERING_CITUS_WORKER_HOST` to their internal cluster hostnames. Run the binding script, then the service script. Both refuse a database name outside the scratch-name boundary.

The app server remained stopped. The original `stack-up` HTTP probe therefore remains incompatible with this step's required lifecycle; it was not weakened or reported as passed. No production schema, live customer inventory, ticket, or external branch was changed. Live browser/session behavior, scanner hardware, printer output, and production deployment remain unperformed. Review the mandatory claim migration and legacy activation first, then the REST reservation tests and actual rendered labels.

## Repair round — 2026-11-09

The actual branch HEAD at the start of this round was `1acfec1d492d796084c6f31c627f5f6d624991a5`, matching the recorded published implementation. The only pre-existing worktree change was an unstaged `package-lock.json` edit; it was left untouched and excluded from the repair. PR #4210 had one automated review finding at that revision: `20261104132000_enforce_asset_tag_claim_bindings.cjs` queried `pg_constraint` without a tenant predicate. Because this is database-wide catalog metadata, a tenant key cannot scope that lookup. The migration now uses atomic `ALTER TABLE ... ADD CONSTRAINT` with `duplicate_object` handling, removing the precheck and keeping re-entry safe. Migration-lint also exposed four unbounded upgrade backfills in that migration; they now run in resumable batches of 1,000 rows and skip already-completed rows.

Verification for this repair round:

- 55 focused asset, numbering, authorization, and copy-order tests passed across eight files.
- `npm run lint:migrations` reported zero violations. `npm run test:migration-lint -- --test-reporter=spec` passed all 51 cases. Before the batch repair, the main-branch migration audit failed with four unbounded-DML findings in this migration.
- Builds passed for DB, clients, assets, inventory, billing, and reference-data packages.
- The paired-label PDF renderer test passed: one selected behavioral case passed and 32 unrelated renderer cases were deselected. It rendered actual sheet output and decoded the Code 128 and QR payloads. The PDF was visually inspected: FTS appears as `A,A`, followed by NORTH as `B,B`.
- The PostgreSQL integration suite did not run. Its new card-scoped scratch database could not be created because the card role lacks `CREATEDB`; the shared bootstrap also reported an exhausted shared-memory allocation. No scratch database was created. The local `.env.localtest` points at shared test infrastructure, so no credentials, pooler mounts, or shared services were changed. The direct card-specific connection to `server_card_ee4611c9` on `127.0.0.1:5474` succeeds, but it does not provide permission to provision the disposable suite database.
- The card-owned `dev-server` service had been auto-healed before this round. It was concluded through Alga Dev and port 3578 was verified closed. `workflow-set-service-enabled` refused because service power requires the captain or XO; the conclusion stopped it. No app server was started by this repair, and no live browser, scanner, or physical printer check was performed.

The local design packet remains unavailable. The database owner should restore isolated scratch-database provisioning (including the `CREATEDB`/shared-memory issue) and Prepare Human Review should verify canonical login through the correct card-scoped endpoint before running the existing Ryan walkthrough. The server service must be intentionally re-enabled by the card owner for that later step. The pre-existing `package-lock.json` change remains unstaged.
