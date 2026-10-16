# Asset save fails with "Failed to update asset": fix plan (alga0002283)

- **Ticket:** alga0002283 (EQUIT PTY LTD, AU). The customer adds a warranty end date to a newly added test asset and the save fails with the toast "Failed to update asset".
- **Branch:** `feature/alga0002283-asset-save-fails-with-failed-to-upda`
- **Status:** design. Nothing is implemented yet. The Draft Implementation step executes this plan.

## 1. Reproduction

I loaded real rows from the local `alga-psa-local-test` database. The script used the same pg type parsers the app registers in `packages/db/src/lib/knexfile.ts:27-29`. It then put the data through the `AssetForm` load mapping and the `handleSubmit` mapping, and checked the result against `updateAssetSchema`. The script ran from an untracked scratch file. Its logic is summarised under each case so it can be re-run.

```
DB power_draw_watts: "150.00" string
DB warranty_end_date: 2026-02-10T00:00:00.000Z typeof object (Date)
Edit form shows stored warranty as: ""
Case A (stored value, field untouched, warranty-only edit):
  [{"code":"invalid_type","expected":"number","received":"string",
    "path":["network_device","power_draw_watts"]}]
Case B "0.00" (the value Quick Add stores):   Expected number, received string
Case C field cleared -> parseInt(""):          Expected number, received nan
Case D typed 7.5 -> parseInt:                  OK (value 7)  <- silent truncation
Case E workstation cpu_cores cleared:          Expected number, received nan
Case F output re-validation, workstation.os_type null:  Expected string, received null
```

AU timezone check (`TZ=Australia/Brisbane`): if you pick 31 Dec in the warranty picker, the form submits `2026-12-30`.

## 2. Root cause (this corrects the card's hypothesis)

The card blamed `parseInt` producing `NaN`. That path exists, but it was not what failed for the customer: they never touched a number field. The real chain is:

1. `network_device_assets.power_draw_watts` is `decimal(8,2)` (`server/migrations/20241112031335_implement_asset_extension_tables.cjs:36`). The app registers no pg type parser for NUMERIC (OID 1700), so node-postgres returns it as a **string** (`"0.00"`, `"150.00"`).
2. `getAsset` (`packages/assets/src/actions/assetActions.ts:647-668`) returns the **raw** `getAssetWithExtensions` row (`:656`, `:662`). It never runs `formatAssetForOutput` (`:738`), which would `Number()` the value (`:788-795`). Every other read path formats: `getAssetDetailBundle` `:711`, create `:933`, update `:1100/:1211`. `getAsset` is the only one that doesn't.
3. `AssetForm` loads `power_draw_watts: data.network_device.power_draw_watts || 0` (`AssetForm.tsx:220`). `"0.00"` is a non-empty string, so it is truthy and survives. The form then submits it unchanged.
4. Quick Add creates every network device with `power_draw_watts: 0` (`QuickAddAsset.tsx:296`), so the database stores `0.00`. As a result, **every Quick-Add network device fails on every later edit**, whichever field is changed. That matches the customer: "an asset I'm adding for testing", then a warranty edit.
5. `updateAssetSchema` → `network_device_asset_schema.power_draw_watts: z.number()` (`asset.schema.ts:47`) rejects the string. `updateAssetRecord` turns the ZodError into an `Error` whose message is JSON (`:1304`, `serializedAssetValidationError` `:206`). The `updateAsset` wrapper **re-throws** it on purpose (`isTypedAssetWriteError` branch, `:1342`), so the form can `JSON.parse` the message (`AssetForm.tsx:1083-1101`).
6. In production, Next.js replaces the message of an error thrown by a server action with a generic digest. `JSON.parse` fails and the form falls back to "Failed to update asset". In dev the message survives, so the toast reads "Please fix the highlighted fields", and the highlighted key is `network_device.power_draw_watts`, which no input renders. That is why the failure looks different locally.

Related defects found on the same path. All of them are in scope:

- **A. NaN and truncation.** All number inputs use `parseInt(e.target.value)`: `AssetForm.tsx:566, 577, 599, 651, 672, 732, 743, 907`. Clearing a field sends `NaN`, and decimals in `power_draw_watts` are truncated. The inputs render `value || ''`, so a stored `0` displays as blank.
- **B. Stored dates never show in the edit form.** The `timestamp` type parser (`knexfile.ts:28`) returns `Date`, which `getAsset` passes through. The form only accepts strings (`AssetForm.tsx:184-190`), so it shows the stored warranty and purchase dates as blank. The cause is the same as step 2, so the fix is the same.
- **C. Off-by-one for AU users.** The picker emits local midnight (`packages/ui/src/components/DateTimeField.tsx:259`). The form converts it with `date.toISOString().split('T')[0]` (`AssetForm.tsx:1362, 1382`), so in UTC+10 it stores the previous day. Redisplay uses `new Date('YYYY-MM-DD')` (UTC midnight), which shows the previous day for users west of UTC. This is the field the customer is editing.
- **D. Post-commit work can fail a committed save.** In `updateAssetRecord`, three things run **after** the transaction commits: `validateData(assetSchema, result.after)` (`:1227`), `publishWorkflowEvent` (`:1241`, `:1255`) and `emitDateDomainEventOnce` (`:1282`). If any of them throws, the action reports a failed save even though the row was written. `createAssetRecord` has the same shape (`:970-1031`). Case F shows the output re-validation rejecting a legacy null string column.

## 3. Design decisions

1. **Fix the read contract, not just the form.** `getAsset` returns `formatAssetForOutput(...)`, the same normalised `Asset` that every other read path and the declared `Asset` type (string dates, number numerics) already promise. One change fixes the root cause (step 2) and defect B for every `getAsset` consumer (`AssetForm`, `useAssetDetail`, `assetDrawerActions`).
2. **Nullable extension numerics mean null.** Every extension number column is nullable, and "empty" means "unknown", not `0`. The changes, end to end:
   - Input schemas accept `number | null`.
   - The sanitizer keeps an explicit `null`, so clearing a field actually clears it.
   - The formatter keeps `null` instead of coercing it to `0`.
   - The output schema and types become `number | null`.
   - Quick Add stops inventing `0`.
3. **Validation failures are a returned result, not a throw.** `updateAsset` returns an `AssetActionError` that also carries the full issue list, so the form can highlight fields. `updateAssetRecord` (the sessionless core used by Hudu sync and service-request destinations) keeps throwing; only the server-action boundary converts. This mirrors `createAsset`, which already returns the structured error (`:1059-1062`).
4. **Nothing after the commit can make a committed save report failure.**
   - The output schema check moves **inside** the transaction, before commit. If it ever fails, nothing is written and the reported error is honest. This fits the fail-fast standard.
   - The formatter is made truthful (null-safe) so the check does not trip on legacy rows.
   - Event publication and date-event emission remain after the commit but are best-effort: they are caught and logged with tenant, asset and event context, and never re-thrown. `emitDateDomainEventOnce` already deletes its dedupe row when publishing fails (`packages/event-bus/src/workflow/dateDomainEvents.ts:58-61`), so the daily warranty scan (`20260923130000_add_date_trigger_emissions.cjs:47`) re-emits it later. Nothing is lost.
5. **Calendar dates use local calendar parts.** The picker emits a local-midnight `Date`. The form converts it with `toCalendarDateString` from `@alga-psa/core`, which reads local Y/M/D, and builds the picker value from the `YYYY-MM-DD` parts as a local date. The wire format stays the same (`YYYY-MM-DDT00:00:00Z`), so the server and the stored convention do not change.

## 4. Changes, in order

Each step can be committed on its own. Steps 1-3 fix the customer's failure by themselves. Later steps harden the same path.

