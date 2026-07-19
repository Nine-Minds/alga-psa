# Marketing Module — Pre-Smoke Fixes + Agent-Driven E2E Smoke Test

- Date: 2026-07-19
- Branch: `feature/marketing-module`
- Findings source: `ee/docs/plans/2026-07-19-marketing-module/PRD.md` → "Code Review Findings —
  Pre-Smoke Fix List (2026-07-19)" (IDs B1–B2, M1–M12, N1–N19 referenced below)

## Objective

Fix every code-review finding, prove the fixes with the real-DB test suites, then smoke-test
the entire marketing feature end-to-end — agent-driven, in the browser, against the live dev
stack — iterating on anything that breaks until every leg passes with recorded evidence.

## Environment (already wired — do not re-provision)

- Dev server: `npm run dev` in `server/` on **port 3105** (env in `server/.env.local`;
  `marketing-module` flag forced on via `NEXT_PUBLIC_FORCE_FEATURE_FLAGS`).
- Shared DB: compose project `alga-psa-local-test` — pgbouncer `localhost:6472`, postgres
  `localhost:5472`; redis `6380`.
- **Migrations caveat:** `npm run migrate:ee` fails in this tree (shared `knex_migrations` has
  sibling-branch records). Apply new migrations programmatically via `knex.migrate.up` with
  `disableMigrationsListValidation` (see prior wire-up notes). Never run the four renamed
  opportunity migrations `20260712105100–105400` (pending duplicates of applied ones).
- **GreenMail** is running: SMTP `localhost:3025`, IMAP `localhost:3143` — use it as the
  tenant SMTP target so sequence sends are verifiable over IMAP.
- After any clean checkout: `npx nx build-deps server` (root `npm run dev` does not run it).
- The uncommitted `packages/build-tools/tsup-preset.ts` fix (directory imports →
  `<dir>/index.js`) is required for the server to boot — commit it as its own commit first.
- Browser automation: `algadev` browser panes against `http://localhost:3105` (algadev skill).

## Phase 0 — Fixes

