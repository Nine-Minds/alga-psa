# Questionnaire answer → account/asset mapping — implementation plan

Card: **alga0002313 — Map questionnaire answers to account and asset data** (3e68eb8b-e316-4978-a85b-9704dff05fb3)
Author: robert@nineminds.com · Date: 2026-09-20
Status: **implementation draft in progress — open questions resolved with proposed defaults (see §11)**

## 0. Intent

Provide an explicit, configurable, versioned mapping from a questionnaire's stable
question identifiers to an allowlisted set of structured fields on a customer
account (`clients`) and its associated assets (`assets`). Applying a completed
questionnaire updates the selected destinations **without ever mutating or
discarding the raw submission**. Every applied field produces a visible per-field
result (applied / skipped / failed) with before-and-after values in the existing
audit trail. Ambiguity in asset resolution (zero **or** multiple candidates)
never guesses — it reports and stops for that field.

This is the follow-on to the store-only submission substrate (below). It reuses
that substrate's seams — the immutable `service_request_submissions` record, the
provider registry, the submission-key idempotency discipline, and
`recordServiceRequestSubmissionAudit` — rather than inventing parallel machinery.

---

## 1. Hard dependency: the store-only substrate is NOT on this branch

**This branch (`feature/alga0002313-map-questionnaire-answers-to-account`) does not
contain the store-only work and cannot be built on as-is.** Verified 2026-09-20:

- The branch tip is a `fix/assets_documents_query` merge; it sits ~1375 commits
  behind `origin/main`.
- None of the store-only substrate exists here: there is no
  `providers/builtins/storeOnlyExecutionProvider.ts`, no `submissionAudit.ts`, no
  `recordServiceRequestSubmissionAudit`, no `client_submission_key` column, and
  `domain.ts` still lacks a `STORE_ONLY` execution mode.
- The predecessor PR **#3311 is now MERGED into `origin/main`** (the commissioning
  brief predates the merge; it described the PR as open). The substrate lives on
  `origin/main` at:
  - `server/src/lib/service-requests/providers/builtins/storeOnlyExecutionProvider.ts`
  - `server/src/lib/service-requests/submissionAudit.ts`
  - `server/src/lib/service-requests/submissionService.ts` (idempotent submit path,
    `client_submission_key`, `recordSubmissionExecutionOutcome`)
  - migration `…_add_service_request_submission_client_key.cjs`
  - plan `docs/plans/2026-09-02-store-only-service-request-submissions-plan.md`.

**Prerequisite step, before any mapping code:** merge `origin/main` into this branch
(or rebranch from current `origin/main`). All file references below assume the
post-merge tree. Implementation must not begin until the merge lands and the dev
stack (port 3520) comes back green.

### What the substrate gives us (and we must reuse)

- **Immutable source record.** `submitPortalServiceRequest` persists the
  `service_request_submissions` row (definition version snapshot, raw
  `submitted_payload`, attachments, requester, client, contact) *before* any
  provider runs. The submission is the immutable source; nothing in this card
  writes back to `submitted_payload`.
- **Provider registry seam.** `providers/registry.ts` is a global keyed registry
  with built-in + enterprise registration. Execution/form-behavior/visibility
  providers are all typed contracts in `providers/contracts.ts`. This is the
  pattern the destination model copies (§2).
- **Versioning pattern.** `service_request_definitions` (mutable working copy) +
  `service_request_definition_versions` (immutable, `version_number`-numbered
  snapshots incl. `form_schema_snapshot`). A submission records
  `definition_version_id`. Our mapping versioning mirrors this exactly (§3).
- **Idempotency discipline.** `client_submission_key` (nullable uuid) + Citus-safe
  partial unique index `service_request_submissions_client_key_unique` over
  `(tenant, requester_user_id, definition_id, client_submission_key)`, plus
  `isClientSubmissionKeyConflict` — a 23505 detector whose regex is anchored to
  tolerate Citus shard-suffixed constraint names
  (`…_client_key_unique_<shardid>`). We reuse this *discipline* for apply
  idempotency (§6), not a second bespoke scheme.
