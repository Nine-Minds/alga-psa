# Custom Asset Types

Each tenant has a registry of asset types. Six are built in (workstation,
network device, server, mobile device, printer, unknown). A tenant can also
define its own types — "Door Access", "API Secrets", "Licenses" — and give each
one a set of custom fields. An asset's `asset_type` column holds a type's slug,
and the registry is the source of truth for which slugs are valid.

This page maps where custom asset types live and how they flow through the app.

## The registry table

Custom types live in `asset_type_registry`, created by
`server/migrations/20260612120000_create_asset_type_registry.cjs`.

```sql
CREATE TABLE asset_type_registry (
    tenant         UUID NOT NULL REFERENCES tenants(tenant),
    type_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    slug           TEXT NOT NULL,            -- stored in assets.asset_type
    name           TEXT NOT NULL,            -- display label
    icon           TEXT,                     -- IconPicker value, nullable
    fields_schema  JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_builtin     BOOLEAN NOT NULL DEFAULT false,
    display_order  INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant, type_id),
    UNIQUE (tenant, slug)                    -- asset_type_registry_tenant_slug_uk
);
```

The table is a Citus distributed table colocated with `assets`. It has no RLS;
tenant isolation comes from scoped queries and the Citus distribution, matching
the post-`20260509120000` architecture.

`assets.asset_type` is a plain `TEXT` column that holds the slug. There is no
foreign key from `assets` to `asset_type_registry`. The registry is enforced in
the application layer, not by the database. The same migration drops the legacy
`valid_asset_type` CHECK constraint, which only permitted the six built-in slugs
and rejected every custom type. If you read older migrations, treat that
constraint as removed.

## Built-in versus custom types

The six built-in slugs are reserved (`RESERVED_ASSET_TYPE_SLUGS` in
`packages/assets/src/lib/assetTypeRegistry.ts`). They are seeded with
`is_builtin: true` in two places:

- The migration seeds them for every tenant that exists when it runs.
- `ee/server/seeds/onboarding/psa/09_asset_type_registry.cjs` seeds them for each
  new tenant during onboarding.

Both insert the same six slugs with `onConflict(['tenant', 'slug']).ignore()`, so
re-running either is safe. A tenant created after the migration still gets its
built-ins from the onboarding seed.

Built-in types accept only `name` and `icon` edits. Changing their
`fields_schema` or `display_order` returns `builtin_immutable`, and they cannot
be deleted (`builtin_undeletable`).

## Slugs

`generateAssetTypeSlug(name)` derives a slug from a type's name: lowercase,
non-alphanumeric runs become `_`, repeats collapse, and leading and trailing
underscores are trimmed.

A slug must start with a letter. A name that would otherwise start with a digit
gets a `t_` prefix, so "3CX Phone System" becomes `t_3cx_phone_system`. This
keeps every slug matching `/^[a-z][a-z0-9_]*$/`, which the Hudu layout map
requires. Without the prefix, a digit-leading slug is silently coerced to
`unknown` when you assign it to a layout.

`createAssetType` rejects a name that produces no slug (`invalid_name`), a slug
that collides with a built-in (`reserved_slug`), and a slug already used by the
tenant (`slug_conflict`). The conflict check runs both before the insert and on a
`23505` unique violation, so a race still returns `slug_conflict`.

## Field schemas and custom attributes

A custom type's `fields_schema` is a JSON array of field definitions:

```json
[
  { "key": "badge_system", "label": "Badge System", "kind": "text" },
  { "key": "expires_on",   "label": "Expires On",   "kind": "date", "required": true },
  { "key": "tier",         "label": "Tier",          "kind": "select", "options": ["Gold", "Silver"] }
]
```

`validateFieldsSchema` enforces the shape:

- `key` matches `/^[a-z][a-z0-9_]{0,62}$/` and is unique within the schema.
- `kind` is one of `text`, `number`, `date`, `select`, `url`, `boolean`.
- A `select` field needs a non-empty `options` array of non-empty strings. Other
  kinds must not declare `options`.
- `label` is required. `required` must be a boolean when present.

