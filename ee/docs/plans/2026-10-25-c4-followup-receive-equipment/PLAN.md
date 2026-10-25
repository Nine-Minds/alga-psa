# Plan — Receive equipment polish

Mechanism is in this file; evidence was read on the card base (`fc507349ef`, C4 branch).

## F1 — The ticket Assets panel joins the existing asset cache families (no per-surface callback)

**Decision.** Convert the association list in `AssociatedAssets.tsx` to the SWR cache the rest of the asset
surface already uses, and extend `packages/assets/src/lib/assetCacheKeys.ts` with an entity-assets key
(`ticketAssetsKey(entityType, entityId)`, matched by `matchAssetCacheKeys` for the given entity id).
Nothing else changes to make the panel refresh.

**Evidence this is the general mechanism, not a new one.**

- `ReceiveEquipmentDialog.submit` already invalidates exactly this data after a successful receive:
  `mutate(matchAssetCacheKeys([outcome.data.asset.asset_id]))` and
  `mutate((key) => Array.isArray(key) && key[0] === 'custody')`
  (`packages/msp-composition/src/tickets/ReceiveEquipmentDialog.tsx`).
- The same pattern is already used by `AssetAssigneeRow.tsx:89`, `AssetForm.tsx:39`,
  `AssetBentoLayout.tsx:141` (`matchAssetCacheKeys`), and `CustodyBadge` already keys
  `['custody','badges', …]` via `useCustodyBadges`.
- `AssociatedAssets` is the odd one out: plain `useState` + `useEffect` reload on prop change, while every
  panel in `packages/assets/src/components/tabs/*` is SWR.

**Shape.**

```ts
// assetCacheKeys.ts
export const ticketAssetsKey = (entityType: string, entityId: string) =>
  ['entity-assets', entityType, entityId] as const;      // matched by matchAssetCacheKeys(entityId)
```

`AssociatedAssets` becomes `useSWR(ticketAssetsKey(entityType, entityId), fetchEntityAssets, { fallbackData })`
where `fallbackData` is the RSC `initialAssets` (normalising the Flight thenable exactly as today, so the
first paint does not flash). The loading/empty/error states keep their current copy and `id` attributes;
`loadAssociatedAssets` and the "skip first fetch" ref disappear.

Custody actions from the ticket's side drawer already run through `CustodyDialogs`; whatever they mutate
must include the entity-assets key for the ticket they were opened from. Audit `custodyClient.ts`/the dialog
`finish()` path and add the entity id to the invalidation call there — one call site, not a callback per
panel.

**If a one-off callback is ever added instead, it gets `// LEVERAGE: pattern ticket-panel-refresh — …`.** The
plan's mechanism needs none.

## F2 — One status label source

**Decision.** New module `packages/assets/src/lib/assetStatus.ts`:

- `ASSET_STATUSES` — the canonical list (from the asset status enum/DB check constraint; the design's test
  asserts the list matches the DB-enforced set).
- `assetStatusKey(status)` → `assetStatuses.<status>` in the shared `msp/assets` namespace.
- `useAssetStatusLabel()` (hook) and `assetStatusLabel(t, status)` (non-hook) — one fallback: the humanised
  slug, and only for a status the canonical list does not know.

Replace the three local implementations (`AssociatedAssets.tsx:95`, `AssetDashboardClient.tsx:993`,
`AssetDetails.tsx:75`) and the remaining surfaces named in the card (asset list, asset detail Identity,
client assets, quick-add) with it. Add `assetStatuses.*` to **every** locale under
`server/public/locales/*/msp/assets.json` including pseudo-locales, with
`held_by_msp: "Held by MSP"`. `associatedAssets.assetStatuses.*` keys are retired.

**Guard.** A test enumerates `ASSET_STATUSES` × locales and fails on any missing key, so a status added
later cannot silently print as a slug. (This is the fix for the class, not for one slug.)

## F3 — Row layout: the name owns the space