- **Audit discipline.** `recordServiceRequestSubmissionAudit(knex, tenant, op,
  params)` writes to `audit_logs` inside the caller's transaction (mandatory, not
  best-effort; a failed audit rolls back the write). Operations today:
  `service_request_submission_created`, `_execution_succeeded`, `_execution_failed`.
  We *extend* this operation set (§7); we do not add a parallel audit path.
- **Stable question identifier.** `formSchema.fields[].key` (pattern
  `^[a-z][a-z0-9_]*$`, slugified + de-duplicated at authoring). Answers in
  `submitted_payload` are keyed by this `key`. This is the join point between a
  question and its stored answer, and the anchor of every mapping rule.

---

## 2. Destination model — account & asset fields as first-class targets

### 2.1 The seam: a destination-provider registry (mirrors the execution-provider registry)

Introduce `server/src/lib/service-requests/mapping/destinations/` with a registry
that mirrors `providers/registry.ts` shape (global keyed store, built-in +
enterprise registration, `get`/`list`/`reset`). A **`MappingDestinationProvider`**
is a typed contract:

```ts
interface MappingDestinationProvider {
  kind: string;                    // 'account' | 'asset' | future kinds
  displayName: string;             // translated label, never the raw key
  listTargetFields(): MappingTargetField[];   // the ALLOWLIST — code-defined
  getTargetField(fieldKey: string): MappingTargetField | undefined;
  resolveTarget(ctx: MappingResolveContext): Promise<ResolveTargetResult>;
  applyField(ctx: MappingApplyFieldContext): Promise<ApplyFieldResult>;   // reads before, writes after, in caller's trx
}

interface MappingTargetField {
  fieldKey: string;                // stable allowlist key, e.g. 'client_name', 'properties.industry', 'serial_number'
  displayLabel: string;            // translated
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'reference';
  enumValues?: string[];           // for 'enum'
  coerce(raw: unknown): { ok: true; value: unknown } | { ok: false; error: string };
  validate(value: unknown): { ok: true } | { ok: false; error: string };
  requiredPermission: { resource: string; action: string };  // e.g. { resource:'client', action:'update' }
}
```

Adding a **future structured destination** (e.g. contacts, locations, a billing
record) is exactly: implement one more `MappingDestinationProvider` and register
it. No table reshaping, no engine change — the model is closed for modification,
open for extension. (This is the same registry pattern already proven for
execution/visibility/form-behavior providers.)

> LEVERAGE candidate (do not detour now): this is the *second* concrete instance of
> "typed keyed provider registry + built-in/enterprise registration" in the
> service-requests domain. If a third appears, extract a generic
> `createProviderRegistry<T>()` layer. Noted as open question OQ-7.

### 2.2 The account destination provider (`kind: 'account'`)

- **Target resolution is trivial and always unambiguous:** the account is the
  submission's `client_id`. There is exactly one per submission. No guessing.
- **Applier** writes through the canonical trx-scoped entrypoint
  `ClientModel.updateClient(clientId, input, tenant, trx)`
  (`shared/models/clientModel.ts:336`) — the same path the `updateClient` server
  action uses (`packages/clients/src/actions/clientActions.ts:274`). This preserves
  the existing merge-not-replace semantics for `properties` and the `url`↔
  `properties.website` mirroring, and keeps client write validation intact.
- **Allowlist (initial):** direct scalar columns `client_name`, `url`,
  `client_type`, `notes`, `tax_id_number`, `payment_terms`, `billing_cycle`,
  `credit_limit`, `preferred_payment_method`, `auto_invoice`,
  `invoice_delivery_method`, `region_code`, `is_tax_exempt`,
  `tax_exemption_certificate`, `timezone`, `billing_email`, `is_inactive`; and
  merged JSONB `properties.*` keys `industry`, `company_size`, `annual_revenue`,
  `status`, `website`. **Exclusions to encode explicitly:** phone / email / street
  address are NOT on `clients` — they live on `client_locations`, and the
  `updateClient` path deliberately strips them. They are out of scope for the
  account provider and become a *future* `location` destination kind (OQ-3).
