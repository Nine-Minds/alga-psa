# Remove the co-managed status and enable link from the client header

Status: design for review · card `f79612d6-8c44-447a-9b23-d3d96ce4e26d` · PSA alga-2026-0003411
Captain's order: the client details header must not carry a co-managed status line or entry point in **any**
state; the Co-managed IT tab is the one place to see and change that state.

## 1. Problem

Next to Print / Merge / Delete on the client record header there is a co-managed line that reads
"Co-managed IT not enabled" followed by an "Enable co-managed IT" link (production screenshot, tenant
6ce57d7b, client Will It Work LLC). The same line also renders for other states: seat usage
("Seat arrangement: X of Y seats used · View details"), multiple relationships ("Multiple co-managed
relationships · Choose relationship"), an ended relationship ("This relationship has ended… · View history")
and an inconsistent record ("Co-managed record needs attention"). All of it is a second, header-level entry
point to a feature that already owns a tab.

## 2. Where it comes from (verified at `52e5e42462`)

| Piece | Location |
|---|---|
| Header renders the slot | `packages/clients/src/components/clients/ClientDetails.tsx:1885` — `{coManagedSlots?.summary}` inside the Print/Merge/Delete cluster |
| Slot contract | `packages/clients/src/context/ClientCrossFeatureContext.tsx:153-157` — `ClientCoManagedSlots.summary: ReactNode` |
| Producers | `server/src/components/co-managed/CoManagedClientIntegration.tsx:162` and `:174-175` — `CoManagedSeatSummary` / `CoManagedClientSummary` |
| The two summary components | `server/src/components/co-managed/CoManagedSeatSummary.tsx`, `CoManagedClientSummary.tsx` |
| Other consumer of the slot | `packages/clients/src/components/clients/ClientQuickView.tsx:1009-1017` — quick view renders `slots?.summary ?? null` and nothing else from the integration |
| Derivation of setup-open | `packages/co-managed/src/managementPolicy.ts:455` — LEVERAGE marker naming `CoManagedClientSummary` as one of three sites |

`CoManagedClientSummary` and `CoManagedSeatSummary` have no consumer other than the slot
(`grep` for both names: only the integration, their own tests, and the two integration tests' mocks).

## 3. Decision — remove the slot, not just the line

The header line is a *surface*, and the surface is expressed as a feature slot that exists for that one
line. The fix is therefore to delete the slot itself rather than to render `null` inside each producer:
with the slot gone, no future producer can put a co-managed status back into the header by supplying one,
and the quick-view path that existed only to show the summary disappears with it. That is one mechanism
removed instead of five states made to lie.

Changes, in order:

1. **Contract** — `packages/clients/src/context/ClientCrossFeatureContext.tsx`: remove `summary` from
   `ClientCoManagedSlots` (keep `tab: TabContent`), and update the interface doc ("a null slots value means
   no feature UI"). This is the compile-time proof that every producer was found.
2. **Header** — `ClientDetails.tsx`: drop `{coManagedSlots?.summary}` from the header cluster and fix the
   `renderClientCoManagedIntegration` comment above `renderClientBody` to say the integration supplies the
   tab only.
3. **Quick view** — `ClientQuickView.tsx`: remove the whole `renderClientCoManagedIntegration?.({...})`
   call from its header (there is no tab registry in quick view, so after §2 it would render nothing) and
   drop the now-unused `renderClientCoManagedIntegration` destructure. If the composition provider still
   passes the prop, keep the prop itself — it is used by `ClientDetails` through the same context; only the
   quick view's use of it goes.
4. **Producer** — `CoManagedClientIntegration.tsx`: both slot objects keep `tab` and lose `summary`; delete
   the two summary imports. The tab, chooser, trial, seat view and refresh logic are untouched.
5. **Delete now-dead components** — `CoManagedClientSummary.tsx`, `CoManagedSeatSummary.tsx`, and
   `server/src/test/unit/co-managed/CoManagedClientSummary.test.tsx`. Update the two integration tests that
   mock them (`CoManagedClientIntegration.test.tsx`, `seatCapabilityOff.render.test.tsx`) to stop mocking
   them and to assert the reported slots are `{ tab }` only.
6. **LEVERAGE marker** — `managementPolicy.ts:455`: the derivation is now in two places
   (`CoManagedClientView` and this policy), so reword the marker to name those two and drop the deleted
   component. Leave the `// LEVERAGE: pattern co-managed-setup-open` marker itself in place.
7. **Locale keys** — prune the keys whose only reader was a deleted component, in every
   `server/public/locales/<lang>/msp/licensing.json`:
   `coManaged.client.chooseRelationship`, `coManaged.client.endedHint`, `coManaged.client.viewHistory`,
   `coManaged.seat.client.summary`. Keys that still have a live reader stay:
   `coManaged.client.notEnabled` (tab views), `coManaged.client.inconsistent` (tab view),
   `coManaged.client.selectionRequired` (tab view), `coManaged.client.viewDetails` (overview rows).

`resolveClientRelationshipSummary` stays: `CoManagedClientView` still calls it for selection and
inconsistency state inside the tab.

## 4. Explicitly not doing

- No change to the Co-managed IT tab, its chooser, trial, seat panel or provisioning flows.
- No change to capability admission (`useCapability('co-managed' | 'co-managed-seat')`) or to the reads
  that feed the tab.
- Not touching the related panels on `23c57327` / `24e96db5`.
- Not hiding the header line by CSS or by a feature flag; the surface is deleted.

## 5. Tests

- `ClientDetails` contract test (new, source-assertion style like the existing
  `ClientDetails.*.wiring.test.ts`): the header cluster contains no `coManagedSlots?.summary`; the file
  imports no summary component.
- `ClientCrossFeatureContext` type change is enforced by `tsc` across `packages/*` and `server`.
- `CoManagedClientIntegration.test.tsx`: for both the seat-only path and the workspace path, the `children`
  callback receives slots with a `tab` and no `summary`.
- Delete `CoManagedClientSummary.test.tsx` with its component (no remaining subject).
- Run the co-managed unit suite plus the clients package suites that touch `ClientDetails` / `ClientQuickView`.

## 6. Acceptance criteria

1. The client header (next to Print / Merge / Delete) renders nothing for co-managed in **every** state:
   not enabled, enabled, provisioning, ended, multiple, inconsistent.
2. The quick-view header likewise renders no co-managed status.
3. The Co-managed IT tab still appears and still shows/enables state exactly as today.
4. No dead exports or orphaned locale keys: `grep` for the deleted components and keys returns only locale
   files for keys still used, and nothing for the components.
5. `tsc` clean for the touched packages; the listed tests green.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Another producer relies on the slot | Removing the field from the interface makes every producer a compile error until fixed — the compiler is the checklist |
| Losing a cue that the feature exists | The tab is the discoverable surface and is unchanged; the captain's order is explicit that the header needs no entry point |
| Locale pruning misses a live key | Each key is grepped before deletion; keys with readers in the tab views are listed as kept |
| Quick-view refactor breaks its header | The change only deletes one element from the same header cluster; the existing quick-view render tests cover the surrounding actions |
