# PR #3499 mitigation status — 2026-10-11

## Revisions and live entry

The current PR branch/upstream head is evidence-only commit
`833ee3238148d48f96dbfbf321416d8a57e2f325`. The application build remains
`0826a475429d25fe5a3647ef6a5e7df7c241e7cf+da39a3ee5e6b`; it predates the
later evidence commits and does not contain a production application-code
change from this mitigation. The production review app health endpoint returns
200 at <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185>.

## Isolated authoring fixture

Created through the production Contract Templates authoring wizard:

- Published template `REVIEW-3499-MITIGATION-TWO-FIXED-LINES`, ID
  `566a5bd6-2435-4818-b147-60edf805adbd`.
- Distinct source lines, both using Fixed billing: service line
  `89e47435-bb9c-4d48-801c-91d80c1d4c4c` (Managed Workstation) and product
  line `edab1b08-848b-4946-8b1d-265dae4ee428` (Cabling).
- Configured default `REVIEW-3499-MITIGATION-DEFAULT-10P`, 10%, “This contract”,
  start date 2026-10-11.
- Screenshot: [`two-fixed-line-template.png`](two-fixed-line-template.png).

Two isolated clients were created through Clients quick-create:
`REVIEW-3499-MITIGATION-CLIENT-A`
(`1992b9da-939c-4be1-a110-ed6356a5dd69`) and
`REVIEW-3499-MITIGATION-CLIENT-B`
(`ab0d087c-c435-42c8-90a3-256fd304f268`). The template page currently reports
zero client assignments. Finish Setup for the first contract wizard POSTed
HTTP 500 and did not create an assignment. Both clients exist, as verified in the review database; there are no
client-contract assignments for either. Thus this is a usable isolated authoring fixture, but the
requested independent copies, edits, assignment targeting, invoice generation,
preview/PDF, retry, and ledger assertions remain unproven. Do not report them as
complete or mutate billed history to force a retry.

The earlier template `REVIEW-3499-MITIGATION-TEMPLATE`
(`533a7ca9-a6f1-49f0-a8a6-dd1ed27306b2`) has one fixed line with two services;
it is retained as older authoring evidence and does not prove distinct same-
method lines. Existing shared `REVIEW-3499-DISCOUNTS` was not modified.

### Schema diagnosis

The initial `time_tracking_sessions` error came from `StopwatchProvider` calling
`getMyStopwatch()` on the billing shell; it was not the client-creation action.
The current checkout includes the session creation migration and its conversion
follow-up. After checking an unlocked migration ledger, no open legacy time
entries, and non-Citus schema configuration, the ordered migrations
`20261009120000`, `20261009120100`, `20261009130000`, and `20261009140000` were
applied through the migration modules (ledger batch 62). The session relation
and required `time_entries.end_time` constraint then existed. Retrying the
client wizard still returned 500 (79ms); the production server action response
was masked as a generic React server-action error. The exact underlying wizard
exception is not exposed by the browser network response or available review
server output, so a distinct client-instantiation failure remains unresolved.
This did not block the initial client creation, which had succeeded before the
wizard attempt; do not attribute that wizard failure to the earlier stopwatch
query.

## Open Review repair

The named pane failure was a remote backend handoff race: renderer tab creation
was acknowledged before remote browser registration. The app host and pane
suffix matched, ruling out stale ID/space mismatch. The owning Alga Dev repo is
`/home/robert/alga-dev-open-review/ghostty-pane-ide`, separate from this app.
Its resolver waits for remote registration and now calls `wakePane` before
reusing a registered backend, preserving the existing activity/reaper refresh.
It returns undefined on timeout or if the backend disappears after wake.
Alga Dev commit `69cb91d` contains the final tests; its prior owning change is
`df8e9c219b38049f60fca8bd332e698181ddc46`. Focused tests pass (25 tests), and
TypeScript check passes using writable `TMPDIR=/dev/shm/alga-dev-review-vitest`.
The supported activation is `npm run deploy:publish` from the Mac checkout per
that repo's fleet runbook. The Mac checkout/release command was not reachable
from this host, so activation and live absent/existing/repeated Open Review
calls have not been proven. No further Open Review call was made because the
launcher resets a per-checkout login credential; do not use it against shared
credentials without a safe isolated target.

## Older scope evidence (not current production generation)

Exact-head development evidence in `../repair-0826a475/` demonstrates the
financial distinction: all eligible charges, 390000 plus eligible unattributed
manual 15000, yields discount -40500 and total 364500 before tax; “This
contract” yields -39000 and 366000 when the manual charge is outside the
contract's base. That evidence is not a current-production automatic generation
or retry proof.

## Delivered QBO history — preserve unchanged

`REVIEW-3499-QBO-NEXT` is delivered history: invoice
`5a1e0000-0000-4000-8000-202610079004`, batch
`3ac31e06-9479-4f5d-9c73-170a880d80d9`, simulator invoice `invoice-21`,
principal/total 385000 minor units and simulator `TotalAmt`/`Balance` 3850.
Keep its exported editing protections. Do not unlock, reset, delete, or
re-export it. Existing evidence is in `../final-rerun-0826/`.

## Reset procedure after human review

From the production Contract Templates UI, delete the isolated two-line template
and its default discount after removing any assignments (currently none). Delete
the older one-line mitigation template and its discount only if desired. Remove
clients A and B through Clients UI only after confirming they remain unused.
Do not touch shared `REVIEW-3499-DISCOUNTS`, delivered QBO history, shared
credentials, or invoices with billed periods.