- The `account_manager_id` field is a reference to a user; include only if we can
  validate the reference (see OQ-5). Default: exclude from the initial allowlist.

### 2.3 The asset destination provider (`kind: 'asset'`)

- **Target resolution is deliberate and ambiguity-hard (see §5).**
- **Applier** writes through the actor-injectable core
  `updateAssetRecord(knex, tenant, actorUserId, asset_id, data, opts, hooks)`
  (`packages/assets/src/actions/assetActions.ts:1095`) — the transactional core
  behind the `updateAsset` server action. It already validates against
  `updateAssetSchema`, splits base scalar vs. per-type extension payloads,
  validates `attributes` against the asset's `asset_type_registry.fields_schema`,
  and writes asset history.
- **Allowlist (initial):** `assets` scalar columns `name`, `asset_tag`,
  `serial_number`, `status`, `location` (free text), `purchase_date`,
  `warranty_end_date`. Per-type extension-table fields (workstation / server /
  network_device / mobile_device / printer) and `attributes.*` keys are declarable
  but gated: an `attributes` target is only offered when the resolved asset's
  `asset_type` registers that key in its `fields_schema` (else the field coercion
  fails visibly). `client_id` is never a mapping target (never re-parent an asset).
  `location_id` requires reference validation (OQ-5) — exclude initially; use
  free-text `location` first.

### 2.4 Where the raw submission stays immutable

No destination provider ever writes `service_request_submissions.submitted_payload`
or mutates the submission row's identity columns. Application state lives entirely
in new sidecar tables (§3). This satisfies "keep raw questionnaire submissions
immutable as the source record."

---

## 3. Mapping definition, storage & versioning

Mappings are **per service-request definition** (the questions come from that
definition's `formSchema`). Storage mirrors the definition/version split so mapping
evolution is decoupled from definition republish and is independently versioned.

New tables (all `(tenant, …)` PK, tenant-distributed via
`ensureTenantDistribution`, registered in both `tenantTableMetadata.ts` and the
migration shim `server/migrations/utils/tenantDb.cjs`):

1. **`service_request_answer_mappings`** — the mutable working copy, one row per
   definition.
   - `mapping_id` (uuid), `tenant`, `definition_id` (fk), `lifecycle_state`
     (`draft`/`published`), `current_version_id` (nullable), timestamps,
     `updated_by`.
   - Draft rules edited here (child rows or an embedded JSONB `rules` working set —
     match whatever the definition editor does for `form_schema`; the definition
     stores `form_schema` as a JSONB working copy, so we store `rules` as JSONB
     working copy for symmetry).

2. **`service_request_answer_mapping_versions`** — immutable numbered snapshots
   (the exact analogue of `service_request_definition_versions`).
   - `version_id` (uuid), `tenant`, `mapping_id` (fk), `definition_id`,
     `version_number` (monotonic per mapping, `max+1` in a txn — same as
     `publishServiceRequestDefinition`), `rules_snapshot` (jsonb), `published_by`,
     `published_at`, `created_at`.
   - `rules_snapshot` is a frozen array of **mapping rules**:
     ```jsonc
     {
       "ruleId": "uuid",
       "questionKey": "serial_number",         // stable formSchema field.key
       "destinationKind": "asset",             // registry kind
       "targetFieldKey": "serial_number",      // allowlisted field within the kind
       "assetSelector": {                       // asset kind only; see §5
         "strategy": "answer-asset-ref" | "match-attribute",
         "assetRefQuestionKey": "which_asset",  // strategy=answer-asset-ref
         "matchAttribute": "asset_tag",         // strategy=match-attribute
         "matchQuestionKey": "device_tag"
       },
       "transform": { /* optional coercion overrides, reserved */ }
     }
     ```

**Which version runs, and how it is recorded.** Applying a submission uses the
mapping's currently-published version by default; the chosen `mapping_version_id`
is recorded on the application record (§4) so the applied run is reproducible.
Replay reuses the recorded `mapping_version_id`. Preview runs against a chosen
version (published, or the working draft for "validate before publish").

**Cross-version question drift is handled, not feared.** A rule's `questionKey`
may be absent from a given submission's `form_schema_snapshot` (question added or
removed across definition versions). That yields a per-field **skipped: answer
absent** result — never an error, never a guess.

