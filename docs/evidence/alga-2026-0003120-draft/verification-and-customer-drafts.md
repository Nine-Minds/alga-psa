# Asset numbering and paired labels — Draft Implementation record

Ticket `alga-2026-0003120` · existing PSA ticket `8ea5fb98-0142-429d-9896-14e510033663`

This artifact records the Draft Implementation work and keeps the Ryan smoke scenario and unsent response draft reviewable. It describes the current implementation plus checks that remain for a live environment.

## Specification used

`git log main..HEAD --name-only -- docs/plans/` returned no files, and there is no committed asset-numbering implementation plan under `docs/plans/`. The approved design packet is attached to Design Session run `c48ee70c-5102-4a38-917a-c89533c9c2a1`; its decisions were used together with the task requirements. The card dossier identifies Ryan Hoffmann at FTS Technology Group as the requester. Nine Minds LLC is the retained inbound-default ticket association and does not change the customer context. No new PSA ticket was created and no customer response was sent.

The implementation follows the approved packet: `ASSET` uses `SharedNumberingService.getNextNumber` and its atomic allocator, with one tenant-wide sequence and client-specific formatting via `clients.asset_prefix`. Reservations use the four proposed states, 15-minute expiry metadata, and no reuse. Label-first intake creates a minimal durable asset and commits its reservation before printing, so expiry cannot move a printed identifier to another record. Asset tag matching trims boundary ASCII spaces and folds ASCII `a-z` to `A-Z`; other code points are retained. A database trigger serializes writes by tenant and normalized tag, and a reviewed partial unique index can be activated after legacy reconciliation. Migration execution and production Citus behavior have not been exercised in this run.

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

1. Import representative existing FTS tags unchanged, including variable-length prefixes, one blank tag, one exact duplicate, and tags differing only by case or surrounding whitespace. Run the duplicate audit. Confirm migration/deployment leaves every row untouched and reports conflicts; resolve the conflicts explicitly before enabling normalized uniqueness.
2. Configure `FTS` and `NORTH` as distinct client prefixes. Confirm that a same-tenant duplicate prefix is rejected, and that an unset prefix formats as the sequence alone. Review the continuation preview across the variable-length legacy tags and explicitly set/approve the next sequence value. Confirm the configured padding.
3. Open and cancel both full Add Asset and Quick Add; preview the next value; open print and cancel. Confirm the sequence has not advanced. Create two assets concurrently for different clients. Confirm they receive adjacent values from the same tenant sequence, formatted with the respective prefixes, and are distinct under the documented trim-and-case-fold comparison.
4. Attempt a manual edit and import that collide after normalization with a committed tag. Confirm both fail at the persistence boundary and neither creates a partial asset. Retry a corrected import and verify the supplied legacy tag remains unchanged. Repeat the check in a second tenant to confirm isolation.
5. Start label-first intake for a minimal asset. Confirm a durable reservation can be printed, then scan its label and complete details on that same asset. Race commit, retry, expiration, and release requests; verify at most one asset claims the reservation and released/expired values are never reissued. Confirm a preview-only value cannot be printed.
6. Print one asset and a batch using the existing label layouts with copies per asset set to two. Inspect rendered output for populated fields, page breaks, deterministic adjacent order (`A, A, B, B`), identical visible tags, and Code 128 payloads. Decode representative barcodes where available. Reprint an existing asset and verify its stored tag and next sequence are unchanged. Confirm scan lookup resolves that asset within tenant and normal user permissions.
7. Change client assignment, client prefix, and MSP/client ownership fields; verify the physical tag remains stable and ownership semantics are preserved. Resync a Level-discovered record and link a manually numbered record; confirm external IDs stay in their external identity fields, no printed tag changes, and no duplicate asset appears. Exercise equivalent Hudu/shared-ingestion paths touched by the implementation.
8. Repeat through full Add Asset, Quick Add repeated intake, REST creation, and bulk/import behavior. Check that validation failures/retries do not duplicate rows or replace a committed tag. Verify other shared-numbered entities retain their existing formatting and allocation behavior.

The isolated Ryan scenario has not been run against a live tenant. Do not use Ryan's production inventory. Offline rendered label evidence is provided as `paired-asset-labels.pdf`; the focused render test verifies pair order, populated asset tags, QR record URLs, and Code 128 payloads. No live PostgreSQL migration, concurrent database race, Citus deployment, browser UI, normal-permission scan lookup, live scanner, or physical-printer result is claimed.

