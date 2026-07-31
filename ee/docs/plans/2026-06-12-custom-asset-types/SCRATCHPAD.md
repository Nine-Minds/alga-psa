# Scratchpad — Custom Asset Types

- 2026-06-12: decisions captured (schema forms; asset module + dashboards/reports; asset.update RBAC; forward-only re-typing).
- VERIFIED: original asset_types table was DROPPED; live = assets.asset_type text + 5 extension tables + attributes jsonb. Registry is a reintroduction.
- Citus: follow greenfield pattern (memory/docs) — CE migration, tenant uuid first, distribute inline isCitusEnabled, transaction:false, asset_facts template.
- Seeding BOTH paths: migration loop for existing tenants + onboarding seed for future (standard_statuses gap lesson).
- Hudu tie-in: GET /api/v1/asset_layouts/{id} field definitions — verify field-kind mapping on hudu.localtest.me before F316.
- VERIFIED layout field defs (GET /api/v1/asset_layouts/7): fields[] carry
  {label, field_type, required, position, options}. Hudu field_type values
  seen: Text, RichText, ListSelect, AddressData (others exist: Number, Date,
  CheckBox, Website per Hudu docs). Mapping for create-from-layout:
  Text/RichText/AddressData→text, Number→number, Date→date,
  ListSelect→select (options parsed from the options string), CheckBox→
  boolean, Website→url; unknown kinds→text. required may be null → false.
- 2026-06-12 RLS REMOVED from the migration (user call: "we dropped those a
  while ago" — 20260509120000_disable_remaining_rls_policies drops every
  policy + disables RLS schema-wide because pooled connections never set
  app.current_tenant; hudu_integrations/asset_facts precedent = no RLS on
  new tables). Migration edited in place (committed version had RLS),
  contract + integration tests now pin the ABSENCE; dev DB 5433 drift
  hand-fixed (DROP POLICY ×2 + DISABLE RLS, data kept).
- 2026-06-12 T323 BEHAVIORAL CITUS SMOKE PASSED on the no-RLS migration
  (citus-smoke container, citus 12.1 single-node @ localhost:5599, the
  818-migration sandbox from the 2026-06-11 validation; password reset to
  citus_test). down()+up() cycle on the distributed table, then asserted:
  distributed 'h' on tenant, colocated with assets (group 1), RLS off on
  shell AND all 4 shards (run_command_on_shards — shard catalogs are hidden
  from plain pg_class queries), six built-ins seeded per pre-existing tenant
  (two tenants tested), coordinator shell heap 0 bytes, up() re-run no-op,
  (tenant,slug) unique raises 23505 through the distributed index,
  tenant-scoped non-superuser (app_user) read returns the seeded six.
  Migration registered in the sandbox's knex_migrations (batch 2). Smoke
  script: /tmp/citus-registry-smoke.cjs (session-local).
- T322 triage (2026-06-12): every failure outside this plan's surface is
  PRE-EXISTING at merge-base 1f37bd46df — ee/server 45 fails =
  Entra/Temporal/NinjaOne/Stripe/SSO/Tanium/portal-domain;
  packages/assets 4 fails = 3 stale source-pins (assetAuthorization T017/18,
  QuickAddAsset T026 — pinned lines already drifted on main) + T033
  CreateTicketFromAssetButton (component+context untouched by branch);
  server i18n 8 fails = core/dashboard/admin/ROUTE_NAMESPACES namespaces.
  The asset-locale batch test (T020/T042) FAILS at HEAD and PASSES with the
  i18n-types working-tree changes — that commitGroup is what fixes it.
- huduAssetMappingActions T214 only fails on the default DB port: host 5432
  is sebastian_postgres (another worktree); bigmac's DB is 5433. Green with
  DB_HOST=localhost DB_PORT=5433.
