# Plan: map asset CSV columns to custom asset-type fields (alga-2026-0002567)

Branch `feature/alga-2026-0002567-asset-csv-import-map-columns-t`, worktree at `9fd1ddb58b` (the card was validated at `636c648b53`; nothing relevant changed in between).

## Problem

A user asked in Discord #alga-support: "Is there an Import for Custom Assets?" Settings → Imports & Exports (`MigrationsWorkspace`) does accept an asset CSV/XLSX. But only the standard AMP asset columns are recognized: `name`, `asset_type_name`, `serial_number`, `manufacturer`, `model`, `purchase_date`, plus the identity and reference columns.

Every other column (RAM, Door Controller ID, Warranty Tier…) ends up in `extension_json`, and the upload only reports it with a `CSV_UNMAPPED_COLUMN` info message. The applier never reads it. As a result, an asset imported into a custom type (`asset_type_registry.fields_schema`) always arrives with empty custom fields.

## How it works today (verified)

| Stage | Where | What it does |
|---|---|---|
| Header inference | `packages/migration-connectors/src/csv/mapping.ts:83-101` | Headers are matched against `AMP_TABLE_COLUMNS[entity]` plus aliases. Anything else is left unmapped. |
| Row build | `packages/migration-connectors/src/csv/engine.ts:158-170` (diagnostic), `:205-209` (leftover), `:308-320` (`extension_json`, 16 KiB cap per row, and the **whole leftover set is dropped** if it goes over) | Unmapped cells become `extension_json`. |
| Spec | `packages/migration-spec/src/tables.ts:18-22, 124-130` | AMP already has a `custom_field_values` auxiliary table (`entity_type`, `entity_package_record_id`, `field_name`, `value_json`). **No producer writes it and no consumer reads it.** The spec plan (`docs/plans/2026-08-25-alga-migration-package-amp-plan.md:327-330`) says `extension_json` is "preserved non-canonical source data that Alga never interprets automatically". |
| Validation | `packages/migration-sdk/src/validator.ts:435-494` | For aux rows, it checks that the entity reference resolves and that the value is under 16 KiB. It does not check for duplicate fields per entity or that `value_json` parses. |
| Upload | `server/src/app/api/migrations/spreadsheet/route.ts:50-54` | `inferSpreadsheetMapping` → `convertSpreadsheets` → `MigrationStager.stage`. |
| Staging | `server/src/lib/migrations/MigrationStager.ts:100-148` | Stages only `AMP_ENTITY_TABLES` rows into `migration_staged_records.payload`. Aux tables are ignored. |
| Configure options | `server/src/lib/migrations/migrationActions.ts:74-85, 114-146` | `assetTypes` is `{slug,name}` only (`:123`), without `fields_schema`. |
| Configure UI | `server/src/components/settings/migrations/MigrationConfigurePanel.tsx:255-269` | Has the asset type `MappingGrid` only. |
| Config type | `server/src/lib/migrations/types.ts:34-37` | `AssetMigrationConfiguration { assetTypeMapping }`. |
| Preflight | `server/src/lib/migrations/MigrationPlanner.ts:230-269` | Only blocks unmapped source type names. It never checks that a mapped **target slug** exists. |
| Apply | `server/src/lib/migrations/appliers/entityAppliers.ts:360-432`; driver `MigrationDomainApplier.ts:107-133` | Sets `attributes = {manufacturer, model}` and passes `requireCustomAttributes: false`. |
| Asset core | `packages/assets/src/actions/assetActions.ts:874-895` (validation), `:601-615` (`resolveWritableAssetType`) | Validates against `fields_schema` using `validateAttributesAgainstSchema` (`packages/assets/src/lib/assetTypeAttributes.ts:66-97`). That check is strict on types: number must be a `number`, boolean a `boolean`, select an exact option. So raw CSV strings **must be coerced** before the write. |
| Field model | `packages/types/src/interfaces/asset.interfaces.ts:590-598` | `AssetTypeField {key,label,kind,required?,options?}`, where kind is one of text, number, date, select, url, boolean. The values go in `assets.attributes[key]`. The UI stores dates as `YYYY-MM-DD` (`packages/assets/src/components/shared/CustomTypeFieldsPanel.tsx:57`). |

## Design

**One principle: the package carries source field values, and Alga maps them to tenant fields at configure time.** The converter has no tenant context, and custom fields belong to the *target* type, so the mapping cannot happen in the CSV adapter.