### Step 1: `getAsset` returns the normalised asset (root cause, defect B)
- `packages/assets/src/actions/assetActions.ts:656-662`: `return formatAssetForOutput(asset)`.
- Before changing it, grep the consumers of `getAsset`'s output (`useAssetDetail.ts:19,49`, `assetDrawerActions.ts:40`, and the components they feed) for `instanceof Date` or Date-method use on `purchase_date`, `warranty_end_date`, `created_at`, `updated_at` and `last_login`. The type already says `string`. Display sites call `new Date(x)`, which accepts ISO strings.

### Step 2: number inputs send valid values (defect A)
- Add one helper in `packages/assets/src/lib/` (e.g. `numberInput.ts`): `parseNumberInput(raw: string, { integer: boolean }): number | null`. It returns `null` for `''` or whitespace, `Number(raw)` otherwise, and `Math.trunc` only when the column is an integer. Non-finite input returns `null`. Use it at `AssetForm.tsx:566, 577, 599, 651, 672 (integer: false), 732, 743, 907`. This one helper replaces eight identical `parseInt` call sites.
- Render with `value ?? ''`, not `value || ''`, so a stored `0` shows as `0`.
- Load mapping `AssetForm.tsx:207-256`: number fields use `?? null` instead of `|| 0`.
- `power_draw_watts` input: add `step="0.01"`. The column is `decimal(8,2)`.

### Step 3: structured validation result from `updateAsset`
- `assetActionErrors.ts`: add `assetValidationError(issues)`. It returns `{ ...actionErrorFromValidationIssue(issues[0]), validationIssues: issues.map(({path, code, message}) => …) }` and adds an `isAssetValidationError` guard. `localizeActionError` spreads the payload (`packages/auth/src/lib/localizeActionError.ts:65-74` spreads `{ ...result, actionError }`), so the extra field survives the `withAuth` boundary.
- `assetActionErrorFrom` (`assetActionErrors.ts`, `kind === 'validation'` branch): build the result with `assetValidationError(parsed.issues)` so the issue list is kept.
- `updateAsset` wrapper `assetActions.ts:1341-1347`: remove the `isTypedAssetWriteError → throw` branch so typed validation and invalid-type errors go through `expectedAssetActionError` and are **returned**.
- `AssetForm.tsx:1072-1101`: stop calling `unwrapAssetActionResult` here. Read the result:
  - If `validationIssues` is present, set `fieldErrors` from the paths and toast the localized summary.
  - For any other `AssetActionError`, toast its (already localized) message.
  - Only an actual thrown error falls back to "Failed to update asset".
  - Delete the `JSON.parse(error.message)` branch.
- Map extension issue paths to visible inputs: render `fieldErrors['network_device.power_draw_watts']` etc. under each extension number input, so a highlighted field is never invisible.
- Bulk update (`:1530`) already handles a returned `AssetActionError`. Confirm it still reports per-asset messages.

### Step 4: null-correct schemas, sanitizer, formatter, types (decision 2)
- `asset.schema.ts:24-90`: make the nullable numeric columns `z.number().nullable()`:
  - workstation: `cpu_cores`, `ram_gb`, `storage_capacity_gb`
  - network_device: `port_count`, `power_draw_watts`
  - server: `cpu_cores`, `ram_gb`
  - printer: `max_paper_size`, `monthly_duty_cycle`

  The create, update and output schemas all derive from these.
- `sanitizeUpdatePayload` (`assetActions.ts:251-283`): `pruneNullishValues` deletes `null`, so clearing a field currently means "keep the old value". Keep explicit `null`s on those extension number keys, the same way `location_id` is already special-cased at `:278`.
- `formatAssetForOutput` (`:771-830`):
  - numerics: `x == null ? null : Number(x)`.
  - non-null string columns the output schema declares as `z.string()` (workstation `os_type`, `os_version`, `cpu_model`, `storage_type`; network `management_ip`, `firmware_version`; server and mobile `os_*` and `model`; printer `model`): `?? ''`. This makes the output check true for legacy and RMM-created rows (Case F).
