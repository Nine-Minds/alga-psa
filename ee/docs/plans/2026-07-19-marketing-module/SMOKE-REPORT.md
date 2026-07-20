# Marketing Module — E2E Smoke Report (2026-07-19)

- Stack: dev server `localhost:3105` (worktree `feature-marketing-module`), shared DB compose
  project `alga-psa-local-test` (postgres `localhost:5472`), GreenMail SMTP `3025` / IMAP `3143`.
- Driver: agent-run browser (alga-dev panes) + psql/curl/IMAP evidence.
- Users: `glinda@emeraldcity.oz` (Admin, marketing perms), `dorothy@kansas.oz` (Manager, no
  marketing perms). Tenant `dd8cb218-d46d-47f3-be27-8aa50aad5fce`.
- Screenshots: `/tmp/ghostty-pane-ide/screenshots/` (copied into `smoke-evidence/` beside this
  report where noted).

## Leg 1 — Nav & gating — PASS

**Actions:** Signed in as glinda; visited all 7 marketing pages. Signed in as dorothy; opened
`/msp/marketing/posts` directly.

**Expected:** Marketing nav visible with flag on; 7 pages render real chrome; dorothy sees the
guard boundary (M10), not a fake module.

**Observed:**
- All 7 pages render with real headings and controls: Marketing calendar (24 buttons), Posts,
  Content, Campaigns, Sequences, Channels, Capture forms.
- Dorothy on `/msp/marketing/posts`: "No access to Marketing — You do not have permission to
  view marketing." No module chrome leaked. Evidence: `leg1-dorothy-boundary.png`.
- Glinda calendar evidence: `leg1-calendar-glinda.png`.

**Notes / observations:**
- The "Marketing" left-nav entry is still visible to dorothy (nav is feature-flag-gated but not
  permission-gated). Clicking it lands on the M10 boundary, so no data or fake module is
  exposed; flagging for a reviewer to decide whether nav should also be permission-gated.
- Environment fix during this leg: glinda's seeded `hashed_password` failed verification
  (pepper mismatch from earlier seeding); reset by copying dorothy's valid hash (scheme is not
  user-bound). Not a product bug.

## Leg 2 — Setup (channels, content, campaign) — PASS

**Actions:** Created channels "Oz LinkedIn" (linkedin, @ozmarketing) and "Oz X" (x, @ozdotx)
via the New-channel dialog (also exercised channel Edit to change a platform). Created content
"Yellow Brick Roadmap Launch" with base markdown body plus linkedin and x platform variants.
Created campaign "Emerald City Launch" (draft, start 07/19/2026, end 07/31/2026) via the
calendar pickers, then edited the content to attach the campaign.

**Expected:** Entities persist; campaign dates round-trip with no timezone drift (M11).

**Observed:**
- `marketing_channels`: `53e78719… Oz LinkedIn linkedin t`, `f1c891e0… Oz X x t`.
- Content list row: `Yellow Brick Roadmap Launch | Emerald City Launch | 2 (variants)`.
- `marketing_campaigns`: `430b4f68… Emerald City Launch draft 2026-07-19 2026-07-31` —
  date-only columns; after full page reload the list shows `Jul 19, 2026 / Jul 31, 2026` and
  the edit dialog pickers show `07/19/2026 / 07/31/2026`. No off-by-one drift (M11 pass).
- Evidence: `leg2-channels.png`.

> **Session note.** The smoke run was split across two agent sessions: the IDE hub restart
> (~22:07 EDT) killed the first mid-run, and its Playwright continuation died again at ~22:48
> after enrolling the leg-8 fixture contact. Legs 3, 4, 6, and the first half of 7 below were
> executed by those earlier sessions (their screenshots are in the evidence dir; per-leg fix
> commits `a7b332cbe5`, `27a5de5b27`, `ad119276c3` reference the failures they hit); the
> resumed session re-verified every leg's end state in the database before continuing, and
> executed leg 5 re-verification, the leg-7 tracking/M3 checks, and all of legs 8–9 live.
> Browser driving: alga-dev panes were unreachable after the hub restart ("belongs to a
> different host"), so legs were driven through real Chromium (chrome-headless-shell via
> Playwright CDP) against the same dev server — same product, different driver.

## Leg 3 — Post lifecycle (UI publish) — PASS

**Actions (earlier session):** Created a post from "Yellow Brick Roadmap Launch" targeting
both channels; nudged due; flip job moved targets to `awaiting-manual-publish`; marked
published with permalink from the calendar rail; rescheduled an awaiting post (M8).

