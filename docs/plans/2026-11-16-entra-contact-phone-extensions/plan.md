# Plan — Entra contact sync: Teams Phone extensions and continue past per-user failures

Date: 2026-11-16
Status: ready for implementation
Origin: PBNJ Consulting Inc. (Phill Hodgkinson), ticket alga-2026-0002987
Branch: `feature/entra-cipp-contact-sync-parse-teams-phone-extens`

## Problem

Entra contact sync (CIPP and direct providers) passes each Microsoft phone value straight into the contact's phone rows. `buildEntraContactPhoneNumbers` (`ee/server/src/lib/integrations/entra/sync/contactFieldSync.ts:35-62`) only trims `businessPhones` and `mobilePhone`, so a Teams Phone value such as `+14165551234;ext=228` reaches `ContactModel.validatePhoneNumbers`, fails `phonePattern = /^[0-9A-Za-z+().\-#\s/]+$/` (`shared/models/contactModel.ts:357`) and is rejected with `Phone number contains unsupported characters` (line 635). `createContactForEntraUser` and `upsertContactLink` (`contactReconciler.ts`) do not catch that error, and `executeEntraSync` (`syncEngine.ts:132-313`) has no guard around the per-user body, so the throw leaves the loop. The activity then fails, the workflow records the whole client as `failed` with that one error message, and every remaining user for the client is never processed. Nothing in the result chain can report a per-user failure: the activity's existing `warnings` are not even persisted.

All facts in the card brief checked out against the code. Line numbers for the CIPP adapter are `cippProviderAdapter.ts:610-614` (`mobilePhone` / `businessPhones`), the direct adapter `directProviderAdapter.ts:448-449`. One addition the brief did not have: `syncTenantUsersActivity` returns `warnings`, but `recordSyncTenantResultWithDb` never writes them and `entra_sync_run_tenants` has no column for them, so anything the engine reports per user today is lost before it reaches the UI.

## Decisions

**D1 — one shared extension parser, used by the one shared mapper.** `parseEntraPhoneValue(raw)` lives next to `buildEntraContactPhoneNumbers` in `contactFieldSync.ts`. Both adapters already produce `EntraSyncUser.businessPhones` / `mobilePhone` and every path (create, link, preview) goes through `buildEntraContactPhoneNumbers`, so fixing the mapper fixes both providers. It recognizes a marker at the end of the value, case-insensitively:

| Marker | Example | Rule |
|---|---|---|
| `;ext=` with optional spaces around `;` and `=` | `+14165551234;ext=228`, `+1 416 555 1234 ; EXT = 228` | Captures everything after `=` (the marker is unambiguous). |
| whitespace + `ext` or `ext.` | `+1 416 555 1234 ext. 228`, `(416) 555-1234 ext 228` | Leading whitespace required; captures a run of digits/spaces/dashes. |
| `x` + digits | `+14165551234x228`, `416-555-1234 x 228` | The `x` must follow a digit, whitespace or `)`, so vanity numbers like `1-800-BOX1234` are not split. Captures a run of digits/spaces/dashes. |

The phone part is everything before the marker, trimmed. The extension is the captured run with spaces and dashes removed. A value with no marker is returned trimmed and otherwise unchanged. If the phone part would be empty, the value is returned unparsed and falls to D4.

*Flag (small signature addition):* to make D2 visible, the return type carries the discarded text: `{ phoneNumber: string; extension?: string; discardedExtension?: string }`. `discardedExtension` is set only when a marker was found but the extension failed the limits. It does not change D1's behaviour.

**D2 — an extension outside the row limits is dropped, the number is kept.** The limits are those of `phoneRowInputSchema.extension` (`contactModel.ts:159`: `/^\d*$/`, `.max(10)`). After cleaning, an extension that is not 1-10 digits is dropped and reported as a notice (see D4). A missing extension is metadata loss; a missing contact is the customer's bug.

**D3 — `ContactModel.validatePhoneNumbers` is not weakened.** `phonePattern` keeps its current character set; `;` and `=` are never added. The mapper normalizes before validation. To avoid a second copy of the pattern in the Entra code, the existing per-value check (digit present, `phonePattern`) is moved unchanged into a small pure module and imported back by `ContactModel`. This is a move, not a relaxation: `validatePhoneNumbers` returns exactly the same errors for exactly the same inputs.

