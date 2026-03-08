# Scratchpad — Dynamic Browser Tab Titles

- Plan slug: `page-titles`
- Created: `2026-03-08`

## Decisions

- (2026-03-08) Use Next.js metadata template pattern — zero runtime cost, built-in support.
- (2026-03-08) Client Portal gets `| Client Portal` suffix to distinguish from MSP tabs.
- (2026-03-08) Phase 4 (entity name fetching) deferred — keep initial scope to static titles + route params.
- (2026-03-08) Dynamic pages use generic titles like "Ticket Details" rather than fetching entity names.

## Discoveries / Constraints

- (2026-03-08) Root layout uses `generateMetadata()` (async) — must keep title.template inside the function return, not switch to static `metadata` export.
- (2026-03-08) 5 files already have metadata exports:
  - `server/src/app/auth/verify/layout.tsx` — `title: 'Verify Email'` (string format, compatible)
  - `server/src/app/client-portal/client-settings/layout.tsx` — `title: 'Company Settings'` (string format, compatible)
  - `server/src/app/msp/assets/[asset_id]/edit/page.tsx` — `title: 'Edit Asset'` (string format, compatible)
  - `server/src/app/msp/extensions/[id]/page.tsx` — re-exports from `@product/extensions/entry` (verify)
  - `server/src/app/surveys/respond/[token]/page.tsx` — uses `generateMetadata()` with translation
- (2026-03-08) EE directory has 3 additional extension pages with metadata in `ee/server/src/app/msp/`
- (2026-03-08) EE directory has 3 MSP pages without metadata: chat, licenses/purchase, licenses/purchase/success
- (2026-03-08) Client portal `extensions/[id]/page.tsx` also re-exports from `@product/extensions/entry`
- (2026-03-08) Pages listed in original plan but NOT found on disk: `/msp/knowledge-base`, `/msp/documents`, `/client-portal/knowledge-base`, `/client-portal/documents`, `/share/[token]`. Skip these.
- (2026-03-08) MSP layout, Client Portal layout, Auth layout, Static layout are all server components — safe to add metadata exports.

## Commands / Runbooks

- Validate plan: `python scripts/validate_plan.py docs/plans/2026-03-08-page-titles`

## Links / References

- Original plan: `.ai/page-title-plan.md`
- Root layout: `server/src/app/layout.tsx` (line 24: `generateMetadata()`)
- MSP layout: `server/src/app/msp/layout.tsx`
- Client Portal layout: `server/src/app/client-portal/layout.tsx`
- Auth layout: `server/src/app/auth/layout.tsx`
- Static layout: `server/src/app/static/layout.tsx`
- Next.js metadata template docs: https://nextjs.org/docs/app/building-your-application/optimizing/metadata#title

## Open Questions

- Should EE pages (ee/server/src/app/msp/) also get title metadata? Likely yes for consistency.
- (2026-03-08) Audit correction: `/msp/documents` exists on disk and needed explicit metadata despite the original scratch note.
- (2026-03-08) Audit discovery: `/test-routing` had no title metadata and needed a public-page title entry.
- (2026-03-08) EE builds use standalone `ee/server` app layouts, so matching root/MSP/Client Portal metadata templates were required there too.
- (2026-03-08) Validation runbook: `npm --prefix server run test -- src/test/unit/app/pageTitles.metadata.test.ts` verifies title coverage from source.
- (2026-03-08) Validation runbook: `NODE_OPTIONS='--max-old-space-size=8192' npm --prefix server run typecheck && NODE_OPTIONS='--max-old-space-size=8192' npm --prefix ee/server run typecheck` passes.
- (2026-03-08) Build blocker: `npm run build` and `npm --prefix ee/server run build` fail on pre-existing missing-module issues in `@alga-psa/product-extension-actions`, `@alga-psa/storage/StorageService`, and `packages/workflows` exports.
- (2026-03-08) F001: Root layout: change generateMetadata() title from static string to template object with `template: '%s | Alga PSA'` and `default: 'Alga PSA'`
- (2026-03-08) F002: MSP layout: add metadata export with `template: '%s | Alga PSA'` and `default: 'Dashboard | Alga PSA'`
- (2026-03-08) F003: Client Portal layout: add metadata export with `template: '%s | Client Portal'` and `default: 'Dashboard | Client Portal'`
- (2026-03-08) F004: Auth layout: add metadata export with `template: '%s | Alga PSA'` and `default: 'Sign In | Alga PSA'`
- (2026-03-08) F005: Static layout: add metadata export with `default: 'Alga PSA'`
- (2026-03-08) F006: MSP page title: /msp/dashboard — title: 'Dashboard'
- (2026-03-08) F007: MSP page title: /msp/account — title: 'Account'
- (2026-03-08) F008: MSP page title: /msp/account-manager — title: 'Account Manager'
- (2026-03-08) F009: MSP page title: /msp/profile — title: 'Profile'
- (2026-03-08) F010: MSP page title: /msp/tickets — title: 'Tickets'
- (2026-03-08) F011: MSP page title: /msp/tickets/[id] — title: 'Ticket Details' (generateMetadata)
- (2026-03-08) F012: MSP page title: /msp/clients — title: 'Clients'
- (2026-03-08) F013: MSP page title: /msp/clients/[id] — title: 'Client Details' (generateMetadata)
- (2026-03-08) F014: MSP page title: /msp/contacts — title: 'Contacts'
- (2026-03-08) F015: MSP page title: /msp/contacts/[id] — title: 'Contact Details' (generateMetadata)
- (2026-03-08) F016: MSP page title: /msp/contacts/[id]/activity — title: 'Contact Activity' (generateMetadata)
- (2026-03-08) F017: MSP page title: /msp/projects — title: 'Projects'
- (2026-03-08) F018: MSP page title: /msp/projects/[id] — title: 'Project Details' (generateMetadata)
- (2026-03-08) F019: MSP page title: /msp/projects/templates — title: 'Project Templates'
- (2026-03-08) F020: MSP page title: /msp/projects/templates/create — title: 'Create Template'
- (2026-03-08) F021: MSP page title: /msp/projects/templates/[templateId] — title: 'Template Details' (generateMetadata)
- (2026-03-08) F022: MSP page title: /msp/assets — title: 'Assets'
- (2026-03-08) F023: MSP page title: /msp/assets/[asset_id] — title: 'Asset Details' (generateMetadata)