1. **Converter:** unrecognized columns become AMP `custom_field_values` rows instead of `extension_json`. That table is the spec's channel for custom fields, it has a 16 KiB limit per value rather than per row, and it works for any producer. A future ConnectWise "configuration questions" export, or an Alga→Alga export, would feed the same mapping UI.
2. **Staging:** each record's custom field values are folded into a new `migration_staged_records.custom_field_values jsonb` column, as a `{field_name: value}` map.
3. **Configure:** for each *target* custom type that has at least one mapped source type, the operator maps source field names to that type's field keys. Rows are pre-filled where names match.
4. **Preflight:** checks the mapping against the registry and coerces every mapped value. Records with values that can't be coerced are blocked, with the reason attached.
5. **Apply:** coerces with the same function, then merges the result into `attributes`.

**Configuration shape** (`server/src/lib/migrations/types.ts:34-37`):

```ts
export interface AssetMigrationConfiguration {
  assetTypeMapping: Record<string, string>;
  /** Target custom asset-type slug → source custom field name → target field key. */
  customFieldMapping?: Record<string, Record<string, string>>;
}
```

The mapping is keyed by *target slug*, not source type name, for two reasons: fields belong to the target type, and several source names ("Door", "Door Access") can map to one slug and should share one field mapping.

**Veto point for the captain:** step 1 applies to *every* entity type's CSV, not only assets. That keeps a single rule in the engine instead of an asset special case. Nothing reads CSV `extension_json` leftovers today; `readCarriedClientName` reads only the reserved `__contact_client_name` key, which stays in `extension_json`. The alternative is to scope step 1 to assets. That works too, but it leaves two meanings for "an unrecognized column".

## Work, in order

### 1. Shared value coercion (packages/assets)

- In `packages/assets/src/lib/assetTypeAttributes.ts` (it imports only types, so it is safe on client and server), add `coerceAttributeValue(field: AssetTypeField, raw: unknown): { ok: true; value: unknown } | { ok: false; reason: string }`. Empty or whitespace input is treated as absent by the caller. Rules:
  - `text`: trimmed string; numbers and booleans are converted with `String()`.
  - `url`: trimmed string. Don't be stricter than `isValidValueForField` (`:38-54`).
  - `number`: a finite `number`, or a string matching `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`. Reject locale forms like `1,234` or `1.234,5` (AMP value rules: no locale-dependent numbers).
  - `date`: `YYYY-MM-DD` that is a real calendar date. An RFC 3339 timestamp is reduced to its UTC date. **XLSX date cells arrive as `…T00:00:00Z`** (`packages/migration-connectors/src/csv/parse.ts:79-84`).
  - `select`: exact option match first, then a unique trimmed, case-insensitive match that returns the *canonical* option. Anything else fails.
  - `boolean`: a boolean, `1`/`0`, or the strings true/false, yes/no, y/n, t/f, 1/0, on/off.
- Export it from wherever `validateAttributesAgainstSchema` is exported today.
- EE Hudu has a best-effort coercer that passes values through (`ee/server/src/lib/integrations/hudu/layoutFieldSchema.ts:129`). Its semantics differ (bad values pass through, then validation drops them), so leave it alone. Add `// LEVERAGE: pattern asset-attribute-coercion — …` at both sites.
- Add a unit test file for coercion next to the existing assets lib tests, covering every kind with valid, invalid and edge inputs.

### 2. Spec and validator rules for `custom_field_values` (packages/migration-sdk)

In `validateAuxiliaryTables` (`validator.ts:435-494`), for `custom_field_values`:
- `value_json` must parse as JSON and stay within `extensionJsonDepth`. Otherwise report `AMP_INVALID_VALUE` with field `value_json`.
- `(entity_type, entity_package_record_id, field_name)` must be unique. Otherwise report `AMP_INVALID_VALUE` with field `field_name` and a message naming the duplicate. Track this in a `Set` of joined keys.

Add cases to `packages/migration-sdk/tests/package.test.ts` (or `security.test.ts` for the depth rule).

### 3. Converter emits `custom_field_values` (packages/migration-connectors)