**D4 — a phone value that is still invalid after parsing is skipped, the contact is kept.** The mapper runs the shared per-value check on each parsed value and leaves out rows that fail, recording a notice per skipped row. `is_default` and `display_order` are computed after filtering so the "exactly one default" rule in `validatePhoneNumbers` still holds (first surviving work phone, else the mobile phone). The mapper never throws for a phone value.

**D5 — one user's failure never stops the rest.** The per-user body of `executeEntraSync` moves into a function and runs inside a guard. A throw is caught, recorded as a failure on the result, logged, and the loop continues. Counters for `created` / `linked` / `updated` are incremented only once the contact write for that user succeeded, so a failed user is counted once, as `failed`. The activity returns `status: 'completed'` with a non-zero failure count; the client-level loops in the three workflows are unchanged because nothing throws out of the activity for a per-user failure (their existing `try/catch` still handles directory-read and provisioning failures).

*Flag (stage values):* the guard has to cover `findContactMatchesByEmail` and `queueAmbiguousContactMatch`, which run before the link/create branch. Labelling those `link` or `create` would be wrong, so the stage is `'match' | 'link' | 'create'`. A failure after the contact write succeeded (portal provisioning, reactivation) keeps the stage of its branch and carries the `contactNameId`, so the MSP can tell "contact synced, portal step failed" from "contact not synced".

**D6 — failures are visible where the MSP looks.** No field for per-user failures exists anywhere between the engine and the UI, so this plan adds one end to end: a `failed` counter on the engine counters, the run summary and the tenant result row, plus a capped list of per-user issues on the tenant result row. The sync history panel and the console's last-run table both show "N contacts failed" and the list. Log lines are secondary.

**D7 — both providers, one parser.** No change to either adapter. The fix sits entirely in the shared mapper and the shared engine.

### Answers to the card's open questions

- Extension not digits-only or longer than 10: drop the extension, keep the number, record a notice (D2).
- Other spellings: `;ext=`, ` ext`, ` ext.`, and `x<digits>` are handled (D1). Anything else that leaves invalid characters is skipped as a row with a notice (D4).
- Where failures surface: tenant result row (persisted), run summary, sync history panel and console last-run table (D6).

## Shapes

```ts
// ee/server/src/lib/integrations/entra/sync/types.ts
export type EntraSyncUserIssueStage = 'match' | 'link' | 'create';

export interface EntraSyncUserIssue {
  /** 'failure': the user was not (fully) synced. 'notice': synced, but a field value was changed or left out. */
  severity: 'failure' | 'notice';
  stage: EntraSyncUserIssueStage;
  entraObjectId: string;
  userPrincipalName: string | null;
  displayName: string | null;
  /** Set when the contact write succeeded before the failure, or for notices on a synced contact. */
  contactNameId?: string | null;
  /** For notices: which field the notice is about. Only 'phone_numbers' today. */
  field?: 'phone_numbers';
  message: string;
}

// ee/server/src/lib/integrations/entra/sync/contactFieldSync.ts
export interface EntraPhoneFieldNotice {
  field: 'phone_numbers';
  source: 'businessPhones' | 'mobilePhone';
  rawValue: string;
  message: string; // e.g. 'Extension "12345678901" was dropped: extensions are 1-10 digits.'
}
```

One issue shape serves failures and notices; the UI filters on `severity`. The persisted list is capped at 100 entries per tenant row (`ENTRA_SYNC_USER_ISSUE_LIMIT`); `failed_count` always holds the true total.

## Change plan (in order)

### 1. `shared/models/contactPhoneValue.ts` (new, pure)

Move, unchanged, `phonePattern` (`contactModel.ts:357`) and `normalizePhoneForSearch` (`contactModel.ts:428`) here, and add the per-value check lifted from `validatePhoneNumbers` lines 629-636:

```ts
export const phonePattern: RegExp;
export function normalizePhoneForSearch(phoneNumber: string): string;
/** Same checks, same messages, as ContactModel.validatePhoneNumbers applies to one phone_number. */
export function checkContactPhoneNumberValue(
  phoneNumber: string
): { valid: true; phoneNumber: string } | { valid: false; reason: 'no_digits' | 'unsupported_characters'; message: string };
```

