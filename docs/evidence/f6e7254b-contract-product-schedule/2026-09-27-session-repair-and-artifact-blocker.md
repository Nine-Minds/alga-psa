# 2026-09-27 session repair and artifact blocker

Narrow mitigation round for PR #3492: restore the alga-dev browser attachment for
newly created card-space panes and capture fresh UI evidence against the
board-managed app on port 3029 at expected HEAD `0d6fa4fe90`.

Captured: 2026-09-27T16:24Z–16:34Z by `agent:Draft Implementation`.

## 1. Checkout and served artifact

- Worktree branch `feature/contract-products-schedule-quantity-and-price-ch`,
  HEAD `0d6fa4fe9089978be1fd8aecfc071584ce875ee3` (matches the expected HEAD).
  `git status` has no tracked-tree modifications; `server/.next-review/` and
  `xo-implement-review.md` are untracked board/build artifacts and were left
  alone.
- Board-managed app for `devPort` 3029:
  - `review-app` card service listens on `http://100.109.101.64:23029`
    (`/api/health` 200) and advertises itself as `http://localhost:3029`
    (`APPLICATION_URL`/`NEXTAUTH_URL`). Its recorded artifact stamp is
    `d49a53301a664e8a170bc5423ea1fb6e28258e57+da39a3ee5e6b`, built
    2026-09-27T15:36–15:39Z — the **parent** of the expected HEAD, not `0d6fa4fe90`.
  - The board-managed `:3029` dev server (`card-service … dev-server:2`,
    `PORT=3029 npm run dev`) was live 2026-09-27T16:11:34Z–16:21:57Z and was
    stopped (killed by request). Nothing listens on `:3029` now.

## 2. Attachment failure: cause and repair

Cause. An orphaned Chromium from the older release `202609231232-g9aaabf1979`
(pid 1304023) had held the CDP loopback port `47810` for ~3.7 days. The current
agent (release `202609240402-gac64340174`) could not bind that port, so every new
Chromium it launched exited with `SIGTRAP` within ~70 ms; `launchAndWaitForCdp`
then accepted the pre-existing (orphan) listener, and the agent's
`handleBrowserClosed` immediately closed the CDP socket it thought belonged to
the crashed process. Closing a CDP socket destroys its flattened sessions, so
every pane's stored session became invalid. Existing and freshly created panes
alike returned `Session with given id not found` on navigate / get-url / DOM /
screenshot.

Repair (no app-server start, restart, or rebuild):

1. Identified the port holder: `ss -ltnp` → `127.0.0.1:47810` owned by pid
   1304023 from release `202609231232-g9aaabf1979`.
2. `kill 1304023`.
3. The agent launched its own Chromium from release `202609240402` (new pid
   1603130, now serving `47810`); `SIGTRAP` stopped at 16:27:12Z and the process
   has remained up since.

## 3. Browser control restored (four operations)

Fresh card-space pane `184b1d2f-9459-432b-9241-36e6063d6b9d`
(space `2338d375-20b5-4917-8757-ecd2d0d2cb8d`, tab
`602dd96e-bba9-416e-9b8e-dfac30039298`), title `smoke-evidence-0d6fa4fe90`:

| Operation | Result |
| --- | --- |
| `browser-navigate http://localhost:23029/api/health` | success |
| `browser-get-url` | `http://localhost:23029/api/health` |
| `browser-get-dom --query=body` | `count: 1` |
| `browser-screenshot --save` | `2026-09-27-01-browser-repair-health.png` |

The screenshot renders `{"status":"ok","version":"1.0.0"}`. An earlier probe pane
`1c36b8da-98f5-4bc1-8c8a-83aaf8b9d414` produced the same results. HTTP health
checks alone were not treated as success; all four operations were run.

## 4. Live UI evidence: BLOCKED (artifact mismatch)

Expected for this round: the board-managed app at HEAD `0d6fa4fe90` showing the
Oct 16 mid-period `+3` preview (read-only effective-from `2026-11-01`, `$154.84`
true-up, "true-up included" copy), the boundary-only "no mid-period adjustment"
copy, decrease/zero previews, saved history, and INV-000039 `$3,900` /
INV-000040 `$4,200` with original quantities.

Observed:

- `:3029` is not listening, so the expected board-managed service is unavailable.
- The only live board app, `review-app` on `:23029`, serves artifact
  `d49a53301a` (parent of HEAD):
  - its compiled chunks still reference the pre-fix `invoiceWindow"` locale key
    and do not contain `invoiceWindowMidPeriod`
    (`grep server/.next-review/static/chunks`), and
  - in that source the panel's `recurring-effective-…` input is still bound to
    `boundary`, not `standingBoundary`, so the read-only `2026-11-01` display the
    acceptance requires is not implemented.
  - The app redirects the browser to its canonical `APPLICATION_URL`
    `http://localhost:3029` (dead). Navigating `http://localhost:23029/msp/billing`
    yields `browser-get-url` → `http://localhost:3029/auth/signin?callbackUrl=%2Fmsp%2Fbilling`
    and DOM `chrome-error://chromewebdata/`. `2026-09-27-03-review-app-redirect-dead-3029.png`
    is the resulting blank Chromium error page.

Per the work order ("Do not start, restart, or rebuild the app server … If it is
unavailable or serves a different artifact, report that blocker rather than
substituting stale screenshots"), no server was started or rebuilt and no
changed-code UI screenshot is claimed. Live changed-artifact UI smoke remains
incomplete.

## 5. Database ground truth (fixture, read-only)

Tenant `6d178771-ad9a-4d43-8809-83992745f8f9`, client
`a45c2805-76b5-4834-a6c0-e28b553448a4`, contract
`51d53c43-e59d-4461-80fe-854e00774fa9`, line
`d3076f7b-6256-46d7-be20-e63efacc6f45`, Users config
`f082bf04-1f71-4f5a-93c4-91db20fd8ac8`.

- Revision `eb53e098-5498-426d-99ac-2c5780219dcc`: Users quantity `23`, effective
  `2026-09-01`, no mid-period date, catalog, v1.
- Revision `f2b22d7d-225c-4b53-bc6d-b903f2c650b4`: Users quantity `26`, effective
  `2026-11-01`, `mid_period_effective_date = 2026-10-16`, catalog, v1.
- Adjustment `8ad12de4-d7db-44c8-bece-f5190a085500`: delta `+3`, unit rate
  `10000` (`$100`), covered `16/31` days, amount `15484` (`$154.84`), status
  `pending`, unsettled. Exactly one such row.
- INV-000039 `d8816325-32a7-4a58-b000-ff987b99f6fe`: Users 20 × `$100`,
  Endpoints 30 × `$50`, Locations 2 × `$200` → `$3,900`.
- INV-000040 `e2d0a40e-e5be-4fea-baa7-6b76e7d0ddd8`: Users 23 × `$100`,
  Endpoints 30 × `$50`, Locations 2 × `$200` → `$4,200`.

No rows were modified; the existing revision/adjustment was not duplicated.

## 6. Checks

| Scope | Command | Result |
| --- | --- | --- |
| UI suite | `packages/billing`: `npx vitest run tests/RecurringUnitSchedulePanel.test.tsx tests/RecurringUnitSchedulePanel.translations.test.tsx` | 2 files, **8/8 passed** |
| PostgreSQL | `server`: `TEST_DB_NAME=test_db_pcs_sched REQUIRE_DB=1 npx vitest run src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` | 1 file, **119/119 passed** |
| Typecheck | `npm run typecheck --workspace=@alga-psa/billing` (`NODE_OPTIONS=--max-old-space-size=6144`) | passed |
| Typecheck | `npm run typecheck --workspace=@alga-psa/shared` | passed |

No infrastructure source was changed, so no new pane-creation unit test was
added; creation and attachment of a fresh pane were exercised manually as
recorded above.

## 7. Remaining blockers (review first)

1. Bring the board-managed app back at HEAD `0d6fa4fe90` (restart/rebuild the
   `:3029` dev server, or restart `review-app` so it rebuilds to HEAD), then rerun
   the mid-period walkthrough for real UI evidence.
2. The durable fix belongs to the `ghostty-pane-ide` repository, not this billing
   branch: `BrowserHost.startBrowser` / `launchAndWaitForCdp` should detect a
   pre-existing CDP listener / port conflict and adopt or fail deliberately
   instead of accepting another process's browser, and `handleBrowserClosed`
   should not tear down a runtime it did not own. The repo already has per-pane
   CDP session recovery (`a9d51e5`) that is not deployed in the running release.
3. Align the `review-app` `APPLICATION_URL`/`NEXTAUTH_URL` with its actual port
   (`23029`), or publish it on `3029`, so browser navigation does not dead-end.

## 8. New vs historical captures

`2026-09-27-01-browser-repair-health.png` and
`2026-09-27-03-review-app-redirect-dead-3029.png` are new captures from this run.
All other files and the earlier README sections are historical evidence for
other commits.