**Publishing** (`publishAnswerMapping`) copies the working `rules` into a new
immutable version row (`version_number = max+1`), flips `lifecycle_state`, and sets
`current_version_id`, all in one tenant-scoped transaction — a direct copy of
`publishServiceRequestDefinition`'s shape.

---

## 4. Application records & per-field outcome model

Two new tenant-distributed tables record every apply run and its per-field results.

1. **`service_request_submission_applications`** — one row per apply run.
   - `application_id` (uuid), `tenant`, `submission_id` (fk), `mapping_version_id`
     (fk), `applied_by`, `applied_at`, `status`
     (`applied` / `partially_applied` / `failed` / `no_op`), `summary` counts.
   - **Idempotency:** partial unique index over `(tenant, submission_id,
     mapping_version_id)` — see §6.

2. **`service_request_submission_application_results`** — one row per rule per run.
   - `result_id` (uuid), `tenant`, `application_id` (fk), `rule_id`, `question_key`,
     `destination_kind`, `target_field_key`, `resolved_target_ref` (the
     `client_id` or `asset_id` acted on, nullable when unresolved),
     `resolved_target_display` (display name captured for the UI — never a raw
     UUID), `status`, `before_value` (jsonb), `after_value` (jsonb),
     `error_code`, `error_detail`, `created_at`.
   - `status` ∈ `applied` | `skipped_answer_absent` | `skipped_no_change` |
     `failed_validation` | `failed_type_conversion` | `failed_permission` |
     `failed_asset_unresolved` (zero candidates) |
     `failed_asset_ambiguous` (multiple candidates).

Because each result carries `before_value`/`after_value` and a resolved target,
the admin surface (§8) can render the full before-and-after table and the audit
trail directly from these rows.

---

## 5. Asset resolution & the never-guess rule

Account resolution is implicit (`submission.client_id`). Asset resolution is the
only place ambiguity can arise, and the rule is absolute: **zero OR multiple
candidate assets → do not guess; record and stop for that field.**

Two admin-chosen strategies per rule (`assetSelector.strategy`):

- **`answer-asset-ref`** — a question in the form directly captures an asset (a
  future asset-typed question, or a select whose option values are asset ids). The
  answer *is* the `asset_id`. The engine validates that asset exists **and belongs
  to `submission.client_id`** (account isolation); otherwise `failed_asset_unresolved`.
- **`match-attribute`** — match an answer against an asset attribute
  (`asset_tag` / `serial_number` / `name`) among the submission client's assets,
  via `listAssets` filtered by `client_id` (`assetActions.ts:1887`). The candidate
  set is computed **scoped to `client_id`**:
  - exactly 1 candidate → resolved, proceed;
  - 0 candidates → `failed_asset_unresolved`;
  - ≥2 candidates → `failed_asset_ambiguous`.

In both strategies the candidate query is tenant- and client-scoped through
`tenantDb`, so cross-account resolution is structurally impossible. An unresolved
asset fails only the asset-targeted fields that depend on it; account fields and
other resolvable assets in the same run still apply (partial application, §6).

---

## 6. Permissions, isolation (Citus), and idempotent replay

### 6.1 Permissions

- **Configuring mappings** is gated exactly like the definition editor: the
  service-request admin permission, enforced by the existing
  `requireServiceRequestPermission` (`server/src/app/msp/service-requests/actions.ts`)
  against the `service` resource (`read` to view, `update`/`create` to edit/publish).
  Client-portal users are rejected outright (as today).