### 2. `shared/models/contactModel.ts`

Import the three names from `./contactPhoneValue`. In `validatePhoneNumbers`, replace lines 629-636 with a call to `checkContactPhoneNumberValue`, producing the same `phone_numbers.${index}.phone_number: <message>` errors. Line 1583 keeps using `normalizePhoneForSearch` via the import. No behaviour change.

### 3. `ee/server/src/lib/integrations/entra/sync/contactFieldSync.ts`

```ts
export function parseEntraPhoneValue(raw: string): {
  phoneNumber: string;
  extension?: string;
  discardedExtension?: string;
};

export function buildEntraContactPhoneRows(user: EntraSyncUser): {
  rows: ContactPhoneNumberInput[];
  notices: EntraPhoneFieldNotice[];
};

/** Unchanged signature; now returns buildEntraContactPhoneRows(user).rows. */
export function buildEntraContactPhoneNumbers(user: EntraSyncUser): ContactPhoneNumberInput[];
```

`buildEntraContactPhoneRows`: for each `businessPhones` value then `mobilePhone`, trim, skip empty, `parseEntraPhoneValue`, push a notice for `discardedExtension`, run `checkContactPhoneNumberValue` on the phone part; on failure push a notice (`Phone number "<raw>" was not imported: <message>`) and skip the row; on success push `{ phone_number, extension (only if set), canonical_type }`. Then assign `display_order` by position and `is_default` to the first work row, else the first row. `buildContactFieldSyncPatch` keeps calling `buildEntraContactPhoneNumbers`, so its output shape is unchanged.

Starting regex for the parser (the implementer should own it against the test table, not trust it blindly):

```ts
const ENTRA_PHONE_EXTENSION =
  /^(?<phone>.*?)(?:\s*;\s*ext\s*=\s*(?<semi>[^;]*)|\s+ext\.?\s*(?<word>[\d\s-]+)|(?<=[\d\s)])\s*x\s*(?<x>[\d\s-]+))\s*$/i;
```

### 4. `ee/server/src/lib/integrations/entra/sync/contactReconciler.ts`

`detectContactFieldChanges` (lines ~107-115) compares only `[phone_number, canonical_type]`. Add `extension` to the selected columns and to `describe(...)` (`String(row.extension ?? '')`), so a re-sync that only adds an extension counts as `updated` and the dry-run preview agrees with the real run. No other change: the reconciler keeps throwing; the guard lives in the engine.

### 5. `ee/server/src/lib/integrations/entra/sync/syncResultAggregator.ts`

Add `failed` to `EntraTenantSyncCounters`, `EntraTenantSyncCounterType`, the initial state and `add()`.

### 6. `ee/server/src/lib/integrations/entra/sync/syncEngine.ts`

```ts
export interface ExecuteEntraSyncResult {
  dryRun: boolean;
  counters: EntraTenantSyncCounters;          // now includes `failed`
  /** Per-user failures and field notices, in user order. Always present. */
  userIssues: EntraSyncUserIssue[];
  preview?: EntraSyncPreviewIdentity[];
  warnings?: string[];
  excludedContactsOutOfScope: number;
}

async function syncOneEntraUser(
  input: ExecuteEntraSyncInput,
  user: EntraSyncUser,
  ctx: {
    dryRun: boolean;
    counters: EntraSyncResultAggregator;
    preview: EntraSyncPreviewIdentity[] | undefined;
    progress: { stage: EntraSyncUserIssueStage; contactNameId: string | null };
  }
): Promise<EntraSyncUserIssue[]>; // notices for this user
```