- `engine.ts`:
  - `BuiltEntityRows` gains `customFieldValues: AmpCustomFieldValueRecord[]`.
  - In the row loop (`:202-209`), collect unmapped values in a `Map<string,string>` rather than the `leftover` object. Header text is arbitrary, and a `__proto__` header must not touch a prototype.
  - Only once a record is **accepted** (after the required-column and duplicate checks, `:284-305`), emit one `custom_field_values` row per non-empty unmapped cell: `package_record_id: cfv-<n>` (a sequential counter, which keeps it deterministic and well under `opaqueIdBytes`; an id built from the entity id plus the header could go over 256 bytes), `entity_type`, `entity_package_record_id`, `field_name: header`, `value_json: JSON.stringify(value)`. Skipped rows must emit nothing, or the validator raises `AMP_INVALID_REFERENCE`.
  - If one value's JSON is over `AMP_LIMITS.extensionJsonBytes`, emit a warning `CSV_CUSTOM_FIELD_TOO_LARGE` and drop only that value.
  - `extension_json` now holds only engine-reserved keys (the contact client name, `:273-275`). Keep the existing size guard for it.
  - Update the `CSV_UNMAPPED_COLUMN` message (`:167`) to say the column was preserved as a custom field value and can be mapped to an asset-type field during configuration.
- `convert.ts:552-555`: add `custom_field_values` to `rows`.
- Tests:
  - Update `packages/migration-connectors/tests/csv.test.ts:100,136,141,203` and `contactsMapping.test.ts:118,144-147` to expect `custom_field_values` rows instead of `extension_json` leftovers.
  - Add cases:
    - A skipped row emits no custom field rows.
    - An oversized single value is dropped with a diagnostic while the other values are kept.
    - A `__proto__` header is carried as an ordinary field name.
    - An XLSX date cell arrives as RFC 3339.
    - The output package validates.

### 4. Stage custom field values (server)

- New migration `server/migrations/<timestamp-at-implementation>_add_custom_field_values_to_migration_staged_records.cjs`. It runs `ALTER TABLE migration_staged_records ADD COLUMN IF NOT EXISTS custom_field_values jsonb NOT NULL DEFAULT '{}'`, with an idempotent `down`. Check whether `server/src/test/unit/migrations/` expects a contract test for AMP tables, and add a small one if so.
- `MigrationStager.stage` (`:85-161`): inside the same transaction, after the entity loop, iterate `reader.readRows('custom_field_values', STAGING_BATCH_SIZE)`.
  - Group each batch by `(entity_type, entity_package_record_id)` into `{field_name: JSON.parse(value_json)}`.
  - Apply it with one `UPDATE migration_staged_records AS s SET custom_field_values = s.custom_field_values || v.fields FROM (VALUES …) v(entity_type, package_record_id, fields) WHERE s.tenant = ? AND s.migration_job_id = ? AND s.entity_type = v.entity_type AND s.package_record_id = v.package_record_id`, through `tenantDb`/knex raw bindings.
  - The validator (step 2) already guarantees no duplicates, so the `||` merge is exact.
  - Restage already deletes and re-inserts the rows (`:97`), so it stays idempotent.

### 5. Configuration options (server)

- `MigrationConfigurationOptions` (`migrationActions.ts:74-85`):
  - `assetTypes` becomes `Array<{ slug; name; isBuiltin: boolean; fields: AssetTypeField[] }>`. Select `fields_schema` and `is_builtin` at `:123` and parse them. Better still, call `listAssetTypes(knex, tenant)` (`packages/assets/src/lib/assetTypeRegistry.ts:98`), which already parses and orders them.
  - Add `packageAssetCustomFields: Array<{ assetTypeName: string; fieldName: string; sampleValue: string | null; recordCount: number }>`. Get it with one SQL over staged assets: `payload->>'asset_type_name'`, `jsonb_each(custom_field_values)`, grouped, with `min(value)` as the sample.

### 6. Preflight (server)

Extend `checkAssetConfiguration` (`MigrationPlanner.ts:230-269`):

- **`CONFIG_ASSET_TYPE_NOT_FOUND`** (blocking): a mapped target slug is not in the registry. This closes an existing gap; today the failure only surfaces at apply time as `invalid_asset_type`.
- **`CONFIG_ASSET_FIELD_MAPPING_INVALID`** (blocking), in any of these cases:
  - a `customFieldMapping` slug that is not a custom type,
  - a slug with no source type mapped to it,
  - a target key not in its `fields_schema`,
  - two source fields mapped to the same key.
