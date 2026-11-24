# SCRATCHPAD — Client Portal Notices

## Discoveries (2026-11-12)

- No MSP-authored banner/notice exists in the client portal. Only `StaleActionBanner` (`packages/ui/src/components/StaleActionBanner.tsx`), rendered at the bottom of the header in `packages/client-portal/src/components/layout/ClientPortalTopBar.tsx`. It already uses the standard `Alert` (warning variant, `rounded-none border-x-0`); copy that shape.
- Dashboard greeting is the fixed string `dashboard.welcomeBack` in `ClientDashboard.tsx`; branding settings (logo, colors) are in `server/src/components/settings/general/ClientPortalSettings.tsx`. This is the natural home for the authoring UI.
- Portal layout is server-side: `server/src/app/client-portal/layout.tsx` resolves session, branding, locale, currency, and portal feature settings, then hands them to `ClientPortalLayoutClient`. Active notices should be loaded here in one query and passed down, not fetched client-side per page.
- Existing portal settings action pattern: `packages/client-portal/src/actions/client-portal-actions/clientPortalFeatureSettingsActions.ts` — `withAuth`, `hasPermission(user, 'settings', 'update', knex)`, `permissionError(...)`, `tenantDb(knex, tenant)`. Copy it for write actions. Those settings live in `tenant_settings.settings.clientPortal` (JSON); notices need real tables because of audience, schedule, and per-user dismissal.
- Migrations: new tenant-scoped tables use `server/migrations/utils/citusDistribution.cjs` (`ensureTenantDistribution`) — see `ee/server/migrations/20261105100000_create_service_principals_schema.cjs` for house style (idempotent, no DB-level relation constraints, no `now()` in CASE/COALESCE, `transaction: false` when distributing).
- Client tags: tag mappings live in `packages/tags`; clients are tagged with `tagged_type = 'client'`. Audience-by-tag must join through that mapping at read time.
- Locales: portal strings are under `server/public/locales/<lang>/client-portal.json`; authoring-UI strings go in the settings/msp namespace per existing convention.

## Decisions

- Tables over tenant_settings JSON: audience, schedule, and per-user dismissal need relational access.
- Audience resolved at read time (live), not snapshotted, so tag changes take effect immediately.
- Plain text + one link only; no rich text, to avoid a sanitization surface.
- Critical severity forces non-dismissible both in UI and in the read path, not just at write time.
- Editing content or audience clears dismissals (open question 2 may narrow this).
- Notice model is deliberately placement-agnostic so the ticket form could reuse it later; v1 renders only the top bar.

## Commands

- Plan validation: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-11-12-client-portal-notices`

## Gotchas

- Do not show IDs in the authoring table; resolve client and tag names.
- Plan artifacts must stay free of customer names and ticket content.