- Move lines 133-312 into `syncOneEntraUser`. It sets `ctx.progress.stage` to `'match'` before `findContactMatchesByEmail`, `'link'` / `'create'` when it enters a branch, and `ctx.progress.contactNameId` as soon as `linkExistingMatchedContact` / `createContactForEntraUser` returns.
- Move `counters.increment('linked')` (line 162) and `counters.increment('created')` (line 252) after the successful contact write on the real-run path. Dry-run paths keep incrementing where they do today.
- Notices: on the real-run create path when `createdContact.action === 'created'`, and on the link path when `'phone_numbers' in buildContactFieldSyncPatch(user, input.fieldSyncConfig)`, map `buildEntraContactPhoneRows(user).notices` to `EntraSyncUserIssue` (`severity: 'notice'`, the branch stage, the `contactNameId`). The create path's own `linked` branches call `upsertContactLink(..., {})` and do not write phones, so they produce no phone notices. Dry runs produce the same notices (stage of the branch, no `contactNameId`) so the preflight shows them.
- In `executeEntraSync`, the loop becomes: create a fresh `progress`, `try { issues.push(...await syncOneEntraUser(...)) } catch (error) { counters.increment('failed'); issues.push({ severity: 'failure', stage: progress.stage, ..., contactNameId: progress.contactNameId, message: error instanceof Error ? error.message : String(error) }); logger.warn('Entra sync: user failed, continuing', { tenantId, clientId, entraObjectId, stage, error }) }`. Import `logger from '@alga-psa/core/logger'` (the import already used in `ee/server/src/lib/integrations/entra`).
- The disabled/excluded inactivation blocks after the loop are bulk operations, not per user, and stay as they are.
- Return `userIssues` always.

`createContactForEntraUser` and `linkExistingMatchedContact` each run in their own `withTransaction`, so a throw rolls back only that user's writes. A failure after the contact write (portal provisioning) does not roll the contact back; that is why the issue carries `contactNameId`.

### 7. `ee/temporal-workflows/src/types/entra-sync.ts`

- `EntraSyncRunSummary`: add `failed: number` (contacts that failed, across tenants).
- `EntraTenantSyncResult`: add `failed: number` and `userIssues?: EntraSyncUserIssue[]` (declare the issue type here too, or import it from the server lib if the workflow package already imports server types; it must stay serialisable).

### 8. `ee/temporal-workflows/src/activities/entra-sync-activities.ts`

- `syncTenantUsersActivity` (return at ~line 512): add `failed: syncResult.counters.failed`, `userIssues: syncResult.userIssues`. `status` stays `'completed'`.
- `recordSyncTenantResultWithDb` (line 689): write `failed_count: input.result.failed ?? 0` and `user_issues: knex.raw('?::jsonb', [JSON.stringify((input.result.userIssues ?? []).slice(0, ENTRA_SYNC_USER_ISSUE_LIMIT))])`. Both are updatable columns (the Citus rule at line ~722 only excludes `tenant`, `run_id`, `managed_tenant_id`).

### 9. The three workflows

`entra-all-tenants-sync-workflow.ts`, `entra-initial-sync-workflow.ts`, `entra-tenant-sync-workflow.ts`: `createEmptySummary` sets `failed: 0`; the summation adds `summary.failed += result.failed`; the `failedResult` literals in the `catch` blocks set `failed: 0`. Run `status` logic is unchanged: it is driven by `failedTenants`, so a run with per-user failures is still `completed`.

### 10. Migration `ee/server/migrations/20261116120000_add_entra_sync_run_tenant_user_issues.cjs`

```js
// up
ALTER TABLE entra_sync_run_tenants
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_issues jsonb NOT NULL DEFAULT '[]'::jsonb;
// down: drop both columns
```

Follow the existing Entra migration style in `ee/server/migrations/20260725120000_entra_sync_runs_dry_run_and_scope.cjs`. Adding columns does not change the tenant table count, so the manifest pins in `packages/db/src/lib/tenantTableManifest.golden.test.ts` and `ee/temporal-workflows/src/db/__tests__/tenantTableManifest.test.ts` should not move; run both to confirm.

### 11. `ee/server/src/lib/integrations/entra/entraWorkflowClient.ts` and `sync/syncResultSerializer.ts`

`EntraSyncRunProgressResult.tenantResults[]` (line 42): add `failed: number` and `userIssues: EntraSyncUserIssue[]`. The row mapper (line ~382) reads `row.failed_count` and `row.user_issues` (array or `[]`). The serializer maps `failed` with `toNumber` and `userIssues` as an array of plain objects (drop entries that are not objects). This is where the UI reads the data.

### 12. UI