- `packages/types/src/interfaces/asset.interfaces.ts:104-107, 138-141, 152-153, 254-256` and the mirror in `server/src/interfaces/asset.interfaces.tsx`: `number | null`. Fix the resulting type errors in the display consumers (`AssetDetails.tsx`, `AssetDetailDrawerClient.tsx`, `client-portal/.../AssetDetails.tsx`, `HardwareSpecsPanel.tsx`, `AssetBentoLayout.tsx`, `AssetDashboardClient.tsx`) by rendering "not provided" for `null`. RMM mappers (`tacticalrmm/deviceSync.ts`, `ninjaone`/`levelio` `deviceMapper.ts`) only write, so check that they still compile.
- `QuickAddAsset.tsx:280-297`: omit the numeric extension fields instead of sending `0`.

### Step 5: post-commit work cannot fail a committed save (defect D)
- `updateAssetRecord`: move `validateData(assetSchema, afterFormatted)` from `:1227` into the transaction, just after `:1211`, and return the parsed value from the transaction.
- Add `runAssetPostCommitEffects(label, ctx, fn)` in `assetActions.ts`. It wraps `fn` in try/catch and `console.error`s with tenant, asset_id and event type; it never re-throws. Wrap `:1239-1296` (ASSET_UPDATED, ASSET_ASSIGNED, ASSET_WARRANTY_EXPIRING) in it.
- `createAssetRecord` `:969-1031`: same treatment. The output check moves into `createAssetInTransaction` before its `return` (`:933`), and the event block uses the helper. Today a Quick Add with a near-term warranty date can report "failed to create" for an asset that was created.
- Leave `createAssetInTransaction` callers that publish their own events (`createAssetInTransaction` doc, `:937-943`) alone.

### Step 6: calendar-date correctness in the form (defect C)
- `AssetForm.tsx:1358-1363, 1378-1383`:
  - picker `value`: build a local `Date` from `YYYY-MM-DD` parts. A small `calendarDateToLocalDate` helper next to `parseNumberInput` works, or use an existing `@alga-psa/core` helper if one fits.
  - `onChange`: `toCalendarDateString(date) ?? ''`.
- Submit (`:963-968`) is unchanged: it still sends `YYYY-MM-DDT00:00:00Z`.

## 5. Tests (regression first)

Write the action-level tests before steps 1-3. They must fail on `main` and pass after.

1. **Action unit tests.** Extend the in-memory harness in `packages/assets/src/actions/assetActions.customTypes.test.ts`, or start a sibling `assetActions.updateNumericFields.test.ts` with the same harness.
   - Network device whose stored row has `power_draw_watts: '0.00'` (string, as pg returns it): `getAsset` returns `power_draw_watts === 0` (number) and `warranty_end_date` as an ISO string.
   - Warranty-only `updateAsset` that sends the full extension as the form does, with blank numbers sent as `null`: the call resolves, the row has the new warranty, and the numeric columns are `null`.
   - The same for a workstation with blank `cpu_cores`, `ram_gb` and `storage_capacity_gb`.
   - `updateAsset` with `power_draw_watts: 'abc'` **returns** (does not throw) an `AssetActionError` whose `validationIssues[0].path` is `['network_device','power_draw_watts']`.
   - A decimal `power_draw_watts: 12.5` round-trips as `12.5`.
   - Clearing a previously stored value (sending `null`) persists `NULL`.
   - Post-commit: mock `publishWorkflowEvent` and `emitDateDomainEventOnce` to reject. `updateAsset` (warranty within 30 days) still resolves with the updated asset and logs the failure. The same for `createAsset`.
   - Output schema failure inside the transaction rolls back: no row change, error returned.
2. **Real-DB integration test** in `server/src/test/integration/` (pattern: `assetServiceRepair.integration.test.ts`, `createTestDbConnection`). The in-memory harness cannot reproduce the NUMERIC-as-string driver behaviour, which is the actual root cause, so this test carries the proof.
   - Create a network device through `createAsset` the way Quick Add does.
   - Read it with `getAsset`, map it as the form does, and send a warranty-only `updateAsset`. Expect success.
   - Repeat for a workstation with null numerics.
