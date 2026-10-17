# Bulk mapping grid: keep already-mapped targets out of name suggestions

- Card: f7e83d99-5e11-4551-b852-128f74d23d9f
- PSA ticket: alga-2026-0002690
- Branch: `feature/bulk-mapping-grid-exclude-already-mapped-targets`
- Follows: PR #3634 (Xero bulk item mapping grid). That PR merged to `main` on 2026-10-08, so this branch starts from `main` and has no stacked parent branch.

## The defect

`AccountingMappingBulkGrid` passes the whole external catalog to the name matcher:

```
packages/integrations/src/components/accounting-mappings/AccountingMappingBulkGrid.tsx:91-98
  suggestMappingTargets(unmappedAlga, externalEntities, { preferredKind })
```

Only the Alga side is narrowed to unmapped rows. On the external side, nothing removes targets that an existing mapping already holds. Suppose two Alga services share a name, such as James's twin "Power BI Pro" rows, and one of them is mapped to `item:PBI`. Only the unmapped twin reaches the matcher, so the matcher's same-batch duplicate guard (`suggestMappingTargets.ts:129-140`) never fires. The twin gets `item:PBI` as an exact name suggestion and is pre-ticked (`AccountingMappingBulkGrid.tsx:126`). On Save, that row fails with `This target is already mapped to another entity in this organisation.`

### Which targets are unavailable

> **Superseded by migration `20261013120000`:** the index is now partial. Xero account targets are shareable, items stay one-to-one, and `item:200`/`account:200` do not collide. The grid uses `isExclusiveKind` (replacing `externalIdForOption`) and withholds only exclusively-held option ids; the text below is the original premise.

The server enforces this unique index:

```
idx_unique_external_mapping ON tenant_external_entity_mappings
  (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
```

Source: `server/migrations/20260611130000_add_entity_type_to_external_mapping_unique_index.cjs:17-20`. The create action turns a violation into the per-row `duplicateTarget` error (`packages/integrations/src/actions/externalMappingActions.ts:1105-1112`).

A grid instance covers one module, which means one `alga_entity_type`. Its `mappings` prop holds the mappings for the current realm or connection (`getExternalEntityMappings` refuses unscoped lookups). So inside one grid, a target is unavailable when any loaded mapping holds the same persisted `external_entity_id`. The index has no exception for kind or for anything else, so no target rule allows a second mapping of the same target.

Because of how Xero stores mappings, kind does not help. Xero option ids carry a kind prefix (`item:200`, `account:200`), but the mapping stores the bare code `200` and records the kind in `metadata.xeroTargetKind` (`packages/integrations/src/components/xero/xeroLiveMappingModules.ts:42-70`). If one service maps to `item:200`, the index also blocks `account:200`. To match what the server does, the grid has to compare persisted ids, not option ids.

## Design decisions

1. **The matcher owns exclusion, not the call site.** The quick fix would be to filter `externalEntities` before calling the matcher. That gets the wrong answer for the motivating case. Once `item:PBI` is filtered out, the twin "Power BI Pro" has no exact match, falls through to the fuzzy pass, and can pick up a "Possible match" badge for a different item such as "Power BI Pro Annual" (Jaccard 3/4 = 0.75, which meets `FUZZY_MATCH_THRESHOLD`). The twin's real match exists and is taken, and that tells us the row is a duplicate. It does not tell us to go looking for the next-best target. So `suggestMappingTargets` gets a new option, `unavailableExternalIds`, and handles it inside its tiers. The matcher stays pure and provider-agnostic.

2. **Matcher rules for unavailable targets.** Option ids that `isUnavailable(option)` flags:
   - They still take part in exact matching (code tier, then name tier), with the same preferred-kind narrowing as today: preferred kind first, other kinds only if the preferred kind has no candidates.
   - After that narrowing, unavailable candidates are removed:
     - **No candidates left, but some existed:** the row is *blocked*. It gets no suggestion from any tier, including fuzzy. This covers the twin case.
     - **Exactly one candidate left:** it is suggested as an exact match (`code` or `name`) and is pre-ticked as usual. This handles twin Xero items: if the catalog also has two "Power BI Pro" items and one is taken, the free one is the right suggestion for the free twin.
     - **More than one left:** the match is ambiguous. Today's behaviour stays: no exact suggestion, and the row is still eligible for fuzzy.
   - Unavailable targets never enter the fuzzy pool.
   - Blocked rows do not claim anything in `claimedByExact`, because no suggestion was issued. The existing same-batch duplicate guard is otherwise unchanged.

   Preferred-kind narrowing happens *before* availability on purpose. If an Alga service's exact name matches a taken item and also a free account, the item was the true match. Falling back silently to the account would be a cross-catalog guess, and the matcher's header comment forbids that.