- `ee/server/src/components/settings/integrations/EntraSyncHistoryPanel.tsx`: add `failed` and `userIssues` to the local `tenantResults` type (line 21). Next to the `summarySkipped` line (~168), show `details.run.summary.failed` when > 0 as "Contacts that failed: N". In each tenant block (~179-202), when `tenant.failed > 0` show "N contacts failed" in `text-destructive`, then list failures (`displayName || userPrincipalName`, stage, message) and, separately and muted, notices. Show at most the persisted entries; if `failed` exceeds the failure entries shown, say "and N more".
- `ee/server/src/components/settings/integrations/entra/EntraConsole.tsx` last-run table (~723-737): under the client name, beside `errorMessage`, show "N contacts failed" when `result.failed > 0`. `entraRunResultOutcome` in `entraConsoleModel.ts` should treat `completed` with `failed > 0` as a warning outcome, not plain success; check `entraConsoleModel.test.ts` and `EntraHistoryTab.tsx`, which also use it.
- Strings go in `server/public/locales/en/msp/integrations.json` under `integrations.entra.syncHistory.details.*` and `integrations.entra.console.lastRun.*`; mirror the keys into the other locale files the repo keeps in sync.

### 13. Preflight

`preflightService.ts:228` already reads `result.counters` and `result.preview`; `counters.failed` and `userIssues` arrive additively. Surface dry-run phone notices in the preflight report only if it is trivial; otherwise leave for a follow-up (see Out of scope).

## Acceptance criteria

- A user with `businessPhones` or `mobilePhone` of `+14165551234;ext=228` syncs to a contact with phone number `+14165551234` and extension `228`, via both the CIPP and direct providers.
- Existing contacts linked to such users update without error on re-sync.
- A user whose data fails validation for any reason does not stop the remaining users of that client from syncing; the failure is visible in the sync run's results.
- Phone values without an extension sync exactly as before.
- Tests cover extension parsing and continue-on-error in the sync loop.

## Test plan

**`ee/server/src/__tests__/unit/entraContactFieldSync.test.ts`** (extend)

- `parseEntraPhoneValue` table: `+14165551234;ext=228` → `+14165551234` / `228`; `+1 416 555 1234 ; EXT = 228`; `+14165551234;ext=` (marker, empty extension → number kept, no extension, `discardedExtension: ''`); `(416) 555-1234 ext. 228`; `416 555 1234 ext 2-28` → `228`; `+14165551234x228`; `416-555-1234 x 228`; `1-800-BOX1234` → unchanged; `1-800-FLOWERS` → unchanged; `+1 416 555 1234` → unchanged; `+14165551234;ext=12345678901` → number kept, extension dropped, `discardedExtension` set; `+14165551234;ext=22a` → extension dropped; `;ext=228` (empty phone part) → returned unparsed.
- `buildEntraContactPhoneNumbers`: no-extension values produce exactly today's rows (`phone_number`, `canonical_type`, `is_default`, `display_order`, no `extension` key); extension values produce `extension`; an unparseable value (`+1416555;1234`) is left out with a notice and `is_default` moves to the next row; all values invalid → `[]` with notices; mobile becomes default when every business phone was skipped.
- Every row it returns passes `ContactModel.validatePhoneNumbers` (property-style loop over the table).

**`shared/models/__tests__/contactPhoneValue.test.ts`** (new; put it wherever the shared model unit tests live)

- `checkContactPhoneNumberValue` returns the same messages `validatePhoneNumbers` produced before the move, for `abc`, `+1;2`, `+1 (416) 555-1234`.
- `validatePhoneNumbers` still rejects `+14165551234;ext=228` with "Phone number contains unsupported characters" (D3 guard).

**`ee/server/src/__tests__/unit/entraSyncEngine.dryRun.test.ts`** (extend; it already mocks the reconciler, matcher and portal modules)