3. **Form tests** in `packages/assets/src/components/AssetForm.customTypes.test.tsx` (harness already mocks `updateAsset` and `DatePicker`), or a sibling file.
   - Clearing the Power Draw input submits `null`, not `NaN`. Typing `12.5` submits `12.5`.
   - A stored `0` renders as `0`.
   - A returned `validationIssues` result renders the inline error under the matching input, and the toast is the validation summary, not "Failed to update asset".
   - A picker change to local 31 Dec submits `2026-12-31T00:00:00.000Z` with `TZ=Australia/Brisbane` set for the test (or `vi.setSystemTime` plus a TZ-pinned run).
4. Update existing tests that expect `rejects.toThrow` for update validation (`assetActions.customTypes.test.ts:438, 449, 464`). They should now assert the returned structured error. `createAsset` and `updateAssetRecord` keep throwing, so their tests stay as they are.

## 6. Deliberately NOT doing

- **No global pg NUMERIC type parser.** Adding `setTypeParser(1700, parseFloat)` in `knexfile.ts` would also fix this, but it changes every decimal column app-wide, including billing and money columns where string precision is deliberate. The asset read contract (`formatAssetForOutput`) is the right layer.
- **No change to the stored date convention** (UTC-midnight `timestamp`) and no column migration to `date`. Display sites outside the edit form (`AssetDetails.tsx:168`, `AssetBentoLayout.tsx:211`) that call `toLocaleDateString()` on a UTC-midnight value can show the previous day west of UTC. That is a separate ticket. Note it, don't fix it here.
- **Not touching the REST API asset path** (`server/src/lib/api/schemas/asset.ts`, `AssetService`). It has its own schemas and does not go through `getAsset` or `AssetForm`. The `number | null` type change may need only compile fixes there.
- **No change to how errors surface in `updateAssetRecord`.** It stays throw-based for sessionless callers (Hudu sync `ee/server/src/lib/integrations/hudu/assetSyncCore.ts:169`, `assetDestinationProvider.ts:373,391`).
- **No customer reply.** Customer-facing replies stay with Robert. The Update PSA Ticket step posts internal notes only.
- **No feature work** on the customer's request for configurable warranty-expiry tickets (comment on 2026-08-20). Date-based workflow triggers (alga-2026-0002570) already cover it.

## 7. Risks

- **`getAsset` shape change** (Date → ISO string, numeric string → number). Every consumer is typed for strings and numbers, so this is a correctness fix. Still, grep for Date-method use before landing (step 1).
- **`number | null` ripple.** About 15 files reference these fields. Type errors are the safety net; display code must render "not provided" rather than `null`/`NaN`. RMM sync writers must keep compiling.
- **Making events best-effort.** A failed `ASSET_UPDATED` or `ASSET_ASSIGNED` publish is now logged, not surfaced. That is the correct trade-off for a committed write, but those two events have no scan-based retry, unlike warranty, so a lost publish stays lost. The log line must carry enough context to diagnose.
- **Moving the output check before commit** means a residual output-schema mismatch now blocks the save instead of reporting a false failure after it. Step 4's formatter normalisation is what keeps this from hitting legacy rows. Test with a null-string legacy row (Case F).
- **Prod-only symptom.** The generic toast only appears in production builds. The tests assert the returned-result contract, and the manual smoke must use a production build (`next build && next start`), or it will see the dev-mode message and miss the failure.

## 8. Manual smoke (after implementation, production build)

1. Quick Add a network device. Open Edit, set a warranty end date about two weeks out, and save. The save succeeds, and reopening Edit shows the same date (with the browser in an AU timezone).
2. On that device, set Power Draw to 12.5 and save. Reopen: it shows 12.5. Clear it and save. Reopen: the field is blank and the database holds `NULL`.
3. Workstation with blank CPU/RAM/storage: a warranty-only edit succeeds.
4. Type a non-numeric value into Power Draw via devtools, or force an invalid server value. The inline field error and the validation summary toast appear, not "Failed to update asset".
