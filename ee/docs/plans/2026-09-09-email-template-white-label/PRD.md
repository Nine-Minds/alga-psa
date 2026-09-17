# PRD — Email template white-labeling

- Slug: `email-template-white-label`
- Date: `2026-09-09`
- Status: Draft

## Summary

Give MSPs one place to put their own colors on every outbound email, with an explicit preview-and-apply
flow that never overwrites templates they have already edited by hand. Colors are suggested from what the
tenant has already chosen elsewhere in the product, in this order: a configured custom theme, then a
picked theme pair, then client portal branding, then the stock AlgaPSA palette. Enterprise tenants can
also put their logo in the email header and drop the "Powered by AlgaPSA" footer line.

## Problem

Every outbound email is rendered from a fully inlined HTML template stored in `system_email_templates`:
54 template names in 8 languages, 425 rows, 416 of which carry the stock purple palette from
`server/migrations/utils/templates/_shared/constants.cjs`. The only customization path is
Settings → Notifications → Email templates → Customize, which clones one template's HTML into
`tenant_email_templates` for the tenant to edit in a code editor.

Customer feedback: "How does one simply or not simply modify ALL the email templates -- there are A LOT.
No way to blanket adjust the said email theme??"

Production (read on 2026-09-09) shows what people do today:

| | |
|---|---|
| Tenants with any customized template | 20 |
| Customized rows | 249 |
| Tenants that recolored 18 to 54 templates one by one | 5 |

Those five tenants replaced the gradient, outer background, card border, shadow and footer color with a
consistent palette of their own, template by template. One tenant rewrote all 54 templates into a dark
design with `<style>` blocks. The remaining tenants changed copy or a subject on one to three templates
and kept the stock colors.

## Goals

- One palette, chosen once, applied to any number of templates and languages in one action.
- Suggest the tenant's existing colors first so the common case is "confirm and apply".
- Preview before writing anything.
- Never silently alter a template the tenant has edited. Customized templates are opt-in per row, and
  only their remaining stock color tokens are replaced, so copy edits survive.
- Keep the per-template editor as the escape hatch and let it apply the saved palette to one template.
- Tell tenants when new system templates arrive that are not yet branded.
- Enterprise: logo in the email header and the option to remove the "Powered by AlgaPSA" footer line.

## Non-goals

- Changing how emails are rendered at send time. Branding is materialized into `tenant_email_templates`
  rows so every result stays visible and editable in the existing editor and "Reset to system" keeps
  working.
- A layout or typography editor. Only colors, logo and the attribution line change.
- Restyling text-only (`text_content`) bodies. They carry no colors.
- Migrating existing hand-customized rows automatically.
- Any change to sender identity, from-address or managed sending domains.
- Mobile app or PDF/invoice branding.

## Users and Primary Flows

**MSP admin with settings update permission.**

1. **Brand everything for the first time.** Opens Settings → Notifications → Email templates. A new
   "Email branding" panel sits above the template table, prefilled with suggested colors and a note saying
   where they came from ("From your Ocean theme", "From your client portal branding", "AlgaPSA default").
   Adjusts nothing or tweaks the primary color, sees the live preview of two templates update, clicks
   "Apply to templates". A scope dialog lists all templates grouped by state with the untouched ones
   preselected and the tenant's languages preselected. Confirms. Result summary: "48 templates branded,
   3 skipped (already customized), 0 failed".
2. **Rebrand later.** Same panel, colors already saved. Changes the primary color, applies again. Rows
   the tool wrote earlier still carry the previous palette's tokens, which the tool recognizes as its
   own and replaces. Rows the tenant edited by hand since are listed under "customized" and stay
   unchecked.
3. **Bring one hand-edited template in line.** Opens that template in the editor, clicks "Apply my
   palette". Only stock or previously applied palette tokens change. Preview tab shows the result before
   Save.
4. **New templates after an upgrade.** A banner on the Email templates tab says "3 templates added since
   you last applied your palette" with an "Apply palette to new templates" button that opens the scope
   dialog with just those preselected.
5. **Enterprise: logo and attribution.** In the same panel, a logo picker that reuses the tenant's
   branding logo variants, and a switch "Show 'Powered by AlgaPSA' in the footer". Both are applied by
   the same apply flow.