- Three users, `createContactForEntraUserMock` rejects for the second: the third is still processed; `counters.created === 2`, `counters.failed === 1`; one `userIssues` entry with `severity: 'failure'`, `stage: 'create'`, the user's `entraObjectId` / `userPrincipalName` and the error message; the function resolves.
- Same with `linkExistingMatchedContactMock` rejecting: `stage: 'link'`, `linked` not incremented for that user.
- `findContactMatchesByEmailMock` rejecting for one user: `stage: 'match'`.
- Link succeeds, `handleEligibleClientPortalProvisioningMock` rejects: failure carries `contactNameId`; `linked` counted.
- Created user with `mobilePhone: '+14165551234;ext=12345678901'`: one `notice` issue for `phone_numbers`, `failed === 0`.
- Disabled/excluded inactivation still runs after a per-user failure.

**`ee/server/src/__tests__/unit/entraContactReconciler.test.ts`** (extend)

- `detectContactFieldChanges` / `previewLinkedContactChange`: a phone row identical except for `extension` is reported as changed.

**`ee/server/src/__tests__/unit/entraSyncResultAggregator.test.ts`** — update the `toEqual` expectations for the `failed` counter; `increment('failed')` and `add({ failed })`.

**`ee/server/src/__tests__/unit/entraSyncResultSerializer.test.ts`** — `failed` and `userIssues` round-trip; missing `user_issues` → `[]`.

**`ee/server/src/__tests__/unit/entraSyncHistoryPanel.test.tsx`** and **`entraConsoleModel.test.ts`** — "N contacts failed" renders when `failed > 0` and not otherwise; failure entries render; `completed` + `failed > 0` is a warning outcome.

**Temporal activity** — wherever `recordSyncTenantResultWithDb` is tested (`ee/temporal-workflows/src/activities/__tests__/` or `src/db/__tests__/`): `failed_count` and `user_issues` are written, capped at 100.

**Integration: `ee/server/src/__tests__/integration/entraUserFilters.integration.test.ts`** (or a sibling `entraContactPhoneExtensions.integration.test.ts` using the same bootstrap)

- Real DB: `executeEntraSync` with a user whose `businessPhones` is `['+14165551234;ext=228']` creates a contact whose `contact_phone_numbers` row has `phone_number = '+14165551234'`, `extension = '228'`.
- Re-sync with phone field sync on, for the now-linked contact: no throw, row unchanged, `updated` not incremented; change the extension upstream → `updated` incremented, row updated.
- An existing client contact matched by email (link path) gets the split row.
- Three users, the middle one has no email/UPN (forces `Cannot create contact for Entra user without email/UPN.`): users 1 and 3 exist afterwards, `failed === 1`.

**Providers** — `entraProviderAdapterSeams.test.ts` (or the adapter tests) assert both adapters pass `;ext=` values through untouched into `EntraSyncUser`, which pins D7: the parsing is in the shared mapper and nowhere else.

## Out of scope

- Persisting the engine's existing `warnings` (e.g. "Excluded contacts were left active…"); they are dropped by `recordSyncTenantResultWithDb` today. Same gap, separate change.
- Persisting tenant-row `skipped`: the history panel renders `tenant.skipped ?? 0` but there is no `skipped_count` column, so it always shows 0.
- Adding failed-contact counts to Entra sync notifications (`entraSyncNotificationRules.ts` keys on `failedTenants`).
- Showing phone notices in the preflight report UI.
- Any change to the contact UI or to manual contact phone validation.
- Spellings other than those in D1 (e.g. `tel:` URIs, `#228`, `,228` pause dialing).

## Risks

- **Parser false positives.** The `x` and ` ext` markers can match text that is not an extension. Mitigated by the lookbehind on `x`, the whitespace requirement on `ext`, a digit-run capture, and the vanity-number tests.
- **Phones replaced on re-sync.** Phone field sync already replaces the contact's phone rows with Entra's list. If every Entra value is now skipped, the contact ends with no phones where before the sync would have thrown and left them alone. This matches the existing "Entra is the source" behaviour for an empty list and is reported as notices, but it is a visible change for a contact whose only phone was invalid.
- **Partial work after a failure.** A user can be created/linked and then fail in portal provisioning; the contact stays. The issue's `contactNameId` and stage make that state explicit rather than hiding it.
- **Counter semantics.** Moving `linked` / `created` increments after the write changes counts only for failing users; tests that assert counts with mocked rejections need updating.
- **Migration on Citus.** `entra_sync_run_tenants` is distributed; `ADD COLUMN ... DEFAULT` with a constant is supported. Verify against the local Citus stack before merging.
- **jsonb size.** Capped at 100 issues per tenant row.