- **Applying** enforces destination write permission **per field**: the acting
  user must hold the target field's `requiredPermission` — `client:update` for
  account fields, `asset:update` for asset fields — checked via
  `hasPermission(user, resource, action)` from `@alga-psa/auth`. A field whose
  permission is denied is recorded `failed_permission` and skipped; the raw
  submission and every other field are untouched. (Configuring a mapping to a field
  the tenant's admins can't ever write should surface a *warning* at authoring
  time; enforcement remains at apply time.)
- A **new permission is likely warranted** for the apply action itself
  (`service_request_mapping:apply` or reuse `service:update`) — flagged OQ-1. If a
  new resource/action is chosen, it is added to
  `server/migrations/utils/permissions/catalog.cjs` (`ACTIVE_PERMISSIONS`) plus a
  `reconcileAllTenants` migration (pattern:
  `20260828120000_add_credential_audit_permission.cjs`).

### 6.2 Tenant & account isolation (Citus-aware)

- Every read/write goes through the `tenantDb` facade; new tables are registered in
  `tenantTableMetadata.ts` and the CJS migration shim, distributed on `tenant` via
  `ensureTenantDistribution`, with `tenant` in every PK and unique index (per the
  Citus standards). Migrations that distribute set
  `exports.config = { transaction: false }`.
- No reliance on the `app.current_tenant` GUC for isolation (RLS is gone);
  isolation is application-enforced. The one legitimate GUC use is inside
  `recordServiceRequestSubmissionAudit`, which we reuse unchanged.
- Asset candidate resolution and all destination writes are `client_id`-scoped, so
  a submission for account A can never read or write account B's assets/fields.

### 6.3 Idempotent replay — reuse the submission-key discipline, don't reinvent it

The natural idempotency key for an apply is the tuple **`(tenant, submission_id,
mapping_version_id)`**: applying the same immutable submission under the same frozen
mapping version is a pure function of (answers, rules) → destination writes, and
every destination write is *set-field-to-value* (converging), never append. Replay
therefore re-computes the same target state safely.

We reuse the store-only *discipline* verbatim, generalized:

- a **partial unique index** on `service_request_submission_applications`
  over `(tenant, submission_id, mapping_version_id)`;
- the **23505 conflict-recovery** shape from `isClientSubmissionKeyConflict`
  (SQLSTATE-gated, regex anchored to tolerate Citus shard-suffixed index names) —
  factored into a shared helper so both the submission path and the apply path use
  one implementation rather than two look-alikes;
- on a concurrent second apply for the same tuple, load and return the winning
  application row instead of creating a duplicate — the exact move
  `submitPortalServiceRequest` makes on a same-key race.

A **retry** (same submission, same mapping version) converges: previously-`applied`
fields whose destination already equals the mapped value record
`skipped_no_change`; fields that failed transiently are re-attempted. No field is
double-written in a way that differs from a single apply, and no second application
row is created. This is the "idempotent retry" behavioral guarantee.

> Open question OQ-2: whether replay should detect *external drift* (a human edited
> the destination between applies) and refuse to clobber, vs. always converge to the
> mapped value. Default proposed: converge, but record the before-value so the drift
> is auditable.

---

## 7. Audit — before/after per applied field, on the existing path

No parallel audit. Extend the existing `ServiceRequestSubmissionAuditOperation`
union in `submissionAudit.ts` with:

- `service_request_submission_mapping_applied` — one per apply run, `details`
  carries `{ mapping_version_id, applied/skipped/failed counts }`.
- `service_request_submission_mapping_field_applied` and
  `…_mapping_field_failed` — one per field, `changedData` carries
  `{ target_field_key, before_value, after_value }` and `details` carries
  `{ destination_kind, resolved_target_ref, status, error_code }`.

Each field's destination write, its `application_results` row, and its audit event
commit in **one transaction** — the same atomic write+audit discipline
`recordSubmissionExecutionOutcome` already uses, so a stored result can never
diverge from its durable history. The destination models' own history
(`updateAssetRecord` writes asset history; `ClientModel.updateClient` writes client
audit) is retained as well — the mapping audit is the submission-side record of
"this answer changed this field from X to Y".