## UX / UI Notes

**Placement.** `packages/notifications/src/components/settings/EmailTemplates.tsx`, above the language
filter row and the `email-templates-table`. A single `Card` titled "Email branding".

**Suggested colors.** On load, the panel resolves a suggestion and shows a small source chip:

| Source, in order | Primary | Secondary |
|---|---|---|
| Custom theme configured (`settings.theme.customTheme`) | `customTheme.light.primary` | `customTheme.light.secondary` |
| Theme pair picked and not the default `alga` (`settings.theme.pairId`) | `CUSTOM_THEME_PRESETS[pairId].light.primary` | `CUSTOM_THEME_PRESETS[pairId].light.secondary` |
| Client portal branding with a primary color set (`settings.branding.primaryColor`) | `branding.primaryColor` | `branding.secondaryColor` |
| None | `#8A4DEA` | `#40CFF9` |

Once the tenant saves a palette, the saved palette wins and the chip reads "Saved". A "Use suggested
colors" link restores the suggestion when it differs from the saved palette, so a tenant who changes
their theme later is offered the new colors without being forced onto them.

**Palette controls.** Primary color, secondary color, and a "Single color" toggle that hides secondary
and derives the gradient from primary alone. Derived tokens (dark accent, outer background, card border,
footer background, badge tint) are shown as read-only swatches with an "Adjust" disclosure that exposes
each one as an overridable color. Every control has a kebab-case `id`.