3. **The grid asks the module for the persisted key.** `AccountingMappingTargetConfig` gets a required `externalIdForOption(optionId: string): string`. It is the inverse of `optionIdForMapping`'s id part and returns the `external_entity_id` that would be stored. Both Xero modules implement it as `parseOptionId(optionId).code` (service module `xeroLiveMappingModules.ts:202-219`, discount module `:337-349`). Modules without `externalTarget` (QBO) use option id = `external_entity_id`, which is the same assumption `enrichMappings` makes at `AccountingMappingModuleView.tsx:436-440`. The grid therefore uses identity for them. The field is required, not optional, so that a future multi-catalog module cannot quietly fall back to comparing option ids.

4. **Manual picking is unchanged.** The `SearchableSelect` option list (`AccountingMappingBulkGrid.tsx:298-300`) is still built from the full catalog, filtered by kind only. A user who picks a taken target on purpose still gets the server's per-row `duplicateTarget` error. That is correct: the database is the only place the rule is enforced. Hiding or annotating taken targets in the picker is a separate UX decision and is listed under follow-ups.

5. **Suggestions refresh after a save.** The grid memoises suggestions on `mappings` (via `unmappedAlga`) and on the new unavailable set. After the silent reload that follows Save (`AccountingMappingModuleView.tsx:216`), targets that were just saved are excluded straight away. Untouched rows that pointed at them lose their suggestion and pre-tick. Rows the user has edited are left alone, because `edit.externalId` takes precedence (`AccountingMappingBulkGrid.tsx:116-120`).

## Changes, in order

1. **`packages/integrations/src/components/accounting-mappings/types.ts:110-126`**
   - Add `externalIdForOption: (optionId: string) => string;` to `AccountingMappingTargetConfig`. Its doc comment should say: this is the persisted `external_entity_id` for a catalog option, which is the key the external-target unique index enforces.

2. **`packages/integrations/src/components/xero/xeroLiveMappingModules.ts`**
   - In both `externalTarget` blocks (`:202` service, `:337` discount), add `externalIdForOption: (optionId) => parseOptionId(optionId).code`.
   - `parseOptionId` throws on an unprefixed id. Catalog options are always prefixed, so a throw here would mean a loader bug and should surface. No catch.

3. **`packages/integrations/src/components/accounting-mappings/suggestMappingTargets.ts`**
   - `SuggestOptions`: add `unavailableExternalIds?: ReadonlySet<string>`, documented as option ids that existing mappings hold and that must never be suggested.
   - Change `pickExact` to return a three-way result: `{ hit } | 'blocked' | null`. It applies preferred-kind narrowing to the full match list first, then removes unavailable candidates, as described in decision 2.
   - Pass 1 (`:92-127`):
     - On a blocked code tier, mark the row blocked and `continue`. Do not try the name tier, because a code match is identity.
     - On a blocked name tier, mark the row blocked.
     - Keep the blocked ids in a local `Set`.
   - Pass 2 (`:142-173`):
     - Skip blocked rows.
     - Build `fuzzyPool` without unavailable ids, in addition to the existing kind and `claimed` filters.
   - Update the header comment (`:3-14`) to describe the unavailable-target rule.

4. **`packages/integrations/src/components/accounting-mappings/AccountingMappingBulkGrid.tsx`**
   - `MappedRow` (`:22`): add `external_entity_id: string`. `DisplayMapping` already has it, so `AccountingMappingModuleView.tsx:378` needs no change.
   - Add a `useMemo` that builds `unavailableExternalIds`:
     1. Collect the held persisted ids: `new Set(mappings.map(m => m.external_entity_id))`.
     2. Return the set of `externalEntities` option ids where `(targetConfig?.externalIdForOption ?? identity)(option.id)` is in that set.
   - Pass the set to `suggestMappingTargets` (`:92-98`) and add it to the memo deps.
   - Replace the comment at `:91` with one that says suggestions cover unmapped rows and exclude held targets.

5. **Test fixture updates for the new required config field.** Add `externalIdForOption: (id) => id.slice(id.indexOf(':') + 1)` wherever a test builds an `externalTarget`:
   - `AccountingMappingModuleView.bulk.test.tsx:15-27`
   - `AccountingMappingDialog.targetKind.test.tsx`
   - `AccountingMappingDialog.search.test.tsx`
   - `AccountingMappingDialog.alreadyMapped.test.tsx`
   - `AccountingMappingModuleView.test.tsx`

   `npm run typecheck` (or `tsc -p packages/integrations`) finds every site.

6. **Tests (see next section).**

Each step compiles on its own, so steps 1–4 can land as one commit and tests as a second, or all together.

## Tests

Tests stay colocated with the existing suites in this package, following the convention `packages/integrations` already uses. They are vitest unit tests with no database.

### `suggestMappingTargets.test.ts`, matcher

