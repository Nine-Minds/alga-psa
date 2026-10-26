# Guide-recording brief (round 7e137086e6, served build 54e75edfab)

You are recording Co-Managed IT review-guide walkthroughs on the production review build for PR #3363.
The fix in this round (TagManager reconciliation) is already committed and is not your concern.

## Environment
- Worktree: /home/robert/alga-copies/feature-co-managed-it (branch feature/co-managed-it). Do NOT edit tracked source,
  do NOT commit, push, merge, or run git commands that change state. Only write under your own output dirs
  (named below) inside docs/evidence/co-managed-deploy/7e137086e6/guides/.
- Canonical origin: http://feature-co-managed-it.localhost:23374 (production `next start`). Before recording, wait
  until ALL hold: `server/.next-review-final-54e75edf/BUILD_ID` exists, `curl http://127.0.0.1:23374/api/health` is
  200, and `curl http://feature-co-managed-it.localhost:23374/auth/msp/signin` HTML contains that BUILD_ID. Poll with a
  bash until-loop (sleep 30) — the lead is promoting this build; it may take up to ~30 minutes. If it never
  happens, report that and stop. Never start, restart, or conclude any app/service yourself, and never touch other cards.
- Harness: docs/evidence/co-managed-deploy/7e137086e6/guides/scripts/runtime.cjs. Run scripts with
  `CM_REVIEW_DIST=.next-review-final-54e75edf node <script>.cjs`. API: `scenario(rootDir, name, async ({page, ctx, actor,
  go, mark, check, shot, inspect, chapter, out}) => ({status, limitations, remaining, missingResources}))`.
  `actor({name,email,password})` does a real form login; `chapter(title)` starts a WebVTT chapter (call it at the start
  of each guide section you exercise); `check(id, cond, data)` asserts; `sql(q)` is a READ-ONLY psql helper
  (database server_co_managed in container co-managed-it-postgres) — use it only for SELECTs (before/after receipts).
  The harness writes walkthrough.webm, chapters.vtt and recording.json into <rootDir>/<name>/ and verifies the
  served BUILD_ID first. Uses isolated Playwright with /usr/bin/google-chrome (headless).
  Put your scripts in <your guide dir>/scripts/.
- Real UI only for product actions. No direct DB writes. Direct server-action calls only as an explicitly labelled
  negative probe (as earlier rounds did for read-only refusal), never as a substitute for a UI flow you claim covered.
- Mail: SMTP sink JSON at http://127.0.0.1:9177/control/smtp-sink/state/emails (invitations etc.).
- Credentials (never copy secrets into evidence): /home/robert/card-review-private/co-managed-it-3363/
  - qa@emeraldcity.oz (Oz MSP admin with co-managed technician assignment): password in continuation-test-login.json
  - alice@whiterabbit.test (White Rabbit IT customer admin, ACTIVE relationship): reprovision-20261025-active-admin.json
  - admin@kansasfarms.test (Kansas Farms IT customer admin, relationship TERMINATED 2026-10-26T00:13Z): reprovision-20261025-departing-admin.json
  - Fixture IDs: reprovision-20261025-fixtures.json (Oz tenant fa7f912f-…, White Rabbit c64b2666-…, Kansas 3261f313-…, seat pool 3).
  - Do NOT use Glinda, and do not broaden QA's grants to get around a denial (that is a finding, not something to fix).
  - If you create new accounts through a documented flow (e.g. invitation acceptance), store their credentials only
    under /home/robert/card-review-private/co-managed-it-3363/ with mode 600, named cm-review-20261026-<guide>-*.json.
- Docs: guides at docs/guides/co-managed-it/*.md (the spec for each walkthrough), fixtures at docs/dev/co-managed-fixtures.md,
  plan at docs/plans/2026-09-06-co-managed-it-plan.md. Earlier capture scripts (useful selectors/patterns, but bound to
  OLD fixtures — never rerun blindly): docs/evidence/co-managed-deploy/implement-20261025/continuation-ef194916/scripts/,
  docs/evidence/co-managed-deploy/reprovision-20261025/scripts/ (provisioning/acceptance/departure through the real UI),
  docs/evidence/co-managed-deploy/7e137086e6/tagmanager/live/scripts/tagmanager-live.cjs (CSV import pattern).
  The README fixture table in docs/guides/co-managed-it/README.md lists stale IDs — verify everything in the live app.

## Data rules
- White Rabbit's relationship must stay ACTIVE. Kansas Farms is terminated: read-only checks only.
- New records use the suffix `CM-REVIEW-20261026-<guide#>`. Restore reversible settings (policies, mappings, grants,
  allocations you changed) to their original values and record before/after. Preserve messages, time, financial evidence.
- Do not mutate accounts beyond what the guide's documented flow needs. Other agents work concurrently on the same
  server: never change tenant-wide defaults without restoring them immediately, and only touch records you created
  or the specific fixture records the guide names.
- If you find a product defect, record a precise reproduction; do NOT change code.

## Honest coverage (most important)
For each guide produce one recording run (re-run until the recording is clean; keep failed attempts under attempts/ ).
Then write `<guide dir>/guide-result.json`:
{
  "guide": "guides/NN-name.html",                // or "index.html" for the main ticket-screen walkthrough
  "coverage": "covered" | "partial" | "blocked-external",
  "sections": [{"section": "1. …", "result": "Pass|Fail|Blocked|Not run", "evidence": "assertion ids / screenshots", "note": "…"}],
  "actors": [{"name","email","organization"}],
  "steps": ["short human-readable step", …],      // what was actually done, in order
  "outcomes": ["observed, persisted/reloaded result", …],
  "limitations": ["…"], "missingResources": ["named external resource, e.g. 'Stripe test account and USD price'"],
  "dbReceipts": ["relative paths"], "recordingDir": "relative path to the scenario dir"
}
`covered` ONLY if every section's flows were actually exercised in that recording and passed with persisted/reloaded
results. Otherwise `partial` (name what was not reached and why) or `blocked-external` (name the missing external
resource). A recording that only navigates is not coverage. Never relabel older media; never claim what you did not see.
Expected: guide 02 (licence/Stripe), 11 (paid restore / destination entitlement), 12 (Microsoft provider) stay
blocked-external — still record the in-reach parts (forms, boundaries, simulator flows) and say exactly what is missing.

## Report back
Final message: per guide — coverage, sections table, scenario dir path, recording duration, chapter count, defects,
data left behind, and anything uncertain. Keep it factual.
