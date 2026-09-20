# System-generated comments get a system avatar; bundled updates name their master

**Card:** 2cc7da95-6111-43a4-a52a-9222f8b7bbe1
**Builds on:** PR #3439 (mirrors carry the source author + "Bundled update" chip), PR #3434 (`mirrorCommentToChild`, closed-master `apply_resolution`)
**Status:** implemented as designed (2026-09-19). Design decisions 1–4 were accepted as written: per-comment `bundle_mirror_source` read-time provenance replaced the ticket-level `bundleMaster` prop, glyphs remain `Layers`/`Cog`, the `'system'` kind lives in `resolveCommentAuthor`, and `author_type` stays `'unknown'` on system rows. The worktree base already contained PR #3434 (HEAD == `origin/main`); no re-merge was needed.
**Plan folder:** `ee/docs/plans/2026-09-19-system-generated-comment-avatar/`

## Problem statement

A comment with `is_system_generated: true` whose author cannot be resolved renders with the **Unknown User** placeholder avatar ("UU" initials). The name column already says "Bundled update", so the card reads as a data defect: a labelled system row with a broken-looking avatar.

Since PR #3439 (and #3434, which routes both `sync_updates` propagation and `apply_resolution` through one `mirrorCommentToChild` writer) a mirrored comment normally *does* carry the source author, so the common case already shows a real avatar plus the chip. The unresolvable branch still exists and is reachable in four shapes:

1. A mirror whose **source comment itself is authorless** — the backfill migration skips those (`source.user_id IS NOT NULL OR source.contact_id IS NOT NULL` guard) and the writer copies `null` through.
2. A mirror whose source author has since been **deleted** or is absent from the ticket's `userMap`.
3. A **legacy mirror** in an environment where the backfill has not run.
4. **Non-bundle system comments** — e.g. the Huntress incident writer (`ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts`) inserts `is_system_generated: true, user_id: null`.

Shape 4 exposes a second, worse defect: `CommentItem.getAuthorName` labels **every** unresolvable system-generated comment "Bundled update". A Huntress incident note on a ticket that was never bundled is called a bundled update. "System-generated" and "mirrored from a bundle master" are two different facts and the UI currently has only one bit.

## Goals

