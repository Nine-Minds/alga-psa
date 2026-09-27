# Board service lifecycle repair — 2026-09-27

Tested branch head: `15ddcc7ffe4db9cdeb219d281858e3361a444723` (unchanged during this repair). The worktree was clean except for the pre-existing untracked `server/.next-review/`, which remains untouched.

## Service registration and policy

The board had no live `dev-server` registration. Historical card service records showed all attempts concluded; the saved 8 GiB `dev:turbo` record and readiness path were in `/tmp/alga-smoke-evidence/contract-invoice-adjustments-20260927-2016/services-redacted.json`. The card template already had `Smoke Test.services: [{"name":"dev-server"}]`, but the current Draft Implementation step did not permit use. That mismatch explains immediate suspension while Draft was current.

Temporarily added `dev-server` to Draft Implementation's service-use list to start the service under board supervision. Created registration `card-service:b97eda7b-0e3f-4b09-be80-6b57f934d8a5:dev-server:12` with:

- cwd `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc/server`
- command `NODE_OPTIONS=--max-old-space-size=8192 HOST=0.0.0.0 PORT=3185 npm run dev:turbo`
- health path `/api/health`, port `3185`

Immediately called `alga-dev workflow-ensure-service --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5 --name=dev-server` without `--command`; it returned the saved live registration (`created:false`) and the expected cwd/command. After testing, removed the temporary Draft Implementation service-use entry. Verified Draft Implementation has no service use and Smoke Test still declares `dev-server`. Removing the Draft use caused the board to suspend the supervised PTY while retaining its registration. The card itself was not advanced.

`curl http://127.0.0.1:3185/api/health` returned `{"status":"ok","version":"1.0.0"}` (HTTP 200). Ten consecutive health probes during UI navigation all returned HTTP 200 (6–10 ms), and a further command-free ensure plus health check immediately after restoring Draft's policy also passed; the board suspended the process shortly afterward because Draft no longer uses it. Service status remained `live` through the UI navigation and health series. After Draft service-use permission was removed, the board automatically changed session `:12` to `suspended` with reason `"Draft Implementation" does not use it`; the saved cwd, command and readiness definition remain present, and Smoke Test still declares `dev-server`. The post-cleanup `:3185` endpoint is therefore expected to be stopped while the card stays on Draft. The card was not advanced, as instructed, so the actual transition into Smoke Test was not exercised in this repair round. Largest observed Node RSS was approximately 4.2 GiB. No OOM recurred. The earlier 9.7 GiB Turbopack cache had already been quarantined intact at `/tmp/contract-invoice-turbopack-cache-pre-repair-20260927`; no cache or unrelated data was deleted in this round.

The card browser pane successfully loaded the authenticated app at `http://localhost:3185/msp/billing?tab=invoicing&subtab=drafts`; current view is captured in `current-head-invoicing-drafts.png`. Authentication continued to use the worktree's configured auth origin. Environment wiring was inspected without copying credentials: compose project `alga-psa-local-test`, PostgreSQL 5472, PgBouncer 6472, Redis 6419.

## Behavioral evidence on this exact commit

The latest environment-only failure report followed a completed same-head smoke. `15ddcc7ffe` contains [takeover/README.md](../takeover/README.md), its UI screenshots, assertions, fixture SQL, PDF output, and cleanup records. That committed evidence records the actual UI and persisted-data results on this exact tested commit:

- Posted invoice principal matched totals through add/edit/repeat/remove: 390000 → 405000 → 420000 → 390000 minor units; repeat operations created no additional postings.
- UI template authoring/reload/edit/cancel, two independent client copies, distinct same-method template lines, template-edit isolation, and client-copy isolation passed.
- PDF and invoice preview matched persisted line/totals for the posted invoice. Earlier same-day evidence in `current-head-smoke-2026-09-27/` covers manual fixed/percentage discounts, repeat save, taxable treatment, signed partial-period increase/decrease, and PDF parity.
- Finalized lifecycle controls were excluded in the UI; finalized/paid/cancelled/exported protections are covered by database behavioral regression. Fixture cleanup and shared invoice preservation are recorded in `takeover/cleanup.json`; this round repeated the UI fixture and cleanup, with zero owned invoice/transaction rows afterward in `cleanup-verification.txt`. The shared `SMOKE-ADJ-1` and `INV-000039` rows retained their observed totals and revisions.

This service repair did not create or mutate an invoice fixture, and did not touch `SMOKE-ADJ-1`. A fresh read-only database snapshot after this repair confirms `SMOKE-ADJ-1` remains 371400 minor units at revision 63, `INV-000039` remains 390000 at revision 0, and the owned takeover invoice is absent. See `database-current-snapshot.txt`. The shared fixture remains drifted from earlier operator activity; its value is preserved as observed rather than treated as the canonical target.

## Coverage limits

Portal invoice output remains unverified because no authenticated client-contact session was available. No accounting export artifact or external posting was produced. Companion `f6e7254b` owns permanent recurring quantity changes and automatic `contract_change` true-ups; this manual calculator smoke is not combined-companion acceptance. See the linked takeover report for exact limitations.

## Current-round checks

- `contractInvoiceAdjustments.db.test.ts`: **46 passed** on isolated `test_contract_invoice_repair_20260927` using PostgreSQL port 5472. This includes ledger reconciliation, manual calculator persistence, template-copy independence, same-method source lines, and lifecycle behavior.
- `npx nx run @alga-psa/billing:build --skip-nx-cache`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=@alga-psa/billing`: exit 2 with **11 diagnostics**, identical in count and locations to the committed takeover baseline. All are in unchanged `profitabilityReportActions.ts` and `packages/ui/src/editor/{AiResponseBlock,MentionSuggestion,TextEditor}.tsx`; no typecheck-clean claim is made. Raw output and normalized diagnostic list are `typecheck-output.txt` and `typecheck-diagnostics.txt`.
- No product/UI text changed in this service-only repair, so localization checks were not rerun.
- No product source changed. The current-round browser reloaded the app after service repair and used the owned posted fixture from `takeover/posted-fixture-create.sql`. A freeform 2 × $12.34 charge changed invoice total/principal from 390000 to 392468; repeat save left one adjustment posting. Editing the rate to $15.00 changed total/principal to 393000; repeat save left two adjustment postings; removing the line returned total/principal to 390000 with the three original generated charges. Generated recurring rows stayed in the UI's read-only Automated Line Items section. See `ui-fixture-before.txt`, `ui-fixture-progression.json`, phase DB snapshots, and `screenshots/`. The committed same-head takeover and current-head-smoke artifacts linked above are the behavioral evidence for invoice mutations and customer output. The current Smoke Test step declares the saved service, but actual lifecycle transition back into that step remains unverified because the instruction explicitly forbids advancing the card.

The workflow template updater refreshed role-judgment metadata while applying both temporary policy changes. The only intended policy change was the temporary Draft Implementation `dev-server` use entry; it was removed afterward. Smoke Test's existing service-use entry remains. The temporary change and its removal did not advance the card.
