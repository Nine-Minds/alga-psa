# Departed-customer tag writes: repair and live re-run

A terminated co-managed customer could add a tag to its own ticket, and the tag survived a reload. The workspace should have been read-only. The defect was reproduced on `56e708a31b` / `build-1792957994771`, with evidence in `/tmp/alga-smoke-evidence/co-managed-it-20261025-ece82/04-ended-tag-write/`. It is repaired in `f6203cafff58164fa324424df8c20950107ca3ab`. That commit was built and served through normal board admission, and the reproduction was repeated against it.

## What runs where

| | |
| --- | --- |
| Application source | `f6203cafff58164fa324424df8c20950107ca3ab`, diff fingerprint `da39a3ee5e6b` (clean tree) |
| Build | `build-1792963638060` in `server/.next-review-final-f6203caf` |
| Origin | `http://feature-co-managed-it.localhost:23374` (production `next start`). The sign-in HTML carries the build ID and `/api/health` returns 200 ([runtime-provenance.json](runtime-provenance.json)). |
| Build service | `review-build-prep-f6203caf:21`, prepare-only, admitted normally and concluded after the build ([build log](raw-logs/review-build-prep-f6203caf.txt)) |
| Serving service | `review-app:28`, admitted normally with readiness `23374/api/health`. It reused the stamped build ([start log](raw-logs/review-app-28-start.txt), [admission attempts](raw-logs/board-admission-attempts.txt)). |
| Replaced | `56e708a31b` / `build-1792957994771`. Its supervisor was stopped with `run-card-service.sh review-app --stop`. The card-owned `next-server` it left listening was then sent SIGTERM. |

## Live re-run on the admitted build

Raw output: [first run](raw-logs/live-smoke-run.txt) and [writable re-run](raw-logs/live-smoke-writable-rerun.txt). The departed actor is the disposable departure-fixture administrator (`depart.admin.1792959853966@cmreview.test`, tenant `d46de2e8`, relationship `38db9e8a` terminated). The original reproduction used that same account. `alice@whiterabbit.test` belongs to the active workspace `1f98df77` and serves as the active positive control.

| Scenario | Result |
| --- | --- |
| [01 departed customer](live/01-departed-customer-tags-read-only/recording.json) | **Passed.** The ticket `c7c64319` opened in Entry and then Grid. The existing tag `SMOKE ended tag 1792962099027` is displayed in both. Add (popover and inline), remove and edit controls number 0 in both layouts ([Entry](live/01-departed-customer-tags-read-only/entry-tags.png), [Grid](live/01-departed-customer-tags-read-only/grid-tags.png)). After a reload, the workspace's `tag_mappings` match the snapshot taken before sign-in ([db-receipt](live/01-departed-customer-tags-read-only/db-receipt.json)). Adding a tag is not possible from the screen. The server refusal itself is proven by the PostgreSQL tests below. |
| [02 active co-managed customer (Alice)](live/02-active-customer-alice-tag-write/recording.json) | **Passed.** On her own ticket `cfff4242`, Entry → Tags + → Save persisted one mapping, which survived a reload. Removing it through the product with "Remove & Delete Definition" left 0 mappings and 0 definitions ([db-receipt](live/02-active-customer-alice-tag-write/db-receipt.json)). |
| [03 native PSA (QA)](live/03-native-psa-qa-tag-write/recording.json) | **Passed.** The same journey on the native Oz ticket `68a51c93` (TIC001025) ended with the tag persisted, then fully removed ([db-receipt](live/03-native-psa-qa-tag-write/db-receipt.json)). |

On the first attempt at 02 and 03, the harness did not wait for the "Last Tag Usage" dialog, so the removal step timed out ([failure frames](live/first-attempt/)). The re-run first removed those two tags through the product, then repeated each journey. No `SMOKE tagfix` tag remains.

**Smoke data retained.** The departed fixture keeps tag `6263f9a0-d096-48ae-b552-3ad753007629` ("SMOKE ended tag 1792962099027") and mapping `5189148f-00af-4ef8-abdd-ba6eec3989c8` on ticket `c7c64319`. Both were written by the original reproduction before the repair. They are left in place on purpose, because they show that existing tags stay readable after departure. No account, password or grant was changed.