Work through the PRD fix list. Suggested commit grouping (each commit builds and passes unit
tests; keep fixes reviewable, don't lump unrelated areas):

1. **Blockers** — B1 (suppression join-update → select-then-`whereIn`), B2 (idempotent
   send claim: new `marketing_sequence_sends` table with unique
   `(tenant, enrollment_id, step_id)`, claim persisted inside the claim transaction, advance
   before lock release, interaction recorded after successful send; delete the false
   `skipLocked` comment).
2. **Data-layer migrations** (one additive migration alongside B2's table): M12 (enrollments→
   contacts FK `ON DELETE CASCADE`), N4 (partial unique index on active enrollments + conflict
   handling), N5 (suppression `lower(email)` uniqueness), N6 (`marketing_engagements
   (tenant, step_id)` index), N7 (`marketing_sequences.campaign_id` + stamp on engagements).
   Register any new table in both tenantTableMetadata copies. Apply to the shared DB via the
   caveat above.
3. **Logic majors** — M1 (null `client_id` in capture), M2 (flip job driven off target state),
   M3 (sequence step diff-in-place), M4 (guarded UPDATE in mark-published).
4. **Public-surface majors** — M5 (HMAC-signed click destinations), M6 (POST unsubscribe +
   RFC 8058 headers, GET = confirmation page), M7 (trusted-proxy IP + per-form cap).
5. **UI majors** — M8 (reschedule from awaiting), M9 (journey day labels), M10 (guard-failure
   boundary on all 7 pages), M11 (timezone-neutral date-only handling).
6. **Minors** — N1–N3, N8–N18 as described in the PRD list (N19 needs no code change).

Update or add unit/integration tests alongside each fix where the finding identified a
coverage hole (B1, B2 concurrency/crash windows, M2, M4, N10's test update).

### Phase 0 verification gate (must pass before Phase 1)

- `npx nx build-deps server` + typecheck clean.
- Marketing unit tests green.
- Marketing DB-backed integration suites (T001–T013 files) executed **against the stack DB**
  — the suites auto-skip without a DB; the run must fail if executed-test count is zero.
- OpenAPI/MCP registry regenerated if any endpoint signatures changed; no drift.

## Phase 1 — Agent-driven E2E smoke test

Execute in the browser at `localhost:3105` (algadev panes), with DB/curl/IMAP checks as
evidence alongside screenshots. Record everything in
`ee/docs/plans/2026-07-19-marketing-module/SMOKE-REPORT.md`: per leg — actions, expected,
observed, evidence (screenshot path, SQL result, IMAP message id), pass/fail.

**Iteration rule:** when a leg fails — fix, commit (referencing the leg), re-run the failing
leg plus any leg the fix could affect, append the failure + fix to the report. Repeat until
all legs pass.

**Job triggering:** post flips and sequence sends run as scheduled per-tenant pg-boss jobs.
Nudge `scheduled_at` / `next_send_at` into the past via SQL and wait one cadence; if the
cadence is impractically long for smoke, invoke the handler internals directly via a one-off
script (same code path as the job body) and note that in the report.

### Legs

1. **Nav & gating** — Marketing section visible with the flag on; all 7 pages (calendar,
   posts, content, campaigns, sequences, channels, forms) render with real chrome (no
   empty-shell lies). Spot-check M10: a session without the flag/permission sees the
   boundary, not a fake module.
2. **Setup** — create 2 channels (different platforms), 1 content piece with per-channel
   variants, 1 campaign with date range (verify M11: dates round-trip without drifting).
3. **Post lifecycle (UI publish)** — create a post from the content piece targeting both
   channels, scheduled in the near future. Nudge due → flip job → both targets
   `awaiting-manual-publish`; post appears in the calendar Today card and amber
   needs-publishing rail. Copy rendered text (verify per-channel variant), mark one target
   published with permalink. Verify: published log, `social_post_targets` row
   (permalink/published_at/published_by), "Marketing: Post Published" interaction — exactly
   one (M4). Verify the second target is still awaiting and independently publishable (M2).
   Reschedule an awaiting post to tomorrow (M8) and confirm targets return to `scheduled`.
4. **Activities integration** — with a target awaiting, the User Activities dashboard shows
   the publish item (overdue → HIGH); its link lands on the posts queue (N10); the item
   disappears after publishing.
5. **Agent publish loop (API)** — with an API token holding `marketing:manage`: discover
   endpoints via the registry, list due posts, fetch rendered content, mark published with
   permalink via curl (MCP drives these same endpoints). Verify a `marketing:read`-only token
   is denied the mutation.
6. **Capture → opportunity handoff** — create a capture form; submit the public endpoint
   (browser + curl) for (a) a brand-new email and (b) an existing contact with no client
   (M1's case). Verify: marketing contact state, `form_submitted` interaction with campaign
   attribution, inbound-lead `opportunity_suggestion`. Accept it in the Opportunities UI;
   verify the opportunity carries source attribution and the engagement timeline. Verify
   honeypot and rate-limit rejections still return the generic 200 (no oracle).
7. **Sequence nurture** — point tenant SMTP at GreenMail. Create a 2-step sequence (0-delay +
   short delay); enroll the captured contact; trigger sends. Verify: emails arrive via IMAP
   (3143) with unsubscribe + tracking links present and `List-Unsubscribe(-Post)` headers
   (M6); enrollment advances; `email_sent` interactions recorded once per step (B2 — re-run
   the send job after step 1 and confirm no duplicate email arrives). Hit the tracking pixel
   and click redirect from the received email: `email_opened`/`email_clicked` interactions
   recorded; click 302s only to the signed destination — a tampered `u` is refused (M5).
   Edit the sequence (add a step) and confirm historical per-step stats survive (M3).
8. **Unsubscribe & suppression** — GET the unsubscribe link → confirmation page (no state
   change); POST → suppression row, enrollment stopped, `marketing_contact_state`
   unsubscribed (B1 fix proven live). Re-trigger sends → zero emails to the suppressed
   address. Re-submit the capture form with that email → generic 200, no re-enrollment.
   Delete the contact in the UI → deletion succeeds (M12) and the suppression row survives.
9. **Funnel & wrap-up** — campaign detail shows posts/sequences/forms lists (N17) and a
   funnel with non-zero sent/opened/clicked/captured/suggested/accepted from the legs above
   (N7). Calendar week stats match the labeled week (N12).

## Exit criteria

- All PRD findings B1–B2, M1–M12, N1–N18 fixed and committed (N19 satisfied by this smoke).
- Phase 0 verification gate green, integration suites demonstrably executed (not skipped).
- All 9 smoke legs pass with evidence in `SMOKE-REPORT.md`, committed to the branch.
- Durable discoveries recorded to the lane:
  `alga-dev workflow-add-fact --projectId=8c6eaf29-7c86-41a3-8e93-952a1335ca61 --step='Draft Implementation' --text='<truth>'`
  (binary lives at `~/.local/bin/alga-dev`).
