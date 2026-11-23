# Plan — Branded email templates freeze content (quote review link never reaches branded tenants)

Card: b271b095 · RightPath Consulting (Eric Pfeifer) · ticket alga-2026-0002820 · branch
feature/alga-2026-0002820-branded-email-templates-freeze
Worktree read: `/home/robert/alga-copies/feature-alga-2026-0002820-branded-email-templates-freeze` @ 23f023416d (main)

## Asked

A tenant that only *branded* its email templates must always render the current system template
content in its brand, so that system template changes (such as `{{quoteReviewLink}}`, added
2026-11-13) reach it with no tenant action. Templates a tenant really edited keep their edits.
Existing branded copies in production — including RightPath's — must carry the review link after
deploy. Tenants with real edits must be able to see that their quote template lacks the link.

Must not change: quote emails for tenants that turned link review off; the portal-only fallback for
templates that genuinely omit the link; the look of branded emails.

Produce the implementation design, not the implementation.

## What the code actually does (read, not inferred from the ticket)

1. **Branding writes a frozen copy.** `applyEmailBrandingAction`
   (`packages/notifications/src/actions/notification-actions/emailBrandingActions.ts:303,341`) plans
   with `planEmailBrandingApply` (`packages/email/src/branding/planEmailBrandingApply.ts`) and writes
   `tenant_email_templates` rows: system body → `applyEmailPalette(..., STOCK, target)` → `decorate`
   (logo + attribution from `buildBrandDecorator`, line 260). The palette is persisted in tenant
   settings via `persistAppliedPalette` (line 403); `readEmailBrandingPalette`
   (`packages/notifications/src/lib/emailBranding.ts:149`) reads it back.
2. **System templates are replaced in place.** Every system template ships as a versioned migration
   module (`server/migrations/utils/templates/email/**`) upserted by
   `server/migrations/utils/templates/_shared/upsertEmailTemplates.cjs`. That call updates
   `system_email_templates` only. Example: `20261031090000_add_quote_review_link_to_email_templates.cjs`
   upserts `quote-email`/`quote-reminder-email` with a `{{#if quoteReviewLink}}` block whose `else`
   branch is the old portal block (`quoteEmail.cjs:218-225`). **Tenant copies are never touched** —
   that is the freeze, and it is not quote-specific.
3. **Nothing can currently tell a stale branded copy from an edit.** `classifyTenantTemplate`
   (`packages/email/src/branding/classifyTenantTemplate.ts:82-118`) decides `branded` by comparing the
   tenant row to the **current** system row with the applied palette. Two days after a system change,
   an untouched old copy no longer matches and is classified `customized` — it is indistinguishable
   from a hand edit, forever.
4. **Quotes have their own resolver.** `getQuoteEmailTemplate`
   (`packages/billing/src/lib/quoteEmailRendering.ts:30-55`) repeats the tenant-then-system lookup that
   `lookupEmailTemplate` (`server/src/lib/notifications/emailTemplateLookup.ts:40-52`) already
   implements for every other email. A fix that lands only in the quote path would not cover the class;
   a fix that lands only in `lookupEmailTemplate` would not reach quotes.
5. **The link state is already observable at send time.** `resolveQuoteEmail` reports
   `rendersReviewLink` from a Handlebars AST walk (`templateReferencesReviewLink`,
   `quoteEmailRendering.ts:63-85`) and `quoteActions` records `reviewLink: 'not_rendered'`. That
   observation is per-send and burns no UI signal today.

## Design

### The rule

> A tenant template row written by the branding tool is a **derived view** of a system template.
> It keeps its provenance; while the tenant has not edited it, its content is the *current* system
> template rendered in the tenant's palette and brand decoration. Any tenant edit cuts the
> provenance and the row becomes theirs.

That single rule covers every system template change, including ones nobody has thought of yet, and
it needs no fan-out across 47 tenants at deploy time.

### 1. Provenance on the row (schema)

`tenant_email_templates` gains three nullable columns:

| column | meaning |
| --- | --- |
| `derived_from_system_id` | `system_email_templates.id` this row was derived from |
| `derived_palette` (jsonb) | the palette the apply flow used for *this* row |
| `derived_snapshot_hash` (text) | sha256 of the row's `subject\0html\0text` **as written** |

