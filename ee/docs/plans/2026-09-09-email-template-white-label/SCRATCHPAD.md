# Scratchpad — Email template white-labeling

- Plan slug: `email-template-white-label`
- Created: `2026-09-09`

## Decisions

- (2026-09-09) Materialize branding into `tenant_email_templates` rows via an explicit apply flow rather
  than rewriting at send time. Reason: user feedback wants control, five production tenants already did
  this by hand, hand-edited rows must never be overwritten, and the existing editor plus "Reset to
  system" keep working on materialized rows. Send-time rewriting was the first proposal and was rejected.
- (2026-09-09) Suggestion order: custom theme → picked theme pair (not `alga`) → client portal branding →
  stock. A saved palette wins over the suggestion, with a one-click "Use suggested colors" when they differ.
- (2026-09-09) Colors are available on every edition, matching client portal branding. Logo in header and
  hiding "Powered by AlgaPSA" are Enterprise, matching MSP white-label; server strips them on Community the
  way `scopeBrandingToEdition` does.
- (2026-09-09) Customized rows are opt-in per row and only their remaining stock tokens are replaced.
  Rows with no recognizable tokens (full redesigns) are never written.

## Discoveries / Constraints

- Templates: 54 names × 8 languages = 425 `system_email_templates` rows locally; 416 carry the stock
  purple. 32 rows (auth templates) use `<style>` blocks instead of inline styles but the same hex values.
- Stock palette is defined once in `server/migrations/utils/templates/_shared/constants.cjs` and was
  applied to every template by `20260109100000_standardize_email_template_styling.cjs`. 46 migrations
  build templates through `_shared/emailLayout.cjs` (gradient header, white card, purple footer).
- Non-palette colors that must survive a rewrite: text `#0f172a #1f2933 #475467`, comment box
  `#eff6ff #bfdbfe #1e40af`, ambers `#f59e0b #92400e #fef3c7 #78350f`, `#eef2ff`, `#ffffff`.
- Production read (replica `pgvector-coord-0`, 2026-09-09): 20 tenants, 249 tenant rows. Palette
  swappers: `65fb3e79` (52 rows, terracotta/indigo), `88371d51` (54, dark redesign with `<style>`),
  `91a53464` (39, green), `a313416c` (18, blue buttons), `d9d10280` (11, blue). Others are copy/subject
  edits on 1–3 rows. `65fb3e79`'s edits are exactly the token swap FR3 describes (same structure, +12
  chars per row from a longer gradient). Use these shapes as unit-test fixtures (anonymized).
- Send paths that read templates (for awareness, unchanged by this plan): `server/src/lib/notifications/
  sendEventEmail.ts`, `packages/notifications/src/notifications/email.ts`, `packages/email/src/system/
  SystemEmailService.ts`, `packages/email/src/templateProcessors.ts` (auth mails), billing invoice/quote
  actions, `packages/projects` status updates. All resolve tenant row by (tenant, name, language) with
  English fallback, so materialized rows are picked up automatically.
- Existing template actions in `packages/notifications/src/actions/notification-actions/
  notificationActions.ts` take `tenant` as an argument and are not wrapped in `withAuth`. New actions must
  use `withAuth` + `hasPermission(user, 'settings', 'update')`.
- Theme sources: `settings.theme.pairId` / `customTheme` (`packages/tenancy/src/lib/tenantTheme.ts`,
  `normalizeTenantTheme` drops `custom` without a customTheme). Pair colors: `CUSTOM_THEME_PRESETS` in
  `packages/tenancy/src/lib/customTheme.ts` carry `light.primary/secondary` per pair; `THEME_PAIRS`
  swatches carry only primary. Portal colors: `settings.branding.primaryColor/secondaryColor`.
- Logo URLs come from `settings.branding.logoUrl/logoWideUrl` (entity image URLs). Verify they are
  fetchable without a session before shipping FR10; if not, the header image needs a public asset route.
- Unique key `(tenant, name, language_code)` on `tenant_email_templates`; `system_template_id` links back.
- `tenant_email_templates` is Citus-distributed: batch per language and avoid column references in
  UPDATE SET (select first, update with params).
- Related uncommitted change on main (2026-09-09): `AppearanceSettings.tsx` now returns `UpgradePrompt`
  on Community; the route and nav already gated the tab.

## Commands / Runbooks

- Local template stats:
  `docker exec -e PGPASSWORD=$(cat secrets/postgres_password) alga-psa-local-test-postgres-1 psql -U postgres -d <db> -Atc "select count(*), count(distinct name), count(distinct language_code) from system_email_templates"`
- Prod read-only (replica): `kubectl --context default exec -n stackgres-pgvector pod/pgvector-coord-0 -c postgres-util -- psql -U postgres -d server -Atc "..."`; confirm `pg_is_in_recovery()` is `t` first.
- Unit tests: `cd server && npx vitest run <path>`; locale gate: `src/test/unit/i18n/localeQualityGates.test.ts`.

## Links / References

- Feedback: customer asked how to change "ALL the email templates" at once (2026-09-09).
- Email templates UI: `packages/notifications/src/components/settings/EmailTemplates.tsx`.
- MSP white-label round 2 plan: `ee/plans/2026-09-04-msp-whitelabel-rect-logo-favicon/README.md`.
- Public doc to update: nm-store `src/site/content/docs/themes-and-white-label.md` (already behind on wide
  logo/favicon).

## Implementation notes (2026-09-09)

- Built on branch `email_white_label`, one commit per commit group. All drafts in the open questions were
  taken as-is: the panel sits on the Notifications tab, the single-color toggle stayed, and the Enterprise
  logo/attribution shipped in the same release as its own commit group.
- `resolveEmailPalette` short-circuits to the literal stock map when primary/secondary are the stock colors:
  the hand-picked purple tints in `constants.cjs` are not reproducible from `#8A4DEA` by any one formula, and
  a tenant that keeps the AlgaPSA colors has to get byte-identical rows.
- `applyEmailPalette` takes an array of `from` maps, so a re-apply matches the previously applied palette and
  any leftover stock token in a single pass — no chained rewrites that could double-apply.
- `classifyTenantTemplate` normalizes our own brand assets away (logo `<img data-alga-brand-logo>` and the
  attribution line) before comparing. That is what lets a tenant turn the attribution back on and have the
  system footer restored: branded rows are re-cloned from the system row on every apply.
- `system_email_templates.created_at` is read defensively for FR9: a missing or unparseable value simply
  means "not new", so the banner stays quiet rather than misreporting.
- Apply/remove logic lives in the pure planner `packages/email/src/branding/planEmailBrandingApply.ts`; the
  server action is a thin DB shim (one transaction per language, batched inserts, id-scoped updates). Tests
  cover the planner against the real English system templates instead of needing a seeded database.
- UI coverage is draft-state unit tests plus source-contract tests (ids, structure, no server call in the
  preview path). `packages/notifications` has no jsdom harness and standing one up was out of scope.

## Open Questions

- Are `settings.branding.logoUrl` / `logoWideUrl` fetchable by a mail client without a session? FR10 writes
  the URL straight into the `<img src>`; if entity-image URLs are session-gated the header image needs a
  public asset route before Enterprise tenants switch the logo on.
- F057 (public docs) lives in the nm-store repo: the email section of "Set Interface Themes, Dark Mode, and
  White-Label Branding" and the apply flow in the email templates doc are still to be written there.
