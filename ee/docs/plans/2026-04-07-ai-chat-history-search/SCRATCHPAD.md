# Scratchpad — AI Chat History Search

- Plan slug: `2026-04-07-ai-chat-history-search`
- Created: `2026-04-07`

## What This Is

Working memory for adding searchable AI chat history to the existing enterprise chat sidebar.

## Decisions

- (2026-04-07) Search scope is chat-level only. Results should return matching chats, not individual matching messages or snippets.
- (2026-04-07) A match should come from either chat titles or persisted message body content.
- (2026-04-07) Use Postgres full-text search over the existing `chats` and `messages` tables rather than vector search or a denormalized search document.
- (2026-04-07) Keep the feature inside the existing history card in `RightSidebarContent.tsx`; do not add a separate page or modal.
- (2026-04-07) Keep `preview_text` behavior unchanged: show the latest persisted message preview, not the matched text excerpt.
- (2026-04-07) Minimum query length is assumed to be 2 characters unless product scope changes during review.

## Discoveries / Constraints

- (2026-04-07) Current persistence lives in `ee/server/src/lib/chat-actions/chatActions.tsx`, with `Chat.getRecentByUser(...)` in `ee/server/src/models/chat.ts` and `Message.getByChatId(...)` in `ee/server/src/models/message.ts`.
- (2026-04-07) The history sidebar already uses one server-action seam for recent history and one for full-chat load, so search can slot into that pattern with a new action instead of a new API route.
- (2026-04-07) The existing AI schema migration already creates `process_large_lexemes(...)` and uses generated `tsvector` columns elsewhere, so chat search can reuse that pattern.
- (2026-04-07) `Chat.tsx` persists chats/messages during the existing SSE flow; search should avoid changing that write path.
- (2026-04-07) The current history list is capped at 20 rows and uses latest persisted message content as `preview_text`; search should preserve both unless scope changes.
- (2026-04-07) Existing sidebar tests live in `server/src/test/unit/RightSidebar.historyToggle.test.tsx`; DB-backed persistence tests already exist in `server/src/test/integration/chatPersistenceExecution.integration.test.ts`.

## Commands / Runbooks

- (2026-04-07) Locate relevant chat history flow: `rg -n "RightSidebarContent|listCurrentUserChatsAction|getChatMessagesAction|createNewChatAction|addMessageToChatAction" .`
- (2026-04-07) Inspect current chat actions: `sed -n '1,280p' ee/server/src/lib/chat-actions/chatActions.tsx`
- (2026-04-07) Inspect chat persistence query shape: `sed -n '1,260p' ee/server/src/models/chat.ts`
- (2026-04-07) Inspect current history sidebar behavior: `sed -n '1,760p' ee/server/src/components/layout/RightSidebarContent.tsx`
- (2026-04-07) Inspect AI schema migration: `sed -n '1,180p' ee/server/migrations/202410291100_create_ai_schema.cjs`
- (2026-04-07) Validate the plan artifacts: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-04-07-ai-chat-history-search`

## Links / References

- `ee/server/src/components/layout/RightSidebarContent.tsx`
- `ee/server/src/components/chat/Chat.tsx`
- `ee/server/src/lib/chat-actions/chatActions.tsx`
- `ee/server/src/models/chat.ts`
- `ee/server/src/models/message.ts`
- `ee/server/migrations/202410291100_create_ai_schema.cjs`
- `server/src/test/unit/RightSidebar.historyToggle.test.tsx`
- `server/src/test/integration/chatPersistenceExecution.integration.test.ts`

## Open Questions

- No blocking product questions remain after confirming:
  - chat-level results only
  - match on titles and message content
  - Postgres full-text search path

## Implementation Log

- (2026-04-07) Completed F001: Added migration `ee/server/migrations/20260407163000_add_chat_history_search_indexes.cjs` to create `chats.title_index` as a stored generated `tsvector` from `coalesce(title_text, '')`.
- (2026-04-07) Completed F002: Added `chats_title_index_idx` GIN index on `chats.title_index` in the same migration.
- (2026-04-07) Completed F003: Added `messages.content_index` as a stored generated `tsvector` using `process_large_lexemes(coalesce(content, ''))` in the same migration.
- (2026-04-07) Completed F004: Added `messages_content_index_idx` GIN index on `messages.content_index` in the same migration.
- (2026-04-07) Completed F005: Added `Chat.searchByUser(userId, query, limit)` in `ee/server/src/models/chat.ts` returning `ChatHistoryItem[]`.
- (2026-04-07) Completed F006: `Chat.searchByUser` matches chats by `chats.title_index` OR related `messages.content_index` using `websearch_to_tsquery`.
- (2026-04-07) Completed F007: `Chat.searchByUser` keeps one row per chat (chat-driven query with `exists`) and orders by relevance rank then recency (`coalesce(updated_at, created_at) desc`).
- (2026-04-07) Completed F008: `Chat.searchByUser` preserves `preview_text` from the latest persisted message (`message_order desc`, fallback `id desc`).
- (2026-04-07) Completed F009: Added `searchCurrentUserChatsAction(query, limit)` in `ee/server/src/lib/chat-actions/chatActions.tsx` with trim + minimum length (2) guard.
- (2026-04-07) Completed F010: Search action fails closed for unavailable persistence and rollout schema gaps (`42P01`, `42703`) by returning `[]` and not breaking sidebar behavior.
- (2026-04-07) Completed F011: Added chat-history search input and local query state in `ee/server/src/components/layout/RightSidebarContent.tsx`.
- (2026-04-07) Completed F012: Empty search query path now explicitly loads recent chats via `listCurrentUserChatsAction(HISTORY_LIMIT)` and keeps “Recent Chats” mode.
- (2026-04-07) Completed F013: Added debounced search (`250ms`) for trimmed queries with length >= 2 and “Search Results” labeling.
- (2026-04-07) Completed F014: One-character queries show helper state and skip server search calls.
- (2026-04-07) Completed F015: Search result rows continue to reuse existing row rendering (title, timestamp, preview, rename/delete).
- (2026-04-07) Completed F016: Selecting search result row reuses existing `getChatMessagesAction(chatId)` load flow.
- (2026-04-07) Completed F017: Added explicit search states for loading, query-too-short, no-results (and preserved no-saved-chats state for recent mode).
- (2026-04-07) Completed F018: Rename/delete now refresh the currently active dataset (`recent` or current search query) via `refreshActiveHistoryDataset`.
- (2026-04-07) Completed F019: Clearing query immediately restores recent dataset (no sidebar close/reopen required).
- (2026-04-07) Completed T001/T002: Added DB-backed integration coverage in `server/src/test/integration/chatHistorySearch.integration.test.ts` for title+message matching, dedupe, preview behavior, relevance+recency ordering, user scoping, and non-match guard.
- (2026-04-07) Completed T003/T004/T005/T006: Added sidebar unit coverage in `server/src/test/unit/RightSidebar.historySearch.test.tsx` for empty-query recent mode, debounced threshold switching, query-too-short helper, clear-to-recent behavior, no-results state, result selection load, and rename/delete re-search behavior.
- (2026-04-07) Completed T007: Added `searchCurrentUserChatsAction` fail-closed unit coverage in `server/src/test/unit/chatActions.searchCurrentUserChatsAction.test.ts` for unavailable persistence and missing-column rollout scenarios.

## Additional Gotchas

- Chat search uses cached persistence checks in `chatActions.tsx`; unit tests that validate fallback behavior should reset modules or isolate imports to avoid cross-test cache effects.
- Search refresh after mutations is tied to current trimmed query state to keep mode consistency between recent/search datasets.