The stored palette (not the tenant's current settings) is what makes a derivation reproducible: if
the tenant later changes their brand palette without re-applying, the derivation does not silently
change under them.

Writers that stamp provenance: `applyEmailBrandingAction` inserts/updates, `overwrite` rows, split
copies (`copiedFrom`), and `cloneSystemTemplateAction`/`createTenantTemplateAction`
(`notificationActions.ts:149,163`). A single helper `stampDerivedTemplate(row, systemRow, palette)`
keeps it in one place. `updateTenantTemplateAction` (`notificationActions.ts:206`) and
`deactivateTenantTemplateAction` **clear** it — that is the "this is mine now" boundary.

### 2. Resolution (render-time derivation)

`lookupEmailTemplate` grows one branch, so every caller inherits it:

```
own = tenant row (name, locale)
if own && own.derived_from_system_id && hash(own.subject, own.html, own.text) === own.derived_snapshot_hash
    system = current system row (name, locale)
    if system: return { source: 'tenant-derived',
                         template: decorate(applyEmailPalette(system.html, STOCK, own.derived_palette), branding),
                         subject: system.subject, ... }
return own ?? system      // unchanged behaviour otherwise
```

- `decorate` must be the *same composition* the apply flow uses. Today it is `buildBrandDecorator`
  inside a `withAuth` action; extract its pure core to `@alga-psa/email/branding`
  (`brandDecorator(palette, branding, isEnterprise, target)`) and call it from both. `LEVERAGE:
  friction` — the decorator is currently unreachable outside the action.
- Copy: derivation happens for html **and** text, and per language; if the system row lacks the
  language the tenant row has, serve the tenant row (no cross-language invention).
- Cost: one extra `system_email_templates` read (the fallback path already does one), plus pure
  string work. Memoise per process keyed by
  `tenant:name:language:system.updated_at:snapshot_hash`; volumes here are emails, not page loads.

### 3. Quotes join the shared resolver

Delete `getQuoteEmailTemplate`'s private loop and call `lookupEmailTemplate`. Keep
`resolveQuoteEmail`'s contract (it returns the resolved row plus `rendersReviewLink`); the link
detection now runs against the *derived* content, which is the point. This is the only quote-specific
change and it disappears into the shared layer. `LEVERAGE: pattern tenant-then-system template
lookup` marks the removed duplicate.

### 4. The production backlog (RightPath and the other 44)

Existing rows have no provenance. A one-shot, marker-guarded **data task** — TS, run at deploy
alongside migrations, not a `.cjs` migration, because it needs `applyEmailPalette`, brand-asset
normalisation and the classifier, which live in TS and cannot be required from a migration
(1347 of 1347 migrations are `.cjs`) — does:

for every `(tenant, name, language)` tenant row without provenance, for every **known system body**
of that template:
1. render `knownBody` → `decorate(applyEmailPalette(knownBody, STOCK, palette))`
2. compare with the tenant row after the classifier's existing `withoutBrandAssets` normalisation
3. on equality, stamp `derived_from_system_id` (current system row), `derived_palette` (tenant's
   applied palette), `derived_snapshot_hash` (hash of the row as it stands).

"Known system bodies" = the current system row plus a checked-in catalogue of prior bodies that the
template modules can still render. They already do this: `quoteEmail.cjs` / `quoteReminder.cjs`
accept `{reviewLink:false}` specifically to reproduce the pre-2026-11-13 bodies
(`20261031090000_…cjs:5-7,38-42`). The catalogue is generated from those module shapes and checked
in; it is only needed for rows that predate provenance, so it does not grow.

Rows that match nothing are **left alone** — we do not guess edits away. The task logs counts and the
`(tenant, template)` pairs it stamped, and is idempotent (a marker row makes re-runs no-ops).

After the stamp, RightPath's next quote email renders the current system body in its brand and carries
`{{quoteReviewLink}}` — with no tenant action and no stored-content rewrite.

### 5. What a tenant sees (settings)

`packages/notifications/src/components/settings/EmailTemplates.tsx` already renders a branding status
per template (line 959 builds the palette sources). It gains:

- **Derived rows**: "Standard template · your brand — follows Alga updates", with **Edit** (clears
  provenance, becomes customized) and **Reset to standard** (re-derives).
- **Customized rows**: a generic variable diff. Extract `templateVariables(source): Set<string>` from
  `templateReferencesReviewLink` into the email package and compare the current system template's
  variables with the tenant row's. Any variable the standard template uses and the row does not gets
  an inline warning naming it — e.g. *"The standard quote email now includes `{{quoteReviewLink}}`.
  Your edited copy doesn't."* — with **Reset to standard**. This is what satisfies "tenants with real
  edits should be able to see that their quote template is missing the review link", generically.

The same derivation feeds the preview, so what the tenant sees equals what is sent.

## Build order

1. Schema migration (SQL only): the three columns + index on `derived_from_system_id`.
2. `stampDerivedTemplate` helper; stamp in apply/clone/create; clear in update/deactivate.
3. Extract the decorator core and `templateVariables` into `@alga-psa/email/branding`.
4. Derived branch in `lookupEmailTemplate`; delete the quote resolver's private loop.
5. Settings UI: derived-state chip, variable-diff warning, Edit / Reset actions.
6. Backfill data task + prior-body catalogue + marker.
7. Tests (see below).

## Tests

- **Unit (classifier/resolver)**: a derived row whose system body changed serves the new body; a row
  whose content changed after the stamp serves the row (edit wins); a derived row whose system row is
  missing falls back to the row; text and per-language paths.
- **Behavioural**: RightPath-shaped fixture — old branded row for `quote-email` (reviewLink:false
  body + palette + logo) → backfill stamps it → `resolveQuoteEmail` reports `rendersReviewLink: true`
  and the rendered html contains the review link and the portal link.
- **Guards**: link review off ⇒ `quoteReviewLink` empty ⇒ conditional renders the portal block exactly
  as before; a customized row that omits the link still reports `not_rendered` (and the UI warns);
  branded output for a *new* apply is byte-identical to today's apply output (look preserved).
- **Backfill idempotence** and "no-match rows untouched".

## Risks and open questions

- Every branded email now reads the current system row. If a system template is renamed or removed,
  the resolver must fall back to the stored row (covered above); a rename is a migration concern.
- Stored rows can disagree with rendered rows by design. Anything that audits the DB directly
  (exports, support scripts) reads the stale body. Mitigation: the settings page and all sends go
  through the resolver; a future reconcile job can rewrite stored copies if that ever matters.
- The prior-body catalogue is the only place that knows history. After provenance is stamped at write
  time it never needs to grow — but it must be generated from the module shapes, not hand-copied.
- Colour-only tenant edits normalise away under `withoutBrandAssets`/palette comparison and can be
  absorbed into a derivation. That is already the apply flow's view of "branded", so it is consistent,
  not new.