**Preview.** Two sandboxed iframes side by side reusing `EmailTemplatePreview`: `ticket-created` and
`invoice-email` (or the first two templates in the tenant's current language filter). They re-render on
every palette change from the system template HTML with the palette applied client-side. No writes.

**Scope dialog** (`apply-email-branding-dialog`). Opened by "Apply to templates". Contents:

- Language checkboxes, defaulting to the tenant's enabled languages (fallback: `en`).
- A table of templates with columns: name, category, state, action. States:
  - **System** — no tenant row. Preselected. Action: "Create branded copy".
  - **Branded by you** — tenant row whose HTML equals the system template with the last applied
    palette substituted. Preselected. Action: "Update colors".
  - **Customized** — tenant row that differs from the system template beyond palette tokens. Unchecked.
    A hint says which parts differ: "colors", "text", "subject". Action when checked: "Replace remaining
    stock colors only".
  - **No stock colors** — tenant row containing none of the recognizable tokens (a full redesign).
    Disabled with a hint "Nothing to replace".
- Select all / none per group. Footer shows the count that will be written.
- Confirm button "Apply to N templates". A result summary replaces the table when done, with per-row
  errors if any.

**Editor integration.** In the existing template edit dialog, a button "Apply my palette"
(`apply-palette-to-template`) next to the HTML/preview tabs, enabled when a palette is saved. It rewrites
the editor's HTML in place (not the row) so the tenant reviews it in the Preview tab and saves normally.

**New-template banner.** Shown on the tab when the saved palette has an `appliedAt` and there are system
template names with no tenant row created after `appliedAt`. Dismissable per session; reappears after
the next upgrade adds more.

**Enterprise section** of the panel, rendered only when the edition is Enterprise (same
`NEXT_PUBLIC_EDITION` check the settings shell uses; server actions check `isEnterprise`):

- Logo: "Use my logo in the email header" switch plus a variant picker limited to what the tenant has
  uploaded (`logoWideUrl` preferred, then `logoUrl`). Preview shows it in the header card above the
  label line, `max-height:40px`. If no logo is uploaded, a link to Settings → Client Portal → Branding.
- "Show 'Powered by AlgaPSA' in the footer" switch, default on.
- Community edition sees neither control. If a palette saved on Enterprise carries `logo` or
  `hideAttribution` and the edition later reads as Community, the apply flow ignores both, mirroring
  `scopeBrandingToEdition`.

**i18n.** All new strings under the `msp/settings` namespace, `notifications.emailBranding.*`, present in
all shipped locales. "Powered by AlgaPSA" itself stays untranslated brand text.

## Requirements

### Functional Requirements

**FR1 Palette model.** A tenant email palette is stored at `tenant_settings.settings.emailBranding`:

```
{
  primary: '#rrggbb',
  secondary: '#rrggbb' | null,     // null = single-color mode
  overrides?: { dark?, outerBg?, footerBg?, cardBorder?, infoBorder?, badgeAlpha? },
  logo?: { variant: 'wide' | 'default' } ,          // Enterprise only
  hideAttribution?: boolean,                        // Enterprise only
  appliedAt?: ISO timestamp,                        // last successful apply
  appliedPalette?: { ...resolved token map }        // what was written, for recognition on re-apply
}
```

**FR2 Token map.** A pure function `resolveEmailPalette(palette)` in `packages/email/src/branding/`
returns the full token map with the same keys as `constants.cjs`: `gradient`, `primary`, `secondary`,
`dark`, `outerBg`, `footerBg`, `cardBorder`, `cardShadow`, `badgeBg`, `infoBoxBg`, `infoBoxBorder`.
Derivations: `dark` = primary darkened 25% in HSL; `outerBg` = primary mixed 95% with white; `footerBg`
and `infoBoxBg` = 96% white; `cardBorder` = 88% white; `infoBoxBorder` = 90% white; `cardShadow` and
`badgeBg` = primary at alpha 0.12; `gradient` = `linear-gradient(135deg,<primary>,<secondary|derived>)`
where the single-color secondary is primary lightened 18%. Overrides replace individual derived tokens.

**FR3 Rewrite.** A pure function `applyEmailPalette(html, from, to)` replaces every occurrence of each
token in `from` (the stock map from `constants.cjs`, or a previously applied map) with the matching `to`
token. Matching is case-insensitive for hex and tolerant of the spacing variants already present in the
templates (`background:#…` and `background: #…`, `rgba(138,77,234,0.12)` and `rgba(138, 77, 234, 0.12)`).
It works on both inline-style templates and the auth templates with `<style>` blocks, since both use the
same hex values. It never touches `text_content`.

**FR4 Classification.** `classifyTenantTemplate(tenantRow, systemRow, appliedPalette)` returns one of
`system`, `branded`, `customized`, `no-stock-colors` plus a `differs: ('colors'|'text'|'subject')[]` hint.
`branded` means `applyEmailPalette(system.html, stock, appliedPalette) === tenant.html` and subjects match.
`customized` means the HTML still contains at least one recognizable token but differs otherwise.

**FR5 Suggestion.** `suggestEmailPalette({ theme, branding })` implements the source order in the UX
table and returns `{ primary, secondary, source }` with `source` in
`custom-theme | theme-pair | portal-branding | default`.

**FR6 Apply action.** `applyEmailBrandingAction(scope)` under `withAuth`, requires `settings:update`.
Input: template names, language codes, `includeCustomized: string[]` (names the user ticked in the
customized group). For each selected (name, language):

- `system` → insert a tenant row cloned from the system row with the palette applied,
  `system_template_id` set.
- `branded` → update `html_content` by rewriting from `appliedPalette` to the new map.
- `customized` and ticked → update by rewriting only tokens still equal to the stock or previously
  applied map.
- `no-stock-colors`, or `customized` and not ticked → skip, reported.

Runs in one transaction per language batch, returns `{ written, skipped, failed }` with per-row reasons.
Saves `appliedAt` and `appliedPalette` on success.

**FR7 Save palette.** `saveEmailBrandingAction(palette)` persists FR1 without touching templates.
Validates hex format and, on Community, strips `logo` and `hideAttribution`.

**FR8 Editor apply.** Client-side use of FR3 inside the edit dialog on the current editor text, using
the saved palette. No server call.

**FR9 New-template detection.** `getEmailBrandingStatusAction()` returns the saved palette, the
suggestion, and the list of system template names that have no tenant row for the tenant's selected
languages and whose `created_at` is later than `appliedAt`.

**FR10 Enterprise logo.** When `logo` is set and the edition is Enterprise, the apply flow inserts an
`<img>` row into the header cell of the shared layout (before the label `div`) using the URL from
`settings.branding` for the chosen variant, `alt` = tenant `clientName`, `style="max-height:40px;
margin-bottom:12px"`. Auth templates with their own header structure get the image inserted before their
first heading. Re-apply replaces the existing tagged image (`data-alga-brand-logo`) instead of adding
another.

**FR11 Enterprise attribution.** When `hideAttribution` is true and the edition is Enterprise, the apply
flow removes the literal "Powered by AlgaPSA" fragment and its separator from the footer text of the
selected templates. The migration-era variants are `&middot; Powered by AlgaPSA` inside the copyright
line and a standalone `<p>Powered by AlgaPSA</p>`. Re-enabling restores the system footer for `branded`
rows by re-cloning from the system row and re-applying the palette.

**FR12 Reset.** The existing "Reset to system" per template keeps working unchanged. The panel gets
"Remove branding from all templates" which deletes only rows classified `branded` and clears `appliedAt`.

### Non-functional Requirements

- Applying to all 54 templates in 8 languages (432 rows) completes within a single request under 10 s
  against the Citus-distributed `tenant_email_templates` table; use batched inserts and updates per
  language.
- Every query includes `tenant`. Tenant rows are read and written through `tenantScopedTable`.
- The rewrite and classification functions are pure and covered by unit tests against the real English
  system templates from the migration utilities.

## Data / API / Integrations

- `tenant_settings.settings.emailBranding` (JSONB, schemaless). No migration.
- `tenant_email_templates` unchanged. Unique key `(tenant, name, language_code)` already exists.
- `system_email_templates.created_at` is used by FR9. Confirm the column exists in all environments
  before relying on it; otherwise compare against the migration-time template list.
- Source of stock tokens for FR3: import the values from `constants.cjs` into a TypeScript constant in
  `packages/email/src/branding/stockPalette.ts` with a unit test asserting they still match the `.cjs`
  file, so a future palette migration cannot drift silently.
- Existing actions in `packages/notifications/src/actions/notification-actions/notificationActions.ts`
  take `tenant` as a parameter without `withAuth`. New actions use `withAuth` and `hasPermission`.

## Security / Permissions

- All new actions: `withAuth`, `settings:update`.
- Enterprise-only fields are enforced server-side with `isEnterprise`, not just hidden in the UI.
- HTML written to tenant rows is derived from system template HTML plus color tokens and a logo URL
  from the tenant's own branding record; no user-supplied HTML enters through this feature.

## Rollout / Migration

- No schema change, no data backfill. Existing hand-customized rows are untouched until a tenant opts
  in per row.
- Ships in one release with the panel hidden behind nothing; the panel is inert until a palette is saved.
- Public doc update: nineminds "Set Interface Themes, Dark Mode, and White-Label Branding" gets an email
  section, and the email templates doc gets the apply flow.

## Open Questions

1. Should the panel live on the Notifications tab (next to the templates it writes) or on Appearance
   (next to the other branding)? Draft: Notifications, with a link from the Appearance white-label card.
2. Is "Single color" worth the toggle, or should secondary default to the derived light tint and simply
   be editable? Draft: keep the toggle, it matches the feedback wording.
3. Should Enterprise logo and attribution be part of the first release or a follow-up? Draft: same
   release, separate commit group, so Community can ship without it if needed.

## Acceptance Criteria (Definition of Done)

- A tenant on the Ocean theme opening Email templates sees Ocean blue prefilled with the chip "From your
  Ocean theme" and can apply it to all templates in their languages in one confirmation.
- A tenant with a custom theme sees the custom theme's primary and secondary prefilled.
- A tenant with neither but with client portal colors sees those; a tenant with nothing sees the stock
  palette.
- Applying never changes a row classified `customized` unless that row was explicitly ticked, and then
  only its stock color tokens change; a row with no stock tokens is never written.
- Re-applying after a color change updates rows the tool wrote earlier without touching hand edits.
- "Apply my palette" in the editor changes only color tokens in the editor text.
- New system templates after an apply are surfaced with a one-click path to brand them.
- Enterprise tenants can put their logo in the header and hide "Powered by AlgaPSA"; Community tenants
  cannot, and the server strips those fields.
- Unit tests cover the palette derivation, the rewrite on every English system template, classification
  for each state, and the suggestion order. Integration tests cover the apply action against a seeded
  tenant with a mix of system, branded, customized and redesigned rows.
- All new strings exist in all shipped locales.