- **`ASSET_CUSTOM_FIELD_INVALID`** (blocking, per record):
  - Keyset-page through valid staged assets (the pattern from `MigrationDomainApplier.ts:89-100`) whose mapped slug has a field mapping, and run `coerceAttributeValue` on each mapped value.
  - Collect failures, then run `blockRecords` by `package_record_id IN (…)`. Each record's reason names the field, the value and the expected kind, e.g. `"RAM" value "16 GB" is not a number`.
  - The issue summary lists the first 10 offenders.
  - The operator's options are to fix the source or unmap the field.
- **`ASSET_CUSTOM_FIELD_REQUIRED_MISSING`** (warning): the number of records of a type whose required fields are unmapped or empty. They still import, because `requireCustomAttributes: false` stays, and users fill the fields when they next edit the asset.
- Mapped source fields that are absent from staged data are ignored.

### 7. Apply (server)

- `EntityApplier.apply` (`entityAppliers.ts:26-34`) gets a fourth argument, `staged: { customFieldValues: Record<string, unknown> }`. `MigrationDomainApplier.ts:133` passes `staged.custom_field_values` (parse it when it is a string, as `:110-111` does for `payload`). The other appliers ignore it.
- `ApplierContext` (`appliers/context.ts`) gets `assetTypeFields(trx, slug)`, backed by `getAssetTypeBySlug` and cached per run the same way as `referenceCache`.
- `AssetMigrationApplier` (`:360-432`):
  - For the mapped slug's `customFieldMapping`, coerce each mapped value.
  - A failure **throws** with the field and value. Preflight should already have blocked it, and this matches the applier's existing fail-fast checks such as "preflight must pass".
  - Build the attributes as `{ manufacturer?, model?, ...customAttributes }`. An explicit custom mapping to a key named `manufacturer` or `model` wins over the implicit AMP column.
  - Keep `requireCustomAttributes: false`.

### 8. Configure UI (server)

- `MigrationConfigurePanel.tsx`:
  - Add state `customFieldMapping` and seed it from `configuration.assets?.customFieldMapping` (`:66`).
  - Below the asset-type grid (`:255-269`), for each distinct target slug in `assetTypeMapping` whose type is custom with a non-empty `fields`, render a block titled "Fields for <type name>":
    - One row per source field name from `packageAssetCustomFields`, taken from every source type mapped to that slug.
    - The row shows the sample value and record count.
    - Each row has a `CustomSelect` of that type's fields, labelled "Label · kind · required", with `allowClear` ("Don't import").
    - Element ids follow the pattern `amp-config-asset-fields-${slug}-${index}-select`.
  - Pre-fill: when the saved config has no entry for a slug, auto-match a source name to a field when either the normalized `key` or the normalized `label` equals the normalized source name. Normalize like `normalizeHeader`: lowercase, collapse spaces, `_` and `-`.
  - Show inline hints:
    - required fields that nothing maps to,
    - a duplicate target key, which also disables Save.
  - Include `customFieldMapping` in the save payload (`:136`), pruned to slugs that are still mapped.
  - Extend `MappingGrid` (`:309-366`) with optional `allowClear` and a per-row `detail`. Don't fork it.
  - Strings stay literal to match the file's convention; it imports `t` but uses literal strings throughout.
- `MigrationJobsHome.tsx:325`: in the spreadsheet help text, add that other columns can be mapped to custom asset-type fields in the Configure step.

### 9. Integration test (server)

Extend `server/src/test/integration/ampMigrationPipeline.integration.test.ts` (the existing asset CSV case is at `:467`, the options case at `:443`):
- Create a custom type "Door Access" with these fields:
  - `controller_id` (text, required)
  - `door_count` (number)
  - `installed_on` (date)
  - `tier` (select Gold/Silver)
  - `monitored` (boolean)
- Take a CSV with `Asset Name, Asset Type, Controller ID, Door Count, Installed On, Tier, Monitored, Notes` through the spreadsheet route path, then check:
  - Options expose the fields and source names.
  - Saving the mapping gives a `ready` preflight.
  - After apply, `assets.attributes` holds `{controller_id:"C-1", door_count:4, installed_on:"2026-01-05", tier:"Gold", monitored:true}`, and `Notes` is not in attributes.
  - A row with `Door Count = "four"` is blocked with `ASSET_CUSTOM_FIELD_INVALID`.
  - A mapping to a missing key gives `CONFIG_ASSET_FIELD_MAPPING_INVALID`.
  - A target slug that isn't registered gives `CONFIG_ASSET_TYPE_NOT_FOUND`.
  - Re-running creates no duplicates.
  - The `tier` value `"gold"` resolves to `"Gold"`.

