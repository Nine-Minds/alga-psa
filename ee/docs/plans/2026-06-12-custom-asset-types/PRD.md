# Custom Asset Types (Alga-core)

- Status: Approved (decisions by Natallia 2026-06-12: schema-driven forms;
  surfaces = asset module + dashboards/reports; RBAC = asset.update)
- Scope: AlgaPSA core asset module (CE), with an EE tie-in to the Hudu layout map
- Related: Hudu Phase 2/2.1 plans (layout→type mapping motivated this)

## Problem

AlgaPSA assets have six hardcoded types (`workstation, network_device,
server, mobile_device, printer, unknown`), each backed by a dedicated
extension table and bespoke form panels. MSPs document far more kinds of
records (Hudu's default layouts alone: API Secrets, AD/Identity,
Applications, Backup, Cloud Accounts, Databases, Door Access, Email, File
Sharing…). Everything that isn't one of the six collapses into `unknown`,
losing categorization, filtering, and meaningful fields.

NOTE (verified 2026-06-12): the original 2024 migration created a
tenant-scoped `asset_types` table with `attributes_schema` jsonb, but it was
**dropped** in a later migration; live schema is `assets.asset_type` text +
five extension tables + an `attributes` jsonb on assets. Custom types means
reintroducing a registry, not reviving dormant code.

## Proposed direction

- Reintroduce tenant-scoped `asset_type_registry` (name, slug, icon/color,
  `fields_schema` jsonb, is_builtin, ordering). Seed the six built-ins per
  tenant; built-ins keep their extension tables and existing UI panels.
- Custom-type assets store their typed fields in the existing
  `assets.attributes` jsonb, with create/edit forms rendered from
  `fields_schema` (text/number/date/select/url/boolean field kinds).
- `assets.asset_type` keeps holding the slug (no FK break for existing
  data); list/filter/dashboard surfaces read the registry for labels/icons.
- Settings → Asset Types: CRUD for custom types + schema editor; built-ins
  read-only (rename/icon allowed, schema fixed).
- Hudu tie-in (EE): layout map gains "Create type from this layout" —
  generates a custom type whose fields_schema mirrors the Hudu layout's
  fields; imports then land hudu fields into the schema-matched attributes.

## Decisions (2026-06-12)

- D1 (was OQ1). **Schema-driven forms**: custom types carry a `fields_schema`
  (field kinds: text, number, date, select, url, boolean; each {key, label,
  kind, required?, options?}); asset create/edit renders the schema panel,
  values stored in `assets.attributes[key]`.
- D2 (was OQ2). Surfaces: **asset module** (list, filters, detail,
  create/edit, type management) **+ dashboards/reports** (by-type breakdowns
  read the registry). Ticket pickers untouched this plan.
- D3 (was OQ3). Type management RBAC = **asset.update** (no new resource).
- D4 (was OQ4, defaulted). Forward-only: no bulk re-type tool this plan;
  individual assets can change type via the normal edit form (attributes
  values are kept; fields not in the new schema simply stop rendering).

## Data model & constraints

- New tenant table `asset_type_registry` (tenant uuid, type_id uuid, slug
  text, name, icon, fields_schema jsonb, is_builtin bool, display_order int,
  timestamps; unique (tenant, slug)). CE migration in `server/migrations`
  following the greenfield-Citus pattern (tenant column first, distribute
  inline behind isCitusEnabled, transaction:false — asset_facts template);
  no RLS — 20260509120000_disable_remaining_rls_policies dropped policies
  schema-wide (pooled connections never set app.current_tenant); isolation
  is app-layer scoped queries + Citus distribution (corrected 2026-06-12,
  originally planned "RLS like sibling tables").
- Seeding: migration seeds the six built-ins for EXISTING tenants AND the
  tenant-onboarding path seeds them for FUTURE tenants (lesson learned from
  standard_statuses: tenant-loop migrations silently skip tenants created
  later — both paths are mandatory).
- `assets.asset_type` keeps holding the slug; built-ins keep extension
  tables + bespoke panels untouched. Custom slugs must not collide with the
  six reserved slugs or 'unknown'.
- Deleting a custom type is blocked while any asset uses its slug.

## Hudu tie-in (EE)

- Layout map's type select sources the registry (built-ins + custom).
- "Create type from this layout": fetches the layout's field definitions
  (GET /api/v1/asset_layouts/{id} — verify field-kind mapping on the local
  instance), generates slug/name/fields_schema, stores the layout→new-type
  assignment in one step.
- Import: when the target type is custom, project Hudu field values onto
  matching schema keys (by normalized label) in addition to the
  `hudu_fields` namespace.

## Definition of done

- Tenant admins (asset.update) manage custom types incl. schema editor;
  assets create/edit/list/filter/detail render custom types first-class;
  dashboards/reports break down by them; Hudu layout map targets and
  generates them; the six built-ins behave exactly as before; new-tenant
  seeding covered; full asset + hudu suites green.