## Tests

- **Lifecycle admission in PostgreSQL.** The `co-managed tag lifecycle admission` block in `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts` has 3 tests, all passing ([log](raw-logs/integration-tag-lifecycle-focused.txt)). They run as a terminated customer and as positive controls:
  - **Refused writes.** Every tag writer is refused with the lifecycle message: create (new and existing text), update, colour, text, delete, delete with definition, delete-all, the per-entity helper, the caller-transaction writer, bulk apply and the inbound webhook. Table snapshots prove no `tag_definitions` or `tag_mappings` row changed and no event was published.
  - **Reads after termination.** Reads still return the tag.
  - **Positive controls.** Active co-managed and native PSA tenants keep create, colour, text, update, caller-transaction create, bulk apply, delete and delete-all.
- **Guard mutation check.** With all nine guards removed, the denial test goes red ([log](raw-logs/integration-all-guards-removed.txt)). It also goes red when **each guard is removed on its own** ([per-guard log](raw-logs/integration-per-guard-mutation.txt)). The positive controls stay green throughout.
- **Full integration file.** At `f6203caf` the whole file gives 1468 passed and 4 failed ([log](raw-logs/integration-full-file.txt)). The same 4 fail at the parent `ece82ba64e` ([baseline log](raw-logs/integration-baseline-ece82-preexisting-failures.txt)): three ticket-edit tests still expect a rejection, but `56e708a31b` made ticket writes return a lifecycle action error, and T004 gets an undefined `customerAssignee`. They are not caused by this repair, and they are left for their owners.
- **UI.** `packages/tickets/src/components/ticket/__tests__/ticketTags.readOnly.test.tsx` has 4 tests, all passing ([log](raw-logs/ui-ticket-tags-read-only.txt)). They render the real TagManager and TagList in Entry and Grid. With the screen read-only, the existing tags show and no add, remove or edit control is present. On a writable workspace all three controls are present. The UI mutation check ([log](raw-logs/ui-mutation-check.txt)) breaks each read-only gate in turn, and the matching test goes red each time.
- **Static checks.** Typecheck passes for the server (12 GiB) and for `packages/tags`, `tickets`, `co-managed` and `ui`. `check:transaction-threading` (753 files) and `check:dist-resolution` (241 modules) also pass ([raw-logs](raw-logs/)).

## Not covered by this repair

The listed tag writers are outside `packages/tags` actions and were not guarded here. A departed customer reaches them only through these paths:

- the REST API: `server/src/lib/api/services/TagService.ts`, plus the tag writes in `ClientService`;
- `shared/models/tagModel.ts`;
- workflow-runtime contact and client tag writes;
- the ticket-list inline TagManager (`packages/tickets/src/lib/ticket-columns.tsx`), whose writes are now refused server-side but whose controls still render.

The departed ticket screen also still shows other mutation affordances outside the tag scope: Delete, Duplicate, Create Task, Quick invoice and the Materials and Contact add controls.

## Scripts

[scripts/tag-lifecycle.cjs](scripts/tag-lifecycle.cjs) drives the three scenarios. It uses the smoke harness in `/tmp/alga-smoke-evidence/co-managed-it-tagfix-f6203caf/scripts/runtime.cjs`, which stays outside the repository because it embeds a review credential. [scripts/prepare-f6203caf.sh](scripts/prepare-f6203caf.sh) is the prepare-only build command the board ran.

The opening of [implement-20261025/README.md](../implement-20261025/README.md) is generated from its ledgers and this packet's runtime receipt, not typed by hand ([render output](raw-logs/readme-opening-render.txt)):

```bash
node scripts/render-co-managed-evidence-opening.mjs docs/evidence/co-managed-deploy/implement-20261025 \
  --dist=.next-review-final-f6203caf \
  --provenance=docs/evidence/co-managed-deploy/tagfix-f6203caf/runtime-provenance.json   # add --check to verify
```

`completion-verdict.json` and the census are unchanged. No requirement row is promoted here.