**Observed:** Evidence `leg3-01`–`leg3-13` (dialog, datetime picker, needs-publishing rail,
mark-published with permalink, reschedule flow). End state re-verified in DB by the resumed
session: `social_post_targets` = 4 published / 2 scheduled; exactly 4 "Marketing: Post
Published" interactions (M4 — one per published target, no duplicates); published targets
carry permalinks (calendar "PUBLISHED RECENTLY" shows `permalink ✓` on all 4). Fix commit
during this leg: `a7b332cbe5` (activity view routing).

## Leg 4 — Activities integration — PASS

**Actions (earlier session):** With a target awaiting, opened User Activities dashboard;
followed the publish item's link; published; confirmed the item cleared.

**Observed:** Evidence `leg4-01`–`leg4-04`: dashboard shows the "publish" activity, its
actions menu, and the view action landing on the posts queue (N10 fix `a7b332cbe5`). End
state re-verified: zero `awaiting-manual-publish` targets remain and the dashboard no longer
lists marketing items.

## Leg 5 — Agent publish loop (API) — PASS (with pre-existing seed gap noted)

**Actions:** Earlier session minted two API keys directly in `api_keys` (manage=glinda;
read-only=cheshire via a new "Marketing Reader" role). Resumed session re-verified the
authorization matrix live against `/api/v1/marketing/posts/awaiting-publish` and the publish
mutation.

**Observed (`leg5-06-api-key-reverify.txt`):**
- manage key: `GET awaiting-publish` → 200 `{"data": []}` (queue drained by leg 3/4).
- read-only key: `GET` → 200; `POST targets/{id}/publish` → **403
  `Permission denied: Cannot manage marketing`**; no key → 401.
- Registry discovery: `/api/v1/meta/endpoints` 403s for ALL tenants in this shared DB — a
  pre-existing seed gap (no metadata permission rows exist anywhere; Permissions UI has no
  Metadata resource), not a marketing-branch regression. Discovery evidenced instead from
  `sdk/docs/openapi/alga-openapi.ee.json` (28 marketing operations).

## Leg 6 — Capture → opportunity handoff — PASS

**Actions (earlier session):** Created "Roadmap Guide Download" (`/roadmap-guide`); submitted
the public endpoint for new emails and for an existing client-less contact (M1); accepted the
inbound-lead suggestion in the Opportunities UI. Fix commit during this leg: `27a5de5b27`
(public endpoints unblocked; courtship record linked on accept).

**Observed:** Evidence `leg6-01`–`leg6-07` (suggestion cards, accept flow, opportunity
timeline). End state re-verified: `opportunity_suggestions` (generator `inbound-lead`) =
3 accepted + 1 pending; `Marketing: Form Submitted` interactions carry campaign attribution;
`marketing_contact_state` rows created with `source=capture:roadmap-guide`. Honeypot
re-verified live by the resumed session: filled `website` field → 200 with **no contact
created** (silent pre-zod drop, no oracle).

## Leg 7 — Sequence nurture — PASS

**Actions:** Earlier session created "Welcome Drip" (3 steps: 0 min / 1 day / 3 days) against
GreenMail SMTP (3025), enrolled Ozma (both steps sent and verified over IMAP; open + click
recorded 01:36Z) and enrolled Tin Woodman (`leg7-01`–`leg7-04`), then died. Resumed session
completed the remaining checks against Tin Woodman's step-1 email (sent 02:50:34Z).

**Observed:**
- **M6 headers** (`leg8-00-tinman-step1-email.eml`): `List-Unsubscribe:
  <…/api/marketing/unsubscribe/{tenant}/{enrollment}>` and `List-Unsubscribe-Post:
  List-Unsubscribe=One-Click` present; body carries unsubscribe footer, click-rewritten link,
  and tracking pixel.
- **Tracking** (`leg8-01-tracking-curl.txt`): open pixel → 200; valid click → **302 to
  `https://oz.example/guide`**; `Marketing: Email Opened` / `Email Clicked` recorded exactly
  once each.
- **M5 tamper**: same signature with a different `u` → **400**; garbage signature → **400**;
  no interaction recorded for refused hits.