### 10. Verification

- `npx vitest run` in `packages/migration-connectors`, `packages/migration-sdk` and `packages/assets` (the coercion tests).
- The server integration test above, run through the `integration-testing` skill's DB bootstrap.
- Typecheck the touched packages and `server` (`npx tsc --noEmit -p <pkg>`), and lint the changed files.
- Manual smoke test on the wired dev server (port 3109, stack `alga-psa-local-test`):
  1. Settings → Assets: create the "Door Access" type.
  2. Settings → Imports & Exports: upload the CSV as Assets.
  3. Configure: map the type, confirm the fields are pre-filled, save.
  4. Preflight: ready, or a blocked row that names the bad value.
  5. Run the job.
  6. Open the asset: `CustomTypeDetailsPanel` shows the values, and the edit form (`CustomTypeFieldsPanel`) loads them as typed values (date picker, checkbox, select).
  7. Check the Configure panel in light and dark themes.

## Deliberately out of scope

- **Built-in type extension-table fields** (`workstation_assets.os_type`, RAM, and so on). The same mapping mechanism could target them later, but they live in separate tables with their own schemas.
- **Creating custom asset types or fields from a CSV.** The operator defines the type first, in Settings → Assets.
- **Updating existing assets on re-import.** Identity-mapped records are still skipped (`MigrationDomainApplier.ts:118-129`).
- **Saving mappings as reusable profiles.** `migration_mapping_profiles` exists but is unused. This would be a good follow-up.
- **Export round trip.** `AmpExportService.exportAssets` (`server/src/lib/migrations/AmpExportService.ts:309-345`) emits only manufacturer and model. Having it emit custom attributes as `custom_field_values` would give Alga→Alga moves the same mapping. Follow-up card.
- **`/msp/assets/imports`** (`server/src/app/msp/assets/imports/page.tsx`) stays a `FeaturePlaceholder`. It could link to Settings → Imports & Exports; that is a product decision, not part of this card.
- **The legacy `server/src/lib/imports` / `assetImportHandler` path.** The UI doesn't reach it, since the settings page renders only `MigrationsWorkspace`. Found in passing: `server/src/lib/jobs/handlers/assetImportHandler.ts:217` ignores the `AssetActionError` returned by `createAsset`. Worth a separate bug card.
- **Mapping custom fields for non-asset entities.** Their values are carried in the package but not applied; Alga has no target for them.

## Risks and gotchas

- **Behaviour change for every CSV entity.** Unrecognized columns move from `extension_json` to `custom_field_values` (see the veto point). Packages built by the old converter stay valid; their leftovers are simply never mapped.
- **Aux rows are outside the row limits.** `rowsPerEntity` and `rowsPerPackage` count entity tables only (`validator.ts:223,253`), so a 50-column × 20k-row sheet produces 1M `custom_field_values` rows. Staging runs one batched `UPDATE … FROM (VALUES …)` per 500 aux rows, inside a single transaction. Measure staging time on a large fixture. On Citus, confirm the tenant-filtered `UPDATE … FROM VALUES` routes to a single shard. If not, fall back to per-entity-record updates within the batch.
- **Skipped rows must emit no aux rows**, or the package fails validation with `AMP_INVALID_REFERENCE`.
- **Coercion must be one function**, used by both preflight and apply. Otherwise preflight can say ready while apply fails.
- **XLSX dates** arrive as RFC 3339 and must reduce to `YYYY-MM-DD`. Locale numbers are rejected on purpose, not guessed.
- **Header text is untrusted.** Use `Map`/`Object.hasOwn`, never bare `{}` lookups, for field names such as `__proto__` or `constructor`.
- **Config staleness.** A type's `fields_schema` can change between save and preflight. Preflight re-reads the registry each time, and apply re-reads it through the cache on `ApplierContext`, so a removed key blocks at preflight rather than being written.
- **`saveMigrationConfiguration`** (`migrationActions.ts:162-187`) doesn't validate shape. Keep all validation in preflight, which is the existing contract, so a hand-edited config can't get past it.
