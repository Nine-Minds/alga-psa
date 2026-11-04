# Asset numbering and paired labels — Draft Implementation record

Ticket `alga-2026-0003120` · existing PSA ticket `8ea5fb98-0142-429d-9896-14e510033663`

This artifact records the Draft Implementation repair round and keeps the Ryan smoke scenario and response draft reviewable. It does not claim that the product feature has been implemented.

## Specification used

`git log main..HEAD --name-only -- docs/plans/` returned no files, and there is no committed asset-numbering implementation plan under `docs/plans/`. The approved design packet is attached to Design Session run `c48ee70c-5102-4a38-917a-c89533c9c2a1`; its decisions were used together with the task requirements. The card dossier identifies Ryan Hoffmann at FTS Technology Group as the requester. Nine Minds LLC is the retained inbound-default ticket association and does not change the customer context. No new PSA ticket was created and no customer response was sent.

The design packet calls for `ASSET` to use `SharedNumberingService.getNextNumber` and the existing atomic allocator, with one tenant-wide sequence and client-specific formatting. It proposes `clients.asset_prefix`, durable reservations with `reserved`, `committed`, `expired`, and `released` states, a 15-minute TTL, no number reuse, and two explicit label instances per asset. These are design decisions, not verified implementation facts. The task additionally requires a normalized matching rule that is enforced consistently in storage and lookup; the packet's raw `(tenant, asset_tag)` partial index proposal is insufficient by itself for case/whitespace-insensitive matching and must be resolved before implementation. Production Citus compatibility also remains to be demonstrated.

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

## Ryan smoke scenario for the implementation step

Use an isolated tenant with two clients, for example `FTS` and `NORTH`, and a reviewed starting value of `004281`. Do not use or alter Ryan's production inventory for the smoke test.

1. Import representative existing FTS tags unchanged, including variable-length prefixes, one blank tag, one exact duplicate, and tags differing only by case or surrounding whitespace. Run the duplicate audit. Confirm migration/deployment leaves every row untouched and reports conflicts; resolve the conflicts explicitly before enabling normalized uniqueness.
2. Configure `FTS` and `NORTH` as distinct client prefixes. Confirm that a same-tenant duplicate prefix is rejected, and that an unset prefix formats as the sequence alone. Review the continuation preview across the variable-length legacy tags and explicitly set/approve the next sequence value. Confirm the configured padding.
3. Open and cancel both full Add Asset and Quick Add; preview the next value; open print and cancel. Confirm the sequence has not advanced. Create two assets concurrently for different clients. Confirm they receive adjacent values from the same tenant sequence, formatted with the respective prefixes, and are distinct under the documented trim-and-case-fold comparison.
4. Attempt a manual edit and import that collide after normalization with a committed tag. Confirm both fail at the persistence boundary and neither creates a partial asset. Retry a corrected import and verify the supplied legacy tag remains unchanged. Repeat the check in a second tenant to confirm isolation.
5. Start label-first intake for a minimal asset. Confirm a durable reservation can be printed, then scan its label and complete details on that same asset. Race commit, retry, expiration, and release requests; verify at most one asset claims the reservation and released/expired values are never reissued. Confirm a preview-only value cannot be printed.
6. Print one asset and a batch using the existing label layouts with copies per asset set to two. Inspect rendered output for populated fields, page breaks, deterministic adjacent order (`A, A, B, B`), identical visible tags, and Code 128 payloads. Decode representative barcodes where available. Reprint an existing asset and verify its stored tag and next sequence are unchanged. Confirm scan lookup resolves that asset within tenant and normal user permissions.
7. Change client assignment, client prefix, and MSP/client ownership fields; verify the physical tag remains stable and ownership semantics are preserved. Resync a Level-discovered record and link a manually numbered record; confirm external IDs stay in their external identity fields, no printed tag changes, and no duplicate asset appears. Exercise equivalent Hudu/shared-ingestion paths touched by the implementation.
8. Repeat through full Add Asset, Quick Add repeated intake, REST creation, and bulk/import behavior. Check that validation failures/retries do not duplicate rows or replace a committed tag. Verify other shared-numbered entities retain their existing formatting and allocation behavior.

Record database rows, audit output, rendered label PDFs/images, barcode decode output, and exact commands in the implementation evidence. This scenario has not been run; no runtime, database, Citus, browser, live-scanner, or physical-printer result is claimed here.

## Customer-ready procedure draft

1. Export the current SharePoint inventory and import existing printed tags as supplied. Do not regenerate tags during import. Keep the import report and resolve duplicate tags with a human-reviewed asset-to-label reconciliation; blank tags may remain blank until explicitly assigned.
2. In asset numbering settings, review the duplicate audit and tag matching rule. Set each client's asset prefix, then inspect the legacy suffix continuation preview across all imported tags. Approve an explicit next value and padding before activation. A preview does not reserve a number. The sequence is tenant-wide across clients, so prefixes affect presentation rather than allocation.
3. For equipment already on hand, create a minimal asset or reserve a number using the approved label-first flow. Print two copies for each asset: attach one to the equipment and one to its box. Complete the remaining inventory fields later by scanning either label; the scan should open the same durable asset record.
4. To find an existing asset, scan its printed tag or search by tag. To replace a damaged label, reprint the stored asset label; reprinting does not issue another number. Do not treat sequence gaps as missing assets: abandoned reservations are not reused to avoid assigning an identifier that may already have been printed.

## Customer response draft — unsent

Hi Ryan,

We’re preparing an Alga workflow for your existing numbered labels and new equipment. The intended setup keeps one sequence for your organization, adds each client’s prefix when the asset tag is formatted, and prints two copies of the same stored tag so one can go on the equipment and one on its box. You’ll be able to keep existing printed tags, review the next sequence value before enabling numbering, and scan a label later to finish the same asset record. Reprinting will use the asset’s existing tag.

Before activation, we’ll review any duplicate tags in the imported inventory with you and agree on the continuation value. Previewing does not reserve a number, and abandoned issued numbers may leave gaps so a number that has already been printed is never reused.

We’ll confirm the setup and walk through a sample intake once implementation and label-output checks are complete.

Regards,
Alga Support

This is a draft only. Do not send it or post it to the PSA ticket from this step.
