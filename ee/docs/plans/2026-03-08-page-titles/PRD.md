# PRD — Dynamic Browser Tab Titles

- Slug: `page-titles`
- Date: `2026-03-08`
- Status: Draft

## Summary

Add meaningful browser tab titles to every page in Alga PSA so users can distinguish tabs at a glance. Uses Next.js's built-in metadata template system — no client-side code or libraries required.

## Problem

Every browser tab shows "MSP Application" regardless of which page is open. When multiple tabs are open (common for MSP workflows), users cannot tell them apart. This hurts navigation speed and productivity.

## Goals

- Every page in the app shows a descriptive, unique browser tab title
- MSP pages show: `"Page Name | Alga PSA"`
- Client Portal pages show: `"Page Name | Client Portal"`
- Auth pages show: `"Page Name | Alga PSA"`
- Static/public pages show: `"Page Name | Alga PSA"`
- Dynamic routes (e.g., `/msp/tickets/[id]`) show contextual titles (e.g., "Ticket Details")

## Non-goals

- Phase 4 (fetching entity names like ticket subjects or client names for richer titles) is out of scope for initial implementation
- No client-side `document.title` manipulation
- No third-party metadata libraries
- No changes to favicon or other metadata beyond `title`

## Users and Primary Flows

**All users** benefit: MSP operators, client portal users, and unauthenticated users on auth/static pages. The primary flow is simply opening multiple tabs and being able to identify each one from the browser tab bar.

## UX / UI Notes

Title format: `"Page Name | Suffix"` where suffix is:
- `Alga PSA` for MSP, auth, and static pages
- `Client Portal` for client portal pages

Examples:
- `Tickets | Alga PSA`
- `Dashboard | Client Portal`
- `Sign In | Alga PSA`
- `Ticket Details | Alga PSA` (dynamic route)

## Requirements

### Functional Requirements

1. Root layout uses `title.template` and `title.default` in its `generateMetadata()` return
2. MSP layout exports metadata with template `'%s | Alga PSA'` and default `'Dashboard | Alga PSA'`
3. Client Portal layout exports metadata with template `'%s | Client Portal'` and default `'Dashboard | Client Portal'`
4. Auth layout exports metadata with template `'%s | Alga PSA'` and default `'Sign In | Alga PSA'`
5. Static layout exports metadata with default `'Alga PSA'`
6. Every MSP page exports `metadata` or `generateMetadata` with a descriptive title
7. Every Client Portal page exports `metadata` or `generateMetadata` with a descriptive title
8. Every Auth page exports `metadata` with a descriptive title
9. Static/public pages export metadata with descriptive titles
10. Existing metadata exports (5 files) remain compatible with the template pattern
11. Extension pages (re-exported from `@product/extensions/entry`) continue to work

### Non-functional Requirements

- Zero runtime overhead (all metadata is resolved at build/request time by Next.js)
- No new dependencies

## Data / API / Integrations

No data fetching needed for phases 1-3. Metadata is purely static strings or route params.

## Security / Permissions

No security implications. Page titles do not expose sensitive data (no entity names in phases 1-3).

## Rollout / Migration

- Ship all phases together or incrementally — each phase is independently deployable
- No database migrations
- No breaking changes
- Backward compatible with existing metadata exports

## Open Questions

1. Should EE extension page stubs also get metadata updates? (3 files in `ee/server/src/app/msp/`)
2. Should the `knowledge-base` and `documents` routes exist? (No page.tsx found for `/msp/knowledge-base`, `/msp/documents`, `/client-portal/knowledge-base`, `/client-portal/documents` — the original plan lists them but they may not exist yet)

## Acceptance Criteria (Definition of Done)

- [ ] Opening any page in the app shows a descriptive title in the browser tab (not "MSP Application")
- [ ] MSP pages follow `"X | Alga PSA"` format
- [ ] Client Portal pages follow `"X | Client Portal"` format
- [ ] Auth pages follow `"X | Alga PSA"` format
- [ ] Existing metadata exports still work correctly
- [ ] No TypeScript errors introduced
- [ ] No client-side code used for titles