## Facts for implementers

- Shared mapper: `ee/server/src/lib/integrations/entra/sync/contactFieldSync.ts` — `buildEntraContactPhoneNumbers` is the single path for both providers. It is used by `buildContactFieldSyncPatch` (link path and dry-run preview via `contactReconciler.ts:143, 240`) and directly by `createContactForEntraUser` (`contactReconciler.ts:428`).
- Adapters: `ee/server/src/lib/integrations/entra/providers/cipp/cippProviderAdapter.ts:610-614` and `.../providers/direct/directProviderAdapter.ts:448-449`, both through `normalizeEntraSyncUser` (`sync/types.ts:30`), which only trims. No adapter change.
- Validation: `shared/models/contactModel.ts` — `phoneRowInputSchema` line 155 (extension line 159, comment "Extension has its own column; it is never packed into phone_number"), `phonePattern` line 357, `normalizePhoneForSearch` line 428 (also used at line 1583), `validatePhoneNumbers` line 603, the error at line 635. No existing helper parses extensions out of phone strings anywhere in `ee/server/src/lib/integrations`.
- Engine: `ee/server/src/lib/integrations/entra/sync/syncEngine.ts` — `executeEntraSync` line 123, loop 132-313, link call 183, create call 256, return 374-380. Result type `ExecuteEntraSyncResult` line 84. Counters come from `EntraSyncResultAggregator` (`syncResultAggregator.ts`).
- The engine is called per client by `syncTenantUsersActivity` (`ee/temporal-workflows/src/activities/entra-sync-activities.ts:322`, call at 417, return ~512-526) and by the preflight (`sync/preflightService.ts:228`, dry run). The client-level loops are in `ee/temporal-workflows/src/workflows/entra-all-tenants-sync-workflow.ts` (~113-160), `entra-initial-sync-workflow.ts` (~121-160), and `entra-tenant-sync-workflow.ts` (~120-147); each already catches an activity failure and records the client as `failed`.
- Persistence: `recordSyncTenantResultWithDb` (`entra-sync-activities.ts:689`) writes `entra_sync_run_tenants` (schema in `ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs:198`). It does not persist `warnings` or `skipped`. Citus: never put `tenant` in an UPDATE's SET list (see the comment at ~722).
- UI read path: `entraWorkflowClient.ts` (`EntraSyncRunProgressResult` line 29, row mapper ~382) → `sync/syncResultSerializer.ts` → `components/settings/integrations/EntraSyncHistoryPanel.tsx` (tenant block ~179-202) and `components/settings/integrations/entra/EntraConsole.tsx` (last-run table ~723, outcome via `entraConsoleModel.ts#entraRunResultOutcome`).
- Failure record shape chosen: `EntraSyncUserIssue` (see Shapes) — `severity`, `stage: 'match' | 'link' | 'create'`, `entraObjectId`, `userPrincipalName`, `displayName`, `contactNameId?`, `field?`, `message`. Count in `counters.failed` / `failed_count` / `summary.failed`.
- Gotcha: `detectContactFieldChanges` (`contactReconciler.ts` ~107-115) ignores `extension`; fix it or extension-only changes never count as updates and the preview disagrees with the run.
- Gotcha: `createContactForEntraUser`'s two `linked` branches call `upsertContactLink(..., {})` with an empty field config, so they never write phones; only the `created` branch writes Entra phones on the create path.
- Gotcha: each reconciler call opens its own transaction (`runWithTenant` + `withTransaction`), so catching in the engine leaves no half-written contact for that call.
- Unit test pattern: `ee/server/src/__tests__/unit/entraSyncEngine.dryRun.test.ts` mocks `contactMatcher`, `contactReconciler`, `disableHandler`, `clientPortalProvisioning`, `workflowManagedProvisioning` with `vi.mock` and imports the engine dynamically; reuse it for the continue-on-error tests.
- Logger: `import logger from '@alga-psa/core/logger';` (already used in `ee/server/src/lib/integrations/entra`).
- Strings: `server/public/locales/en/msp/integrations.json` (`integrations.entra.syncHistory.details.*`).
