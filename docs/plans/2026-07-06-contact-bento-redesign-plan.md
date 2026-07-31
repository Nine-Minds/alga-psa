# Implementation plan — Contact screen bento redesign

- Slug: `2026-07-06-contact-bento-redesign`
- Date: 2026-07-06
- Branch: `feature/contact-bento-redesign`
- Status: Approved design, ready for implementation
- Mockup: [`2026-07-06-contact-bento-redesign-mockup.html`](./2026-07-06-contact-bento-redesign-mockup.html)
  (Option A — "satellite grid", chosen from three candidate compositions)
- Design language: [`docs/ui/design_guidelines.md`](../ui/design_guidelines.md) —
  every tile must pass its "new tile/panel" checklist. Reference implementation:
  `packages/tickets/src/components/ticket/bento/`.

## Summary

Rebuild the MSP contact detail screen (`/msp/contacts/[id]`) as a bento grid in the
design language the ticket screen established: a hero band carrying identity and
inline-editable key fields, a wide left column for the work the MSP does *for* this
person (tickets, interactions), and a right rail of reference tiles (reach, portal
access, documents, related work, notes). The current tabbed layout (Details / Tickets /
Documents / Interactions / Notes / Portal) and its separate view/edit mode split are
deleted. This ships as a straight replacement — no feature flag, no layout toggle —
because the bento language is now the product's established design system.

## Decisions (settled in design review)

| Question | Decision |
|---|---|
| Scope | Full bento replacement of the tabbed contact screen |
| Composition | Option A "satellite grid" (see mockup) + hero stat strip grafted from Option C |
| Editing | Inline everywhere; kill the view/edit mode split; optimistic writes with revert on rejection |
| Rollout | Straight replacement; legacy components deleted in this branch |
| Data flow | RSC startup mirroring the ticket screen: server prefetch + per-tile Suspense streaming |
| Quick View drawer | Compact bento: hero + Reach + Portal tiles in a single column, "Open full page" link |
| New surfaces | Related work tile (projects + quotes) and hero stat strip (open tickets, last touch, CSAT, portal state) |
| `?tab=` deep links | Dropped — repo search found no producers of contact `?tab=` URLs |

## Composition spec

**Hero band** (full width, headerless `BentoTile` surface):

- Avatar (56px, existing `ContactAvatar` + `ContactAvatarUpload` flow retained).
- Name (`text-lg font-bold`), Active/Inactive chip, portal state chip.
- Inline-editable: role (text), client (via `ClientPicker`, rendered value links to the
  client), status (active/inactive), tags (`TagManager`).
- Read line: primary email · primary phone (with type labels), sourced from the typed
  email/phone lists.
- Right edge meta: "Contact since {created_at}" · "Last touch {date} · {kind}".
- **Stat strip** along the hero bottom, 4 stats separated by hairlines, eyebrow label +
  value + sub-line, per the mockup and the dashboard-option hero:
  1. Open tickets — count of non-closed tickets for this contact, plus urgent count and
     all-time total.
  2. Last touch — most recent interaction (or portal sign-in if newer).
  3. Satisfaction — mean of this contact's survey responses (`survey_responses` links
     to `contacts` via `contact_id`); hide the stat (render "—" with "no surveys yet")
     when there are no responses.
  4. Portal — account state chip (none / invited / active / inactive) + last sign-in.

**Grid** (12-column, `gap-3`, same breakpoint behavior as `TicketBentoLayout`):

| Tile | Span | Content | Header action |
|---|---|---|---|
| Tickets | 8 (left col) | Rows: status pill, subject (truncate), `#number · date` meta. ~5 open/recent, urgent first | "View all N" → `/msp/tickets` filtered to this contact |
| Interactions | 8 (left col) | Feed rows: type icon, title, `date · duration · agent` meta | "＋ Log" → `QuickAddInteraction` dialog; "View all" → `/msp/contacts/[id]/activity` |
| Reach | 4 (rail) | Eyebrowed sections: Email (typed list, primary marked), Phone (typed list, primary marked) | "＋" → add email/phone popover |
| Portal access | 4 (rail) | Label/value rows: status, role (client admin), last sign-in, invited date | "Manage" → Dialog embedding `ContactPortalTab` content |
| Documents | 4 (rail) | Rows: extension micro-badge, name, date. Cap ~3–5 | "View all N" → Dialog with full documents manager (`useDocumentsCrossFeature`) |
| Related work | 4 (rail) | Eyebrowed sections: Projects (name + status meta), Quotes (number · title, amount · state meta) | — |
| Notes | 4 (rail) | Notes text, wrapped (exception to truncate rule — prose block, clamped ~6 lines with "more") | "Edit" → inline textarea swap |