1. **Twin-named service, one already mapped.** Input: `[svc('b','Power BI Pro')]`, catalog `[item('PBI','Power BI Pro'), item('PBIA','Power BI Pro Annual')]`, `unavailableExternalIds = {'item:PBI'}`. Expected: `result.has('b') === false`. This also proves there is no fuzzy fallback to `PBIA`.
2. **Code tier blocked.** Input: an SKU equal to a taken item code. Expected: no suggestion, even when the name tier would match another free item.
3. **Twin catalog items, one free.** Input: two items named "Power BI Pro", one unavailable. Expected: the free one is suggested with `matchedBy: 'name'`.
4. **Preferred kind taken, account free with the same name.** Expected: blocked. Never falls back to the account.
5. **Unavailable targets are never fuzzy-suggested.** Input: a row whose only fuzzy candidate is unavailable. Expected: no suggestion.
6. **Regression check.** With `unavailableExternalIds` omitted, every existing case passes unchanged.

### `AccountingMappingModuleView.bulk.test.tsx`, grid

7. **Twin-named services, end to end.**
   - Setup: `loadResult` with the Alga services `svc-pbi-1` and `svc-pbi-2`, both "Power BI Pro". `svc-pbi-1` is mapped with `external_entity_id: 'PBI'`. The catalog contains `item('PBI','Power BI Pro')`.
   - Expected: the `svc-pbi-2` row has no `…-suggested-svc-pbi-2` badge, its target picker is empty, its Save checkbox is unticked, and the count shows only the other pre-ticked rows.
   - Expected: `item:PBI` is still in that row's picker options, so it remains selectable by hand.
8. **Cross-kind persisted key.**
   - Setup: an existing mapping holds `external_entity_id: '200'` as an item. An unmapped service named "Sales" has an exact-name match on `account:200`.
   - Expected: no suggestion. This proves the grid compares persisted ids through `externalIdForOption`, not option ids.
9. **Refresh after save.**
   - Setup: twins with no existing mapping. Neither is suggested, which is the existing guard. The user manually picks `item:PBI` for twin 1 and clicks Save all.
   - Expected after the reload: twin 2 still shows no suggestion. Optionally assert that a third untouched row exact-matching a now-held target loses its pre-tick.

### Verification commands

```
npx vitest run packages/integrations/src/components/accounting-mappings
npm run typecheck   # or the package-scoped tsc
```

### Manual check on the dev server

URL: `http://feature-bulk-mapping-grid-exclude-already-mapped-targets.localhost:3711`

1. Open Xero → Items → Bulk map with twin services, one of them mapped.
2. Confirm that the twin has no suggestion and nothing is pre-ticked.
3. Pick the taken item by hand, click Save, and confirm the per-row duplicate error is shown.

## Out of scope

- **Hiding or annotating taken targets in the picker.** Neither the bulk grid nor `AccountingMappingDialog` filters held targets out of the external picker. A "(mapped to X)" hint or a disabled state would be better UX than a save-time error, but it is a separate decision. Possible follow-up card.
- **Intra-session collisions from manual picks.** Two unmapped rows where the user picked the same target by hand both stay ticked, and the second one fails on save. The existing same-batch guard only covers *suggestions*.
- **The cross-kind index shape.** `item:200` and `account:200` cannot both be mapped by services in the same realm, because the index ignores `metadata.xeroTargetKind`. This plan mirrors that rule and does not change it. Whether the index should include the kind is a schema question for a separate card.
- **Tombstoned mappings.** Unlinked rows keep `deleted_at` set and still occupy the non-partial unique index. Module loads exclude tombstones (`externalMappingActions.ts:778`), so a target held only by a tombstone can still be suggested and fail on save. The create path only relinks a tombstone for the *same* Alga entity. This was not seen in the motivating case. See the risks below.
- QBO modules: no behaviour change beyond receiving the same exclusion through identity ids.

## Risks

- **Tombstone gap (above), confirmed.** `getExternalEntityMappings` filters `whereNull('deleted_at')` (`externalMappingActions.ts:778`), so the gap is real. It is also narrow: a target unlinked from service A can still be suggested for service B, and that save fails. Closing it would need the loader to return the target ids that tombstones still hold. Record it as a follow-up. Do not widen this card.
- **Xero realm aliases.** Mappings stored under a historical connection id for the same organisation (`resolveXeroRealmAliasIds`, `externalMappingActions.ts:947-951`) are only excluded if the module's load returns them. The unique index keys on the literal realm string, so an alias-realm mapping does not block a save under the canonical realm. Leaving it suggestable therefore matches the server, and there is no new risk.
- **Required config field.** This is a compile-time break for any out-of-tree `AccountingMappingTargetConfig`. In-repo there are exactly two (Xero service and discount) plus test fixtures. It is intentional.
- **Suggestion churn after save.** Rows whose untouched suggestion pointed at a target that has just been saved will lose that suggestion and pre-tick on reload. This is the intended outcome, but it is visible. Rows the user edited are not affected.
