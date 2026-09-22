# Scratchpad — system-generated comment avatar

## Discoveries (design session, 2026-09-19)

- The brief predates two merges. #3439 (merged 03:42Z) made mirrors carry the source author and added the "Bundled update" chip + `bundleMaster` prop. #3434 (merged 17:04Z, **after this worktree was cut at 17:00Z**) extracted `mirrorCommentToChild` into `packages/tickets/src/actions/ticketBundleUtils.ts` and routes `apply_resolution` through it. On `origin/main` both paths copy `user_id`/`contact_id`/`author_type` from the source. → First implementation step: `git merge origin/main`.
- Remaining `user_id null` system rows: authorless source comments (backfill skips them — guard `source.user_id IS NOT NULL OR source.contact_id IS NOT NULL`), deleted/absent authors, pre-backfill environments, and non-bundle writers (Huntress `ticketCreator.ts` inserts `is_system_generated: true, user_id: null, is_internal: true`).
- **Mislabel bug:** `CommentItem.getAuthorName` returns "Bundled update" for any unresolvable `is_system_generated` comment — Huntress notes included. "System-generated" ≠ "bundle mirror"; the only signal for the latter is a `ticket_bundle_mirrors` row, hence the read-time join.
- `CommentAuthorType` (TS) lists `'system'` and `'contact'`, but the Postgres enum `comment_author_type` is `('internal','client','unknown')` (migration 20250217202535). Do not write `'system'`. Separate card if we want the DB to model it.
- Client portal renders comments through the shared `TicketConversation` → `CommentItem` (`packages/client-portal/src/components/tickets/TicketDetails.tsx:866`); one fix covers both portals. Bento timeline uses `CommentItem variant="compact"`.
- Other comment-author consumers: `BentoTimelineTile` reply-target name (uses `resolveCommentAuthor().displayName`); notifications/emails take the author from the master event payload (no avatar). Portal dashboard preview selects only `comments.note`.
- No established bundle glyph in the ticket UI (`Link` icon used twice for unrelated things). `Cog` is already used for the metadata-debug button inside `CommentItem`.
- Neutral tokens in use nearby: `bg-[rgb(var(--color-border-100))]`, `bg-[rgb(var(--color-border-50))]`, `text-[rgb(var(--color-text-500/600))]`.
- `resolveCommentAuthor` hardcodes English 'Unknown User' as displayName; `CommentItem` overrides with `t('conversation.unknownUser')`. Keep the same convention for 'System'.

## Decisions

- Per-comment `bundle_mirror_source` (read-time join) replaces the ticket-level `bundleMaster` prop. Portal loader selects `source_comment_id` only.
- `'system'` author kind added in `resolveCommentAuthor` (single owner of the rule).
- `SystemAvatar` glyphs: `Layers` (bundle) / `Cog` (system). Open for captain override.
- No writer changes, no schema, no migration.

## Commands

- Pseudo-locales + validation: `npm run test:i18n` (or `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`).
- Existing component tests: `packages/tickets/src/components/ticket/CommentItem.*.test.tsx` (vitest, jsdom).
- Bundling integration: `server/src/test/integration/ticketBundling.integration.test.ts`, `ticketBundlingPortalAuthor.integration.test.ts`.

## Key files

- `packages/tickets/src/components/ticket/CommentItem.tsx`
- `packages/tickets/src/lib/commentAuthorResolution.ts`
- `packages/ui/src/components/{EntityAvatar,UserAvatar,ContactAvatar}.tsx` → new `SystemAvatar.tsx`
- `packages/tickets/src/actions/optimizedTicketActions.ts` (`getConsolidatedTicketData` comments query ~L506)
- `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` (`conversationsQuery` ~L432)
- `packages/types/src/interfaces/comment.interface.ts`
- `server/public/locales/*/features/tickets.json` (`conversation.*`)
- `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts` (reference shape, untouched)