---

## 8. Admin UX

All UI uses existing standard Alga components; **no raw UUIDs in any table or
select — always the display field**.

### 8.1 Mapping configuration — a new tab in the definition editor

Mappings are per-definition, and the question list is already loaded there, so
configuration lives as a new **"Answer Mapping"** tab/section in
`server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx`
(route `/msp/service-requests/[definitionId]`, gated by the `service` permission).
The question list comes from `getSchemaFields` (the same `formSchema.fields`).

- Rules render in a **`DataTable`** (`packages/ui/src/components/DataTable.tsx`)
  with `render` columns showing: question **label** (not key), destination kind
  label, destination **field display label**, and (for assets) the selector
  summary. Add/edit/remove via server actions mirroring the field-config actions.
- Destination kind and destination field are chosen with **`CustomSelect`**
  (`SelectOption` list built from the registry's `listTargetFields()` — the
  allowlist is the option set, so an out-of-allowlist target is unrepresentable).
- Asset selector configuration uses `CustomSelect` for strategy + the referenced
  question key.
- Publish uses the same publish affordance as the definition (draft → version).

### 8.2 Preview / validate

A **Preview** action runs the engine in **dry-run** mode against a chosen stored
submission (or the latest submission for the definition): it resolves targets,
coerces/validates, and computes before→after **without writing**, returning the
same per-field result shape (§4) including ambiguity/permission outcomes. Rendered
as a before/after `DataTable`. This is the "preview or validate mappings"
requirement and lets an admin catch ambiguity and type failures before applying.

### 8.3 Apply + results + audit

On the **admin submission detail** surface (backed by
`getServiceRequestSubmissionDetailForDefinition`, which already joins `clients` for
`client_name`), add an **Apply mapping** action and a **results panel** that lists
each field's status, resolved target (display name), and before→after, plus the
audit events. Asset/account targets render via `ClientPicker`-style display names
and asset `name` (never ids). No standalone AssetPicker exists — reuse the
`AssociatedAssets` / `CustomSelect`-fed-by-`listAssets` pattern.

> OQ-6: whether apply is admin-triggered only (proposed default) or can also run
> automatically at submission time via an optional `apply-mapping` execution
> provider that calls the same engine. The engine is trigger-agnostic by design; an
> auto-apply provider is a thin future wrapper, but "Never guess" + "preview or
> validate" argue for explicit apply first.

---

## 9. Behavioral test list (DB-backed integration; no source-string tests)

Per the card's required coverage. All assert persisted rows and user-visible /
side-effect behavior — never source strings.

1. **Representative account field types.** Map string (`client_name`), enum-ish
   (`billing_cycle`), boolean (`is_inactive`), and a merged JSONB
   (`properties.industry`) target; apply; assert the `clients` row updated
   correctly, `properties` merged not replaced, and `application_results`
   before/after captured.
2. **Representative asset field types.** Map string (`asset_tag`), date
   (`warranty_end_date`), and an `attributes.*` key valid for the asset's type;
   apply against an unambiguously resolved asset; assert the `assets` row + result
   rows.
3. **Unambiguous associated asset.** `match-attribute` on `serial_number` where
   exactly one asset under the client matches → resolved and applied.
4. **Missing asset context.** `match-attribute` where zero assets match →
   `failed_asset_unresolved`; no asset written; account fields in the same run
   still apply.
5. **Ambiguous asset context.** Two assets under the same client match →
   `failed_asset_ambiguous`; nothing written for that field; never guesses.
6. **Validation failure.** An answer that fails a field's `validate` (e.g. out-of-
   range enum) → `failed_validation`; raw submission and all other fields intact.
7. **Type-conversion failure.** A non-coercible answer for a `date`/`number`
   target → `failed_type_conversion`, raw submission retained.
8. **Permission denial.** Apply as a user lacking `asset:update` (but holding
   `client:update`) → asset fields `failed_permission`, account fields applied;
   submission untouched.