- **B2 idempotent send, demonstrated under real races**: two dev servers briefly overlapped
  on the shared pg-boss queue (the dying session's server + the resumed one). The step-1
  email was delivered exactly once (send log row `status=sent`); the second runner's pass
  logged `skipped: 1` from the claim conflict and the IMAP inbox count stayed at 1 marketing
  email. Re-running the job after suppression sent nothing (`sent: 0`).
- **M3 stats survival** (`leg7-05`–`leg7-08`): added step 4 ("Postscript from the Emerald
  City") via the Edit dialog → "Sequence updated"; steps 1–3 kept their historical stats
  (1 sent · 0% opened / 1 sent · 100% opened / 0 sent); Performance panel unchanged (50%
  open, 50% click). Fix commit during this leg: `ad119276c3` (empty-steps stats guard,
  Performance i18n key).

**Notes:** the earlier session left Tin Woodman's enrollment SQL-rewound to step 0 after the
step-1 send; every subsequent job pass correctly refused to re-send (claim conflict) but the
enrollment sat `active` with a stale `next_send_at`, never advancing. That state is only
reachable by out-of-band SQL tampering (the send log is intentionally at-most-once per
(enrollment, step)); operator recovery = mark the send row `failed` or advance the enrollment.
Noted for awareness, not a product bug. It was cleared naturally by the leg-8 unsubscribe.

## Leg 8 — Unsubscribe & suppression — PASS (B1 proven live)

**Actions (resumed session, all live):** Drove the unsubscribe URL from Tin Woodman's real
email; re-submitted the capture form with the suppressed address; deleted the contact through
the Contacts UI.

**Observed:**
- **GET** unsubscribe → confirmation page "Unsubscribe from these emails?" with a POST form
  (`leg8-03`); suppression count for the address unchanged (0) and enrollment still `active`
  — no state change on GET.
- **POST** (button click) → "You've been unsubscribed" (`leg8-04`); `marketing_suppressions`
  row (`reason=unsubscribe, source=link`), enrollment → `stopped` with `next_send_at=null`,
  `marketing_contact_state.unsubscribed_at` set. **B1's invalid-SQL suppression write is
  definitively fixed live.**
- **Re-trigger sends** → next scheduled pass: `sent: 0`; IMAP inbox count unchanged
  (`leg8-05-capture-resubmit.txt`). Zero emails to the suppressed address.
- **Capture re-submit** with the suppressed email → generic **200**; no re-enrollment (still
  exactly one, `stopped`), suppression row and `unsubscribed_at` intact. (A `Form Submitted`
  interaction is still logged — the log records the event; the machine stays stopped. Same
  behavior as Ozma's earlier re-submits.)
- **M12 contact deletion**: Contacts UI first blocked deletion with the standard core
  dependency guard ("Cannot Delete … 5 interactions" — `leg8-08`; core behavior, predates
  branch). Deleted the 5 interactions through the contact's activity feed UI (`leg8-10`–
  `leg8-12`), then deleted the contact (`leg8-13`/`leg8-14`). Contact row gone; marketing
  enrollment, send-log, and contact-state rows **cascade-deleted** (M12 FK fix); the
  **suppression row survives** with `contact_id` nulled — the durable email-keyed record.

## Leg 9 — Funnel & wrap-up — PASS

**Observed (`leg9-01`–`leg9-04`, cross-checked in `leg9-03-funnel-db-crosscheck.txt`):**
- Campaign detail (N17): POSTS (6 targets with per-channel status), SEQUENCES (Welcome
  Drip), CAPTURE FORMS (`/roadmap-guide`) lists all render.
- Funnel (N7) all non-zero and exactly matching DB: 4 posts published / 2 emails sent /
  1 opened / 1 clicked / 5 forms submitted / 4 suggestions / 3 accepted. (Email numbers
  reflect Ozma only — Tin Woodman's interactions were removed with his contact in leg 8;
  funnel and DB agree.)
- Calendar (N12): "Week of Jul 19" agenda shows 4 published (Jul 19) + 2 scheduled (Jul 21)
  items; THIS WEEK panel reads Published 4 / Scheduled 2 / Awaiting publish 0 — matching
  `social_post_targets` exactly. Per-channel variant copy renders on each card.

## Verdict

All 9 legs pass. Fidelity notes: GreenMail stood in for a real SMTP/IMAP provider (the
stack's standing simulator); publish "platforms" are manual-by-design (no external platform
API exists to fake); everything else ran against the real dev server, shared Postgres, and
real browser sessions. Known environment quirks recorded in the session notes above: shared
pg-boss queue means sibling worktree servers can race on marketing jobs (B2 held under
exactly that race), and the dev server rotates glinda's password on every boot (use the
boot banner, not the seeded `SmokeTest123!`).