1. An unresolvable `is_system_generated` comment renders a **system avatar** (a neutral glyph mark, never initials) everywhere the comment author avatar is drawn — MSP conversation view, MSP bento timeline (compact variant), client portal conversation. All three go through `CommentItem`.
2. "Bundled update" is shown only for comments that **are** bundle mirrors (a `ticket_bundle_mirrors` row points at the comment). Other system-generated comments are labelled "System".
3. On the MSP portal, the bundled-update chip names the master: "Bundled update from {{number}}", still linking to the master. The client portal keeps the bare label and no link.
4. A genuinely unattributable non-system comment (unmatched inbound email with no sender, etc.) keeps the Unknown User placeholder — unchanged.
5. The mirror stays **unattributed when its source is unattributed**: the design never substitutes the applying user or anyone else as the author. (When the source *has* an author, #3439's behaviour — real author + chip — is kept as-is.)
6. New label text exists in all 10 locale files; the pseudo-locales are regenerated.
7. `CommentItem` tests updated; a test covers the system-generated branch; the read-time provenance join is covered by a DB-backed test.

## Non-goals

- Changing what is written by `mirrorCommentToChild` or the Huntress writer. No schema change, no migration. Provenance is read from `ticket_bundle_mirrors` at read time.
- Re-attributing authorless mirrors to anyone (explicitly forbidden by the brief).
- Adding a DB `'system'` value to the `comment_author_type` enum. The TS type `CommentAuthorType` already lists `'system'` but the Postgres enum is `('internal','client','unknown')`; reconciling that is a separate card (noted in the scratchpad).
- Email/notification rendering. Bundled-child emails take the author from the master payload (verified in #3439) and have no avatar.
- The mobile app (does not render `is_system_generated` today).

## Personas and flows

- **Technician (MSP):** opens a child ticket → a mirror with a resolvable author shows the author's avatar and name plus the chip "Bundled update from TIC-…" linking to the master; a mirror whose source is authorless shows the bundle glyph avatar, the name "Bundled update", and the same chip text/link.
- **Technician (MSP), Huntress-generated internal note:** shows the system glyph avatar and the name "System"; no bundle chip.
- **Requester (client portal):** same as MSP for the avatar and the "Bundled update" name; the chip is the bare "Bundled update" label with no link (a bundle may span clients; the master must not be reachable or named from the portal).
- **Technician, unmatched inbound email with no sender data:** Unknown User avatar and name — unchanged.

## Design

### 1. Read-time provenance: `comments.bundle_mirror_source` (view-only field)

Both conversation loaders left-join `ticket_bundle_mirrors` on `child_comment_id = comments.comment_id` and expose the result on each comment row:

- **MSP** `getConsolidatedTicketData` (`packages/tickets/src/actions/optimizedTicketActions.ts`, the `comments` query in the `Promise.all`): join `ticket_bundle_mirrors as bm` → `comments as src` (source) → `tickets as mt` (master) and select `bm.source_comment_id`, `mt.ticket_id as bundle_source_ticket_id`, `mt.ticket_number as bundle_source_ticket_number`. All joins tenant-co-located via `tenantLeftJoin`.
- **Client portal** `getClientTicketDetails` (`packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`, `conversationsQuery`): join `ticket_bundle_mirrors` only and select `bm.source_comment_id`. The portal never selects the master's id or number.

Mapped onto the row as one optional field on `IComment` (`packages/types/src/interfaces/comment.interface.ts`):

```ts
/** Read-time provenance from ticket_bundle_mirrors; never written by callers. */
bundle_mirror_source?: {
  source_comment_id: string;
  /** MSP loader only; the portal omits master identity on purpose. */
  master_ticket_id?: string | null;
  master_ticket_number?: string | null;
} | null;
```

Rows loaded through other paths (public API, aggregated child comments on a master) leave the field undefined; the renderer treats undefined the same as null (not a mirror) — a degraded-but-honest "System" label rather than a false "Bundled update".

Per-comment source is authoritative over the ticket-level `bundleMaster` prop: a child that was unbundled and re-bundled under another master still names the master the comment actually came from. The existing `bundleMaster` prop plumbing (`TicketConversation` → `CommentItem`, `TicketBentoLayout` → `BentoTimelineTile` → `CommentItem`) becomes redundant and is **removed**; `CommentItem` reads the master from `conversation.bundle_mirror_source`. (This reverses part of #3439's plumbing; it was the pre-provenance stopgap.)

### 2. Author resolution owns the "system" kind (`packages/tickets/src/lib/commentAuthorResolution.ts`)

`resolveCommentAuthor` gains a third terminal branch. `ResolvedCommentAuthor.source` and `avatarKind` add `'system'`:

- If neither `user_id` nor `contact_id` resolves **and** `comment.is_system_generated` is true → `{ source: 'system', avatarKind: 'system', displayName: 'System', avatarUrl: null }`.
- Otherwise the existing `UNKNOWN_AUTHOR`.

The function's `comment` parameter widens to `Pick<IComment, 'user_id' | 'contact_id' | 'is_system_generated'>`. Every consumer (`CommentItem`, `BentoTimelineTile`'s reply-target name) gets the distinction for free; the `'unknown'` kind is now reserved for genuinely unattributable comments, which is what the "Unknown User" copy has always meant.

`displayName` stays the English fallback the function already uses for 'Unknown User'; `CommentItem` localizes both via `t()`.

### 3. `SystemAvatar` primitive (`packages/ui/src/components/SystemAvatar.tsx`)

A sibling of `UserAvatar` / `ContactAvatar` / `TeamAvatar`. It renders a glyph, not initials:

- Props: `{ glyph?: 'system' | 'bundle'; label: string; size?: EntityAvatarSize; className?: string }`.
- Reuses `getSizeStyle` and the size→shape rule from `EntityAvatar` (xs = rounded square, sm+ = circle) so it sits on the same grid as every other avatar. Exported from `packages/ui` alongside the others.
- Fill: neutral tokens, not the hashed entity colour — `bg-[rgb(var(--color-border-100))]` with `text-[rgb(var(--color-text-500))]` (both already used for neutral chips in the ticket UI, dark-mode aware).
- Glyphs (lucide): `system` → `Cog`; `bundle` → `Layers`. Icon sized to ~50% of the avatar box.
- Accessibility: `role="img"` with `aria-label={label}` (the localized "System" / "Bundled update").
- Contract test `packages/ui/src/components/SystemAvatar.test.tsx`: renders no initials text, carries the aria-label, selects the glyph, and follows the size/shape rule.

### 4. `CommentItem` rendering (`packages/tickets/src/components/ticket/CommentItem.tsx`)

Derive two independent facts up front:

```ts
const isBundleMirror = Boolean(conversation.bundle_mirror_source);
const isSystemAuthor = resolvedAuthor.source === 'system';
```

| author resolves | mirror | avatar | name | chip |
|---|---|---|---|---|
| yes | yes | real user/contact avatar | author name | Bundled update [from N] (link on MSP) |
| yes | no | real avatar | author name | — |
| no (system) | yes | `SystemAvatar glyph="bundle"` | "Bundled update" | Bundled update [from N] (link on MSP) |
| no (system) | no | `SystemAvatar glyph="system"` | "System" | — |
| no (unknown) | — | `UserAvatar` with unknownAuthorAvatarName (unchanged) | Unknown User / inbound sender | — |

Specifics:

- `getAuthorName`: `is_system_generated && source==='unknown'` → replaced by `source==='system'` → `isBundleMirror ? t('conversation.bundledUpdate') : t('conversation.systemAuthor')`.
- `getAuthorEmail`: null for `source === 'system'`.
- `unknownAuthorAvatarName` no longer needs the `!is_system_generated` guard (the system kind never reaches that branch) — keep the inbound-sender behaviour.
- Chip: rendered whenever `isBundleMirror` (the `resolvedAuthor.source !== 'unknown'` gate is dropped — the row for a system-authored mirror had the label as its name and no chip; now the name is the label *and* the chip carries the provenance/link, which is the only place the master number appears). Text: `bundle_mirror_source.master_ticket_number ? t('conversation.bundledUpdateFrom', { number }) : t('conversation.bundledUpdate')`. Link to `/msp/tickets/{master_ticket_id}` only when `master_ticket_id` is present (MSP loader); the portal loader never populates it, so the portal renders a plain span — same visible behaviour as today, without needing a prop to opt out.
- `title` attribute on the chip is dropped (the number is now in the text).
- `canEdit`/`canDelete` still keyed on `is_system_generated` — unchanged.
- Automation ids: `${commentId}-avatar` stays on the avatar for all kinds; add `data-avatar-kind="system|bundle"` on the `SystemAvatar` root so tests and automation can assert the branch without depending on glyph internals. `${commentId}-bundled-update-badge` unchanged.

### 5. Locale keys (`server/public/locales/{de,en,es,fr,it,nl,pl,pt}/features/tickets.json` + regenerated `xx`, `yy`)

Under `conversation`:

- `systemAuthor`: "System"
- `bundledUpdateFrom`: "Bundled update from {{number}}"

`bundledUpdate` and `unknownUser` already exist. Run `node scripts/generate-pseudo-locales.cjs` then `node scripts/validate-translations.cjs`; the `pseudoLocalesInSync` unit test guards the pseudo-locales.

## Design decisions (for captain sign-off)

1. **Provenance moves to a per-comment read-time field and the ticket-level `bundleMaster` prop is removed.** Alternative: keep #3439's prop and add only a boolean `is_bundle_mirror`. Rejected: two sources for "which master", and the ticket-level one is wrong after re-bundling. Removing the prop touches five components #3439 just added it to; it is the correct layer.
2. **Glyphs:** `Layers` for bundle mirrors, `Cog` for other system comments. `Cog` is also the metadata-debug button icon in the same card (admin-only, 16px inline); the avatar is a 32–40px neutral disc so the two are visually distinct. If the captain prefers no overlap, swap the debug button to `Braces` — out of scope here.
3. **The "system" kind lives in `resolveCommentAuthor`**, not in `CommentItem`. This is what makes the bento reply-target name and any future consumer correct without re-deriving the rule.
4. **`author_type` stays `'unknown'`** on system rows. Introducing `'system'` in the DB enum would be the honest long-term model but is a schema change and a writer change across Huntress/mirrors — separate card.

## Data model / API notes

- No schema changes. `ticket_bundle_mirrors(tenant, source_comment_id, child_ticket_id, child_comment_id)` already exists and is tenant-distributed.
- `IComment.bundle_mirror_source` is a view-only field: `updateComment`/`deleteComment` inputs must not accept it (they whitelist columns today; verify in tests).
- Public API `GET /tickets/{id}/comments`: unchanged shape (does not populate the field).

## UX copy

- Name for a non-bundle system comment: **System**.
- Chip (MSP, number known): **Bundled update from TIC001157**. Chip (portal, or number unknown): **Bundled update**.
- Avatar aria-labels reuse the same two strings.

## Risks

- **Citus co-location:** the MSP join chains `comments → ticket_bundle_mirrors → comments → tickets`, all on `tenant`. Use `tenantLeftJoin` for each hop; the integration test runs the real query.
- **Portal leakage:** the portal loader must never select master ticket identity. Guarded by a contract test on the portal comment shape.
- **Regression of #3439 tests:** `CommentItem.bundledUpdate.test.tsx` asserts the legacy fallback shows "UU" and the `bundleMaster` prop link; both assertions change deliberately (see tests.json).
- **Worktree base:** this worktree was cut from `main` four minutes *before* #3434 merged; `mirrorCommentToChild` and the merged `apply_resolution` path do not exist here yet. Implementation must start by merging `origin/main`.

## Rollout / migration

Code only; no migration, no flag.

## Open questions

1. Confirm decision 1 (remove the `bundleMaster` prop in favour of per-comment provenance).
2. Glyph choice (decision 2).
3. Should the portal name the master number when the master belongs to the *same* client? Proposed: no (same answer as #3439 Q2; keeps the portal loader free of master lookups).

## Acceptance criteria / definition of done

- [ ] A mirror created via `sync_updates` whose source has an author: real avatar + name + chip "Bundled update from N" (link) on MSP; real avatar + name + "Bundled update" (no link) in the portal.
- [ ] A mirror created via `sync_updates` or `apply_resolution` whose source is authorless: bundle glyph avatar, name "Bundled update", chip as above — no "UU" anywhere, MSP and portal.
- [ ] A non-bundle system comment (Huntress shape): system glyph avatar, name "System", no chip.
- [ ] An unmatched inbound email with no sender: Unknown User avatar and name, unchanged.
- [ ] Neither the applying user nor the master comment's author is ever substituted as the author of an authorless mirror.
- [ ] `systemAuthor` and `bundledUpdateFrom` exist in all 10 locale files; `test:i18n` passes.
- [ ] `CommentItem.bundledUpdate.test.tsx` updated; new system-generated branch tests; `SystemAvatar` contract test; DB-backed test for the provenance join (MSP populates master id/number, portal does not).