## Customer-ready procedure draft

1. Import current inventory with printed asset tags exactly as supplied. Imports do not derive a physical tag from a serial or integration ID. Existing blanks and duplicates remain unchanged and appear in the legacy audit.
2. In Settings → Assets → Asset numbering, review the suffix scan and suggested continuation across tags of any prefix length. Agree on the continuation value with the customer, then explicitly set the ASSET sequence starting/last value and padding. The suggestion is advisory and is never applied automatically. Set distinct client prefixes or leave a prefix unset; prefixes change presentation, not the tenant-wide counter.
3. Reconcile normalized duplicates by locating each asset and recording the human decision. Edit only a physical tag the customer agrees to change; do not bulk-rewrite or merge assets. Add a review note, then activate normalized uniqueness after all duplicates are resolved. Blank tags may remain blank.
4. For new assets, use Full add or Quick Add and choose automatic numbering, or enter an existing/scanned tag to preserve it. For label-first intake, choose the client and create a minimal durable record before printing. Scanning the QR later opens the same asset record to finish its details, even after the reservation's 15-minute expiry.
5. Print one or many selected assets with Copies per asset set to two. Labels expand into adjacent pairs (`A, A, B, B`) using the selected layout. Attach one copy to the equipment and one to its box. Use the Code 128 tag in asset search to find the same record.
6. Reprint a stored asset label to replace a damaged copy. Previewing, opening/cancelling intake, printing, and reprinting do not allocate. Issued numbers and collision skips are never reused, so sequence gaps can occur.

## Customer response draft — unsent

Hi Ryan,

The draft now supports your existing printed tags and new equipment. Number allocation uses one sequence for the MSP tenant, and each client's prefix is applied when the physical tag is formatted. Existing imported tags are preserved. The legacy audit identifies blank tags and normalized duplicates for review before uniqueness activation. The settings screen provides a suffix scan and suggested continuation value for review, plus padding and explicit sequence settings.

For label-first intake, the draft creates a minimal durable asset before printing. Two adjacent copies of its stored tag are the default; scanning either QR code opens that same record for the remaining details. Existing assets can be reprinted without allocating a number. Previewing does not reserve a number, and issued numbers are not reused, so sequence gaps can occur.

We should review the continuation value and duplicate reconciliation with you before activation, then walk through a sample import and label-first intake. Offline label rendering is verified; live database, Citus, scanner, and printer validation remain before customer rollout.

Regards,
Alga Support

This is a draft only. Do not send it or post it to the PSA ticket from this step.

## Verification record

- `npm run typecheck --workspace=@alga-psa/assets` — passed.
- `npm run typecheck --workspace=@alga-psa/ui` — passed.
- `npm run build --workspace=@alga-psa/assets` — passed.
- `npm run lint:migrations` — passed (0 violations).
- `npm run test --workspace=@alga-psa/assets -- --run src/lib/assetNumbering.test.ts` — passed (2 tests for normalization and formatting).
- `npm run test --workspace=@alga-psa/ui -- --run src/components/labels/assetLabelCopies.test.ts` — passed (2 tests for adjacent ordering and copy bounds).
- `npm run test --workspace=@alga-psa/billing -- --run src/lib/label-batch/labelBatch.e2e.test.ts` — passed (32 offline render/decode tests before adding the paired evidence case); focused `-t 'renders adjacent physical asset pairs'` passed (1 test), producing `paired-asset-labels.pdf` with QR and Code 128 decode assertions.
- `cd ee/server && npx vitest run src/__tests__/unit/huduAssetImportActions.test.ts` — passed (30 tests).
- `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioDeviceMapper.test.ts` — passed (20 tests, including external identity kept separate from the physical tag).
- `npm run typecheck --workspace=server` — default 4 GB heap attempt exhausted Node's heap; rerun with an 8 GB heap also exhausted Node's heap (exit 134 after about 103 seconds).

The app server remained stopped. The original `stack-up` failure remains an HTTP probe exit 7 against the intentionally stopped listener. PostgreSQL migration/concurrency checks were not run: the configured `.env.localtest` points to `DB_NAME=server`, not a disposable test database, so no migration was applied to it. No Citus deployment, browser UI, normal-permission scan lookup, live scanner, or physical-printer result is claimed. Review database-trigger/index deployment behavior, especially on production Citus, before rollout.