**Decision.** In the panel row the name/identity group becomes `min-w-0 flex-1` with `truncate` and
`title` carrying the full name; `CustodyBadge` becomes `shrink-0` and, when the row is narrower than `sm`,
wraps beneath the name (`flex-wrap` + `basis-full` on the badge wrapper). The chip keeps `BentoChip` and its
existing 200 px truncation and gains a `title` with the full custody label so truncation is never lossy.

Standard components only: no new chip, no new row component.

## F4 — Existing-asset picker shows held assets as disabled, with their location

**Decision.** Reuse the batched open-custody read that the badge already uses:
`getOpenCustodyBadges(assetIds)` via `useCustodyBadges` over the loaded page of `listAssets` results
(≤100 ids). Options for held assets are `disabled` with
`"<name> (<tag>) — In custody: Main Warehouse / Shelf C1"`; free assets stay selectable. The server refusal
stays as defence in depth and now also surfaces at the top (F5).

`CustomSelect` is extended with per-option `disabled` and a secondary/description line if it lacks them —
extend the standard component, do not fork it for this dialog.

**Failure mode to state in the UI:** `getOpenCustodyBadges` is silent on refusal (empty map). If the badge
read fails, do **not** claim everything is available: leave options enabled and let the server refuse (F5
makes that refusal visible). No spinner blocks the picker.

## F5 — Dialog errors at the top, anchored to the field

**Decision, at `DialogShell`** (one fix for every custody dialog: receive, open, return, hand over):

- The alert moves out of the bottom of `DialogContent` into a top region that is always in view (sticky
  within the scroll container), `role="alert"`, focused on appear so a screen reader announces it.
- `onSubmit` may resolve `string | { message: string; fieldId?: string }`. With `fieldId`, the shell focuses
  that control and sets `aria-invalid` (clearing both when the value changes). `string` keeps the current
  contract, so existing callers are untouched.
- The receive dialog returns `fieldId` for the existing-asset refusal (`${id}-asset`) and for location
  (`${id}-location`).

Follows the dialog error conventions in `docs/AI_coding_standards.md`.

## Ordering

F2 and F3 are independent. F1 first (it is the refresh proof), then F4 and F5 (both touch the dialog, and F4's
refusal path is only verifiable once F5 lands). Commit as separate changes so a smoke finding can be
attributed.

## Test matrix

| Area | Test |
| --- | --- |
| Refresh | RTL: panel populated from SWR; after `mutate(matchAssetCacheKeys([newAssetId]))` + `mutate(key => key[0]==='custody')` the new asset and its chip appear without a remount. |
| Refresh (real) | Integration or e2e: open a ticket, Receive equipment (new item), assert the Assets panel row appears and links to the asset — no `page.reload()`. |
| Status labels | Unit: every `ASSET_STATUSES` entry resolves in every locale; `held_by_msp` renders "Held by MSP" in the panel and the asset list. |
| Status labels (shared) | Unit: `assetStatusLabel` is the only implementation — grep assertion that no surface re-declares a local `getAssetStatusLabel`. |
| Row layout | RTL: name node has `min-w-0`/`truncate` and a full-name `title`; badge sits in a wrapping row. |
| Picker | RTL: held asset option disabled and labelled with its location; free asset selectable. |
| Errors | RTL: a server refusal renders at the top with `role="alert"`, is focused, and the offending select gets `aria-invalid`. |
| Regression | Existing custody dialog tests still pass (string-returning `onSubmit` unchanged). |

## Risks

- **SWR conversion of the panel** changes loading semantics; keep `fallbackData` from `initialAssets` and the
  current empty/error copy so nothing flashes or regresses.
- **Cache-key blast radius.** `matchAssetCacheKeys` must invalidate the entity-assets key only for the entity
  that changed, never every open ticket panel.
- **Badge refusal is silent** — covered above (leave enabled, server is the gate, F5 makes it visible).
- **Pseudo-locales** grow every locale file; the coverage test is what keeps them honest.
- **Stacking.** The base moves under C4 (`266cc9e0`); re-verify each finding's file:line before editing.