A custom-type asset stores its field values in the `assets.attributes` JSONB
column, keyed by the field `key`. Built-in types do not define a `fields_schema`;
they keep their dedicated extension tables (`workstation_assets`,
`network_device_assets`, and so on). The `attributes` column still holds
integration data such as `hudu_fields` on any asset, built-in or custom.

## Creating, editing, and deleting types

The registry model functions live in
`packages/assets/src/lib/assetTypeRegistry.ts` (`listAssetTypes`,
`createAssetType`, `updateAssetType`, `deleteAssetType`). The RBAC-wrapped server
actions in `packages/assets/src/actions/assetTypeRegistryActions.ts` reuse the
`asset` resource: `read` for listing and reading, `update` for create, update,
and delete. The "Asset Types" settings manager and its schema editor call these
actions.

Deleting a custom type that assets still reference is blocked. `deleteAssetType`
counts `assets` rows with that slug and returns `in_use` with the count when any
exist.

## Where an asset type is validated

When you write an asset, `createAsset` resolves the type through
`resolveWritableAssetType` (`packages/assets/src/actions/assetActions.ts`):

- A built-in slug passes without schema validation.
- A custom slug must exist in the tenant's registry, or the write throws
  `invalidAssetTypeError`. Its `attributes` are then checked against the type's
  `fields_schema` by `validateAttributesAgainstSchema`.

`createAsset(data, { requireCustomAttributes })` controls required-field
strictness. It defaults to `true` for the asset form. Importers pass `false` so a
required field the source did not supply is skipped rather than failing the
write.

Every write path accepts any registry slug, not a fixed list. When you add a new
one, keep it that way:

- Server actions `createAsset` / `updateAsset` — registry-validated.
- REST API v1 (`/api/v1/assets`) — `assetTypeSchema` in
  `server/src/lib/api/schemas/asset.ts` and the OpenAPI `AssetType` are open
  strings.
- CSV / spreadsheet import — `server/src/lib/imports/assetFieldDefinitions.ts`
  bounds length only; the registry is enforced downstream in `createAsset`.
- Inbound webhooks — `upsertAssetByExternalId` in
  `packages/assets/src/actions/inboundActions.ts` takes a string `asset_type`.

## Hudu import

Hudu has no notion of typed assets; it has asset layouts. The integration maps
each Hudu layout to an Alga asset type. The map is a per-tenant
`asset_layout_type_map` stored in the Hudu integration `settings` JSONB
(`ee/server/src/lib/integrations/hudu/assetLayoutMap.ts`). Each entry points a
layout id at a registry slug, or at the sentinel `excluded` to skip that layout
("Don't import").

`resolveAssetTypeForLayout` returns a layout's mapped slug only when that slug is
still in the tenant's registry; otherwise it falls back to `unknown`.

You can create a type straight from a layout. `createAssetTypeFromHuduLayout`
(`ee/server/src/lib/actions/integrations/huduLayoutMapActions.ts`) builds a custom
type whose `fields_schema` is derived from the layout's fields, then assigns the
layout to the new type.

On import (`ee/server/src/lib/actions/integrations/huduAssetImportActions.ts`),
`projectHuduFieldsOntoSchema` maps the Hudu field values onto the custom type's
`fields_schema` keys. The raw Hudu fields are also stored under
`attributes.hudu_fields`, with `attributes.hudu_synced_at`. A required field
missing from Hudu does not fail the import; it is skipped and the raw value stays
in `hudu_fields`.

## Display

Lists, the detail page, the detail drawer, and the associated-assets panel look
up a custom type's `icon` from the registry through `getIconComponent`, falling
back to a generic icon. The detail surfaces render a custom type's field values
with `CustomTypeDetailsPanel`. Built-in types keep their fixed lucide icons and
type-specific panels.

## Related topics

- [Asset Management System](./asset_management.md) — the broader asset model,
  relationships, maintenance, and history.
- [Hudu Integration](../integrations/hudu.md) — connecting Hudu and the layout
  mapping that drives asset import.
- [Citus migration best practices](../architecture/citus-migration-best-practices.md)
  — the distributed-table pattern the registry follows.