All tiles: skeleton (pulse block) while streaming, red boxed error state, empty state
as a quiet sentence with an action ("No tickets yet" + "Create a ticket", "No documents
yet" + "Add a document", etc.). Sentence case throughout; i18n keys for every string.

## Architecture

### Phase 0 — promote the tile engine to the UI layer

The bento surface is now shared by two feature packages; the engine moves down a layer
(per the layering rule in the repo instructions).

1. Move `BentoTile` from `packages/tickets/src/components/ticket/bento/BentoTile.tsx`
   to `packages/ui/src/components/bento/BentoTile.tsx` (verbatim — no visual change).
2. Update the ~7 ticket bento imports to `@alga-psa/ui/components/bento/BentoTile`;
   delete the tickets copy. No re-export shim: this branch owns updating all callers.
3. Ticket screen must render pixel-identically after the move (spot-check Grid layout
   in the dev stack).

### Phase 1 — data layer: `contactBentoActions` + bootstrap type

New file `packages/clients/src/actions/contact-actions/contactBentoActions.ts`,
following the `withAuth` + tenant-scoped-knex pattern of
`packages/tickets/src/actions/ticketBentoActions.ts` (and getting the same style of
tenant-scoped-auth contract test):

- `getContactTicketsSummary(contactId)` — non-closed tickets first (status pill data,
  subject, number, entered_at), then most-recent closed to fill ~5 rows; plus
  `{ openCount, urgentCount, totalCount }` for the tile header and stat strip.
- `getContactRelatedWork(contactId)` — projects where the contact is the project
  contact (`projects.contact_name_id`) with status; quotes via `quotes.contact_id`
  with quote number, title, amount, state. Each section independently empty-safe; the
  tile renders whichever sections exist.
- `getContactStats(contactId)` — stat strip aggregates: open/urgent/total ticket
  counts (shared query with the summary above), last interaction (date + type), CSAT
  mean + response count from `survey_responses`, portal state (reuse the status logic
  behind `portalInvitationBridgeActions` / `ContactPortalTab` rather than duplicating
  it — extract a `getContactPortalStatus(contactId)` helper if one doesn't already
  exist as an action).
- Interactions list: reuse existing `getInteractionsForEntity` from
  `@alga-psa/clients/actions` (no new action).
- Documents list: reuse the existing documents-by-entity fetch the page already does
  (`getDocumentsByEntity`).

New type `ContactScreenBootstrap` in
`packages/clients/src/lib/contactScreenBootstrap.ts`, mirroring
`packages/tickets/src/lib/ticketScreenBootstrap.ts`: the RSC page assembles it; the
client layout consumes it. Hero-critical data (contact record, client name, tags,
avatar URL, portal permissions, stats) is awaited; per-tile payloads stream.

### Phase 2 — RSC page + layout shell + hero

1. Rewrite `server/src/app/msp/contacts/[id]/page.tsx` on the pattern of
   `server/src/app/msp/tickets/[id]/page.tsx`: `cache()`d contact fetch shared with
   `generateMetadata` (already present), await hero-critical data, wrap each tile's
   data promise in `Suspense` with pulse skeletons. Remove the `tab` search-param
   handling. Keep the existing auth/permission error rendering and
   `AIChatContextBoundary` wiring.
2. `packages/clients/src/components/contacts/bento/ContactBentoLayout.tsx` — the grid
   shell (12-col, responsive collapse: rail wraps under the left column on narrow
   viewports; single column in drawer variant).
3. `packages/clients/src/components/contacts/bento/ContactBentoHero.tsx` — identity
   band + stat strip. Inline edit behavior copies the ticket hero's optimistic
   write + revert-on-rejection pattern (see commit `69552749e4`); writes go through
   the existing `updateContact` action. Client change uses `ClientPicker` with the
   same `clientReadOnly` guard the current screen supports.
4. `ContactBentoSkeleton.tsx` — full-page skeleton for the route-level Suspense
   fallback (hero band + tile blocks).

### Phase 3 — tiles

One component per tile in `packages/clients/src/components/contacts/bento/`:

- `ContactTicketsTile.tsx` — rows per composition spec. "View all" links to the
  ticket list pre-filtered to the contact (same URL shape `MspContactTickets`
  uses today; that component itself is unchanged and remains for the client screen).
- `ContactInteractionsTile.tsx` — compact rows (icon from `InteractionIcon`, title,
  meta). "＋ Log" opens the existing `QuickAddInteraction` dialog; row click opens
  `InteractionDetails` in the drawer as today. "View all" links to
  `/msp/contacts/[id]/activity` (page unchanged).
- `ContactReachTile.tsx` — read view of typed emails/phones with primary markers;
  header "＋" and row click open the existing `ContactEmailAddressesEditor` /
  `ContactPhoneNumbersEditor` inside a compact Dialog. Editors are reused as-is; if
  their full-page density fights the dialog, wrap with
  `ContentCardVariantProvider('bento')` support rather than forking them.
- `ContactPortalAccessTile.tsx` — label/value rows from portal status; "Manage" opens
  a Dialog embedding the existing `ContactPortalTab` body (invitation lifecycle,
  role management stay in that component; the tile only summarizes). Tile is rendered
  only when `getContactPortalPermissions` grants visibility — same gate as the
  current Portal tab.
- `ContactDocumentsTile.tsx` — compact list; "View all" Dialog hosts the full
  documents manager via `useDocumentsCrossFeature().renderDocuments` (same approach
  as the ticket `DocumentsTile`).
- `ContactRelatedWorkTile.tsx` — projects + quotes sections; rows link to the
  project / quote screens. Whole tile hides only if the tenant has neither projects
  nor quotes data *and* no create permission; otherwise show empty states.
- `ContactNotesTile.tsx` — clamped prose with inline edit (textarea swap, save via
  `updateContact`; if `notes_document_id` is set, "Open note document" link instead
  of inline editing the plain field).

Every tile: `BentoTile` surface, automation IDs via the built-in
`ReflectionContainer`, i18n via `useTranslation('msp/contacts')`, all four states
(loading/error/empty/data), truncation-safe at rail width.

### Phase 4 — Quick View + consumer updates

1. `ContactQuickView.tsx` (new, in the bento dir): drawer variant = `ContactBentoHero`
   (stat strip collapses to the two most useful stats at drawer width) + `ReachTile` +
   `PortalAccessTile` stacked single-column, plus an "Open full page" link to
   `/msp/contacts/[id]`.
2. Update the two Quick View producers — `Contacts.tsx` and `ClientContactsList.tsx` —
   to open `ContactQuickView` instead of `ContactDetails quickView={true}`.
3. Audit remaining `ContactDetails` / `ContactDetailsView` imports (`Contacts.tsx`
   drawer paths, ticket-screen contact drawer if any) and repoint them at
   `ContactQuickView` or the full page.

### Phase 5 — deletion and sweep

1. Delete `ContactDetails.tsx`, `ContactDetailsView.tsx`, `ContactDetailsEdit.tsx`
   and their now-orphaned helpers/exports; `ContactPortalTab`, the email/phone
   editors, `QuickAddInteraction`, `InteractionsFeed`/`InteractionDetails`,
   `ContactAvatarUpload` all survive as reused parts.
2. Update `server/src/test/unit/app/msp/contacts/[id]/page.productComposition.test.tsx`
   for the new page shape.
3. i18n sweep: add the new keys (tile titles, empty states, stat labels, actions) to
   the `msp/contacts` namespace across locales; remove dead tab keys.
4. `grep` for dangling references (`contactDetails.tabs.*`, `quickView` props,
   `?tab=` producers) and clean.

## Error handling

- Tile data promise rejects → the tile renders its red boxed error state with the
  message; the rest of the screen is unaffected (per-tile Suspense + error isolation,
  same as the ticket grid).
- Inline edit write rejected → field reverts to server value, toast with the error
  (ticket hero pattern).
- Contact fetch itself fails / not found → existing `notFound()` / permission alert
  paths in the page are preserved.

## Testing

- **Contract/unit** (mirror the ticket bento test suite style):
  - `contactBentoActions.tenantScopedAuth.contract.test.ts` — every new action is
    tenant-scoped and auth-gated.
  - Tile state tests: loading/error/empty/data render for each tile.
  - Hero inline-edit test: optimistic update + revert on rejected `updateContact`.
  - Quick View contract test: drawer renders hero + Reach + Portal and the
    full-page link; producers open it with the right contact.
  - Stat strip: CSAT hidden when no survey responses; counts correct from fixtures.
- **Page composition test**: update the existing product-composition unit test for
  the new RSC page.
- **Manual smoke** (dev stack, per `docs/ui/design_guidelines.md` checklist): both
  themes, rail-width truncation with long names/emails, empty contact (no tickets/
  docs/interactions), portal-permission-less user (no Portal tile), drawer Quick View
  from both producers, ticket Grid layout unchanged after the BentoTile move.

## Out of scope

- Client detail screen bento redesign (`ClientDetails.tsx` keeps its tabs; its Quick
  View is untouched).
- Client portal surfaces (`packages/client-portal/**`).
- New database tables or migrations — every tile reads existing schema.
- Drag/resize tile customization; layout toggle (there is no "Entry" fallback for
  contacts).
- Touch-frequency sparkline and portal 30-day activity counts from the dashboard
  mockup (stat strip only in this pass).

## Open questions (resolve during implementation, none blocking)

- Quotes availability: quotes currently surface through the API layer
  (`server/src/lib/api/services/QuoteService.ts`) — confirm whether the tenant-facing
  quotes feature is generally enabled; if it is EE/flag-gated, the Quotes section of
  Related work follows the same gate.
- Exact filtered-ticket-list URL for the Tickets tile "View all" (reuse whatever
  filter params the ticket list supports for contact filtering).