9. **Mapping-version change.** Publish v1, apply a submission (records
   `mapping_version_id = v1`); publish v2 with a changed rule; apply a second
   submission → records v2 and applies the new rule; the v1 application row is
   unchanged and reproducible.
10. **Idempotent retry.** Apply the same (submission, mapping version) twice
    (sequential and concurrent) → one `applications` row, converged destination
    state, second run's fields `skipped_no_change`; no double-write.
11. **Raw-response retention on partial failure.** A run with a mix of applied and
    failed fields → `submitted_payload` byte-identical afterward; failed fields
    recorded; applied fields committed.
12. **Account isolation.** A `match-attribute` rule can never resolve an asset
    belonging to a different client, even when a same-serial asset exists under
    another account.

---

## 10. Implementation sequence (post-merge)

0. **Merge `origin/main`** into this branch; bring the dev stack back up (§1).
1. Migrations: the four new tables (mappings, mapping_versions, applications,
   application_results) with tenant PKs + Citus distribution + shim/metadata
   registration + the partial unique index; permission catalog entry + reconcile
   migration if OQ-1 says so.
2. Destination model: registry + `MappingDestinationProvider` contract + account
   and asset providers (allowlists, coercion/validation, resolvers, appliers over
   `ClientModel.updateClient` / `updateAssetRecord`).
3. Mapping definition/versioning services (`publishAnswerMapping` mirroring
   `publishServiceRequestDefinition`) + working-copy edit actions.
4. Apply engine (dry-run + apply), reusing the generalized submission-key conflict
   helper and `recordServiceRequestSubmissionAudit` (extended ops).
5. Admin UX: Answer Mapping tab, preview panel, apply + results panel.
6. Behavioral integration tests (§9); focused typecheck/tests; i18n for all
   labels/statuses.

---

## 11. Open questions for Robert

- **OQ-1 — Permission granularity.** Add a dedicated apply permission
  (`service_request_mapping:apply`) or reuse `service:update` for authoring +
  `client:update`/`asset:update` per-field at apply time? Proposed: reuse
  `service` for authoring, enforce destination `*:update` per field at apply; add a
  dedicated apply permission only if you want to separate "can configure" from "can
  execute".
- **OQ-2 — Replay vs. external drift.** On replay, always converge to the mapped
  value (proposed), or detect that a human changed the destination since the last
  apply and refuse to clobber? Both are defensible; convergence is simpler and the
  before-value is always audited.
- **OQ-3 — Contacts/locations as destinations.** Phone/email/street address are on
  `client_locations`, not `clients`. Ship account+asset first and add a `location`
  (and/or `contact`) destination kind later (the model supports it cleanly), or
  include locations in v1?
- **OQ-4 — Trigger model.** Admin-triggered apply only (proposed), or also an
  optional auto-apply-on-submit execution provider? The engine is trigger-agnostic;
  this is a product-safety call given "Never guess" + "preview".
- **OQ-5 — Reference-typed targets.** Fields like `account_manager_id`,
  `location_id`, `region_code` are references. Exclude from the initial allowlist
  (proposed), or invest in reference-resolution/validation (e.g. match a user by
  email answer) now?
- **OQ-6 — Where the apply/preview UI lives.** Mapping *config* clearly belongs on
  the definition editor. Apply/preview could live on the admin submission detail
  (proposed) or a dedicated review queue. Confirm the placement.
- **OQ-7 — Registry extraction (leverage).** The destination registry is the second
  instance of the "typed keyed provider registry" pattern in service-requests.
  Extract a generic `createProviderRegistry<T>()` now, or wait for a third instance?
  Proposed: wait (drop a `// LEVERAGE:` marker).
- **OQ-8 — Rebranch vs. merge.** Given this branch is ~1375 commits behind, do you
  prefer merging `origin/main` in, or recutting the feature branch from current
  `origin/main`? (Recut is cleaner history; merge preserves the branch name the
  board tracks.)
</content>
</invoke>
