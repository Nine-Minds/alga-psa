# One story on the Co-managed IT tab: a trial and a paid pool must not contradict each other

Status: design for review · card `23c57327-42bb-4b42-b58a-14bd8d461243` · PSA alga-2026-0003413

## 1. Problem (verified at `fe1d1de9f3`)

On a client's **Co-managed IT** tab, three separate components each describe the same seat shape, and
none of them knows about the others:

| Surface | Renders | Reads |
|---|---|---|
| Trial card | "15-day co-managed Seat trial", board pickers, "Invite technician for 15 days" | its own `getSeatTrialOfferAction(clientId)` (`CoManagedSeatTrial.tsx:42-46`) |
| Status card | "Co-managed IT not enabled" | relationship view |
| Enable/shape chooser | Seat + Workspace, pool line, and the red alert | `seat.enable` (`CoManagedShapeChooser.tsx:41,70-76`) |

When the tenant has no `co_managed_entitlements` row (the normal pre-purchase state) but a live trial
sponsor, `readCoManagedSeatEnableState` returns `blocker: 'SPONSOR_NOT_ELIGIBLE'`
(`packages/co-managed/src/seatAdministration.ts:57-66`). The chooser renders that as a destructive alert
("This workspace has no co-managed pool. Add co-managed seats to use this.") and a dead pool line ("0 of
0 seats available. 0 allocated."), directly under the offered trial. Production screenshot, client *Will
It Work LLC*: the same view says *start the trial* and *you cannot use this*.

The defect is structural, not a copy bug: the trial is the **only** surface that knows a trial exists, and
the pool chooser has no way to be told. Fixing copy inside the chooser would answer the screenshot and
leave the next contradiction (trial pending, trial ended) to be found in production. So the fix hoists the
trial state to one reader and decides the Enable surface from a single pure rule.

## 2. One reader, one presenter

`CoManagedSeatTrial` currently owns the offer read, so the parent that composes the tab cannot see it.
Split it:

- **new** `server/src/components/co-managed/useSeatTrialOffer.ts` — a client hook
  `useSeatTrialOffer(clientId?: string)` that owns `getSeatTrialOfferAction`, the loading state and
  `reload()`. One read per client, one refresh path.
- `ee/server/src/components/co-managed/CoManagedSeatTrial.tsx` becomes presentational: props
  `{ offer, onReload, clientId?, onChanged? }`; the four mutations stay, and each one's `refresh()` becomes
  `await onReload()` + `onChanged?.()`. No internal fetch.
- `server/src/app/msp/co-managed/page.tsx` uses the hook through a tiny client wrapper (new
  `server/src/components/co-managed/CoManagedSeatTrialSection.tsx`) for both places it renders the trial
  (standalone when only trial access, and as `purchasePool`).
- `server/src/components/co-managed/CoManagedClientIntegration.tsx` reads the offer once next to
  `seatState` (`:142-149`) and passes it to both the trial card and the chooser.

The offer itself is unchanged; this card does not alter which tenants see it (that rule is card
`24e96db5`'s, see §7).

## 3. One rule for the Enable surface

New pure resolver `server/src/lib/co-managed/seatEnableStory.ts` (same shape as
`clientRelationshipSummary.ts`: no JSX, unit-tested):

```ts
export type SeatTrialStory = 'available' | 'pending' | 'active' | 'ended' | 'none';

resolveSeatEnableStory(input: {
  enable: CoManagedSeatEnableView | null;
  trial: SeatTrialStory;
  purchaseOpen: boolean;
  workspaceOffered: boolean;
}): {
  tone: 'blocked' | 'trial';
  blocker: string | null;      // destructive alert; only when tone === 'blocked'
  notice: SeatTrialStory | null; // neutral note; the trial story
  pool: 'count' | 'empty' | 'hidden';
  seatDisabled: boolean;
  seatHint: 'default' | 'afterTrial' | 'trialCovers';
}
```

`trial` is derived once from the offer, in the hook:

| offer | trial |
|---|---|
| `null` | `none` |
| `canStart` | `available` |
| `pilot.status === 'pending'` | `pending` (invited or not) |
| `pilot.status === 'active'` | `active` |
| `pilot.status` in `ended`, `expired`, `base_paused`, `paid` without a live arrangement | `ended` |

Rules (total; every combination defined):

1. **`trial !== 'none'` → `tone: 'trial'`.** `blocker` is `null` in every trial state: the paid-pool
   requirement is never an error while a trial story is on screen. `notice` is the trial state.
2. **Seat shape.** `seatDisabled` = the paid path cannot be walked from here
   (`blocker !== null && !(blocker === 'CAPACITY_UNAVAILABLE' && purchaseOpen)`), unchanged in
   substance — but when `tone: 'trial'` the disabled Seat option carries `seatHint` copy instead of a red
   alert: `afterTrial` ("Add co-managed seats to keep the technician after the 15-day trial.") or
   `trialCovers` ("The trial seat covers this technician until 12 Dec. Buy a seat to keep them."). No
   destructive styling. If `purchaseOpen`, Seat stays enabled exactly as today.
3. **Pool line.** `pool: 'count'` when `capacity.purchased > 0`; `'empty'` ("No co-managed seats yet.")
   when `0` and no trial story; `'hidden'` when a trial story is on screen (a 0-of-0 pool is not
   information about the trial). The chooser renders the three variants; no raw counts under a trial.
4. **`trial === 'none'`** → today's behaviour byte-for-byte: `tone: 'blocked'`, blocker downgrade for
   `CAPACITY_UNAVAILABLE + purchaseOpen`, pool counts, Seat enabled/disabled as now.

The trial card's own content is untouched (title, pickers, invite button, status lines) — it is already the
one story for the trial path; the chooser now tells the same one.

## 4. Ordering on the tab (no empty read)

`CoManagedClientIntegration` reads the offer next to `seatState`; the chooser only renders once
`seat.enable` exists, which is after the seat read — both are already in-flight together, so the first
render has both and no "red alert, then downgrade" flash. The resolver is called with the offer's current
value; while the offer is still loading it is `null` → `trial: 'none'` → today's rendering for that frame,
which is the safe direction (no trial story promised before it is known). To avoid the reverse flash when
a trial *does* exist, the integration does not render the chooser until both reads have settled
(`seatLoading || trialLoading`), the same rule it already applies to `seatState`.

## 5. Files

1. `server/src/components/co-managed/useSeatTrialOffer.ts` (new) — offer read + `trial` derivation.
2. `server/src/lib/co-managed/seatEnableStory.ts` (new) — the rule above.
3. `ee/server/src/components/co-managed/CoManagedSeatTrial.tsx` — presentational props; no fetch.
4. `server/src/components/co-managed/CoManagedSeatTrialSection.tsx` (new) — hook + trial card for the
   overview page.
5. `server/src/app/msp/co-managed/page.tsx` — use the section in both places (`:47`, `:56`).
6. `server/src/components/co-managed/CoManagedClientIntegration.tsx` — one offer read, pass to trial and
   chooser; hold the chooser until both settle.
7. `server/src/components/co-managed/CoManagedShapeChooser.tsx` — take the resolved story; render notice /
   pool variant / hint; keep the `CAPACITY_UNAVAILABLE + purchaseOpen` path.
8. Locale keys, all languages: `coManaged.seat.trial.available` ("A free 15-day trial is available above.
   Co-managed seats can be added at any time."), `.pending`, `.active`, `.ended` ("The 15-day trial has
   ended. Add co-managed seats to keep the technician."), `coManaged.seat.chooser.poolEmpty`
   ("No co-managed seats yet."), `coManaged.seat.chooser.seatHint.afterTrial`,
   `coManaged.seat.chooser.seatHint.trialCovers` (with a date parameter).

## 6. Tests

- `seatEnableStory.test.ts` (new, pure): the full matrix — `trial` × `{none, available, pending, active,
  ended}` × `purchaseOpen` × `capacity.purchased` ∈ {0, n} — asserting `tone`, `blocker`, `notice`, `pool`,
  `seatDisabled`, `seatHint`; and that `trial: 'none'` reproduces today's outputs for every pool case.
- `CoManagedShapeChooser` component test: with `tone: 'trial'` no destructive alert is rendered, the
  notice is, and the Seat option is disabled with the hint; with `tone: 'blocked'` the alert is rendered.
- `CoManagedClientIntegration` test: the offer is read once and the chooser receives the derived story;
  the trial card and chooser agree in the pending and available cases.
- `CoManagedSeatTrial` tests updated for the prop contract; the overview page test still renders the trial.

## 7. Coordination and explicitly not doing

- **Coordinates with card `24e96db5`** (same panel family, other branch): that design rewrites the trial
  card's `run()` error handling and adds a typed refusal. Both touch
  `CoManagedSeatTrial.tsx`; whichever lands second rebases. This design keeps that file's mutation bodies
  intact so the rebase is mechanical: §2 only replaces `load()`/`refresh()` with props.
- **Not** changing `getSeatTrialOfferAction`'s eligibility rule (24e96db5's item 4) — this card consumes
  `intake`/`canStart` as they are.
- **Not** changing the workspace provisioning flow. The status heading is no longer out of scope: §10
  changes it while the trial is `available` (and only then); every other state keeps "Co-managed IT not
  enabled".
- **Not** hiding the chooser: the workspace shape and the paid path must stay reachable; the fix is that
  the chooser stops contradicting the trial, not that it disappears.
- **Not** adding a feature flag; the resolver is total, so there is no configuration axis.

## 8. Acceptance criteria

1. Trial available, pending, or active: the tab shows one story — no red "no co-managed pool" alert, no
   "0 of 0 seats available" line; a neutral note explains what happens after the trial.
2. Trial ended without a paid pool: neutral trial-ended note, no destructive alert; Seat disabled with the
   "add seats to keep the technician" hint (or enabled when `purchaseOpen`).
3. Paid pool present: unchanged — counts, capacity and the existing blocker behaviour.
4. No trial surface at all: unchanged from today.
5. The trial card's offer, invite and status are unchanged; a manager without `purchaseOpen` cannot start
   the paid path from the Seat option.
6. Screenshot state (client Will It Work LLC, no entitlement, live trial sponsor) reproduced on the card's
   dev server: single story, invite works.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Trial card read moves to the parent and a caller is missed | three call sites only (`page.tsx` ×2, the integration); the section wrapper keeps the page's API |
| Chooser flashes before the offer resolves | chooser withheld until both reads settle (§4) |
| Seat option silently loses its paid path | `seatDisabled` derives from the same expressions as today; the no-trial branch is asserted byte-identical in the resolver test |
| Copy across 10 locales | keys added with `defaultValue`, as the rest of the module already does; a missing translation falls back to English |
| Rebase conflict with 24e96db5 | §7: mutation bodies untouched, only the load contract changes |

## 10. Follow-up: starting the trial IS enabling co-managed IT

`prepareCoManagedSeatTrial` (`ee/server/src/lib/co-managed/seatTrial.ts`) creates the same 1-seat Seat
arrangement, board scope and invitation as `enableCoManagedSeatArrangementAction`; the only difference is who
pays. Showing a trial card, a flat "not enabled" heading and a separate pool-funded Seat route is two setup
flows for one act. While the trial is startable and there is no paid pool, the tab tells one story.

**Rule** (extends `resolveSeatEnableStory`; same totality, no ad-hoc booleans at call sites):

| trial | paid pool (`capacity.purchased`) | `heading` | `seatLeadsTo` | `seatHint` | seat disabled |
|---|---|---|---|---|---|
| `available` | `0` / unknown | `trialEnables` | `trial` | `trial` | no |
| `available` | `> 0` | `notEnabled` | `setup` | as §3 | as §3 |
| `pending`, `active`, `ended` | any | `notEnabled` | `setup` | as §3 | as §3 |
| `none` | any | `notEnabled` | `setup` | `default` | as today |

New resolver outputs: `heading: 'notEnabled' | 'trialEnables'`, `seatLeadsTo: 'setup' | 'trial'`, and
`seatHint: 'trial'`. `tone`, `blocker` (null), `notice` (`available`) and `pool` (`hidden` with no pool) are as in §3.

**Heading.** Only the paths that render on the client's Co-managed IT tab take the variant:
`CoManagedSeatClientView` (seat-only tab) and `CoManagedClientView` (tab with the workspace side), both through
a `notEnabledHeading` prop that the integration fills from the resolver. `trialEnables` renders
`coManaged.client.notEnabledTrialEnables`. `CoManagedClientSummary` and `CoManagedSeatSummary` sit on the
client's summary, beside an "Enable co-managed IT" link to the tab; they keep `notEnabled`.

**Seat option is the trial.** With `seatLeadsTo: 'trial'` the chooser opens with Seat selected and renders the
existing `CoManagedSeatTrial` card (passed in as `seatTrial`) where the pool-funded `CoManagedSeatSetup` would
be. The card is then not rendered above the chooser, so it appears once. It stays above the chooser whenever
the chooser is not shown (a live relationship or arrangement) or the story is not `available`. Workspace stays
the other shape. The set-up predicate is shared (`workspaceSetupOpen` in `clientRelationshipSummary.ts`).

**Copy.** `coManaged.client.notEnabledTrialEnables` (heading), `coManaged.seat.chooser.seatHintTrial` (Seat
option) and the reworded `coManaged.seat.trial.available` (note: inviting the technician enables co-managed IT;
buy a seat after the 15 days to keep them), in all locales.

**Tests.** `seatEnableStory.test.ts` (heading for available, pending, active, ended, paid pool, no offer);
`CoManagedShapeChooser.test.tsx` (Seat opens the trial, no setup route, Workspace kept);
`CoManagedClientIntegration.test.tsx` (heading prop and card placement per state).
