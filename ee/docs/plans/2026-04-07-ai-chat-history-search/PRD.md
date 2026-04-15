# PRD — AI Chat History Search

- Slug: `2026-04-07-ai-chat-history-search`
- Date: `2026-04-07`
- Status: Draft

## Summary

Add search to the AI chat history sidebar so a user can find their saved conversations by matching either chat titles or persisted message body content. Search results remain chat-level rows in the existing history UI and continue to load the full conversation through the current chat-history flow.

## Problem

The current AI history sidebar only shows the most recent 20 chats with the latest-message preview. Once a user has more than a small number of saved conversations, older chats become effectively undiscoverable unless they happen to still be in the recent list. This makes past AI work hard to reuse and pushes users to restart conversations that already exist.

## Goals

1. Let a user search their saved AI chats from the existing history sidebar.
2. Match on both chat title text and persisted message body content.
3. Keep the result model simple: one result row per matching chat.
4. Reuse the existing chat history UI and full-chat loading behavior.
5. Implement search with indexed Postgres full-text search over the existing relational persistence model.

## Non-goals

- Message-level search results, snippet highlighting, or jumping directly to a matched message inside a conversation.
- Semantic or vector-based search.
- Searching chats belonging to other users in the same tenant.
- A global search surface outside the right sidebar.
- Changes to the existing chat persistence write path beyond adding search indexes.

## Users and Primary Flows

**Persona**: An authenticated MSP user who has built up a history of AI conversations and wants to recover one by topic, wording, or title.

### Flow 1 — Browse recent chats
1. User opens the AI sidebar and toggles history open.
2. The sidebar shows the current recent-chat list, count, timestamps, and latest-message preview.
3. User can still open, rename, or delete a chat exactly as today.

### Flow 2 — Search saved chats
1. User opens the AI history panel.
2. User types a query into the history search input.
3. Once the trimmed query has at least 2 characters, the sidebar runs a debounced search.
4. The sidebar shows matching chats only, ordered by relevance and then recency.
5. User selects a result and the existing `getChatMessagesAction` flow loads the full conversation into the chat pane.

### Flow 3 — Return to recent history
1. User clears the search input.
2. The sidebar immediately returns to the recent-chat dataset and label.
3. Rename/delete actions continue to operate on the currently displayed dataset.

## UX / UI Notes

- Search lives inside the existing history card in `RightSidebarContent.tsx`; no new modal, page, or route.
- Empty query keeps the existing “Recent Chats” mode and count behavior.
- Non-empty query with length >= 2 switches the card to “Search Results”.
- Search is debounced on the client to avoid firing on every keystroke.
- Result rows reuse the current history row layout:
  - chat title
  - relative timestamp
  - latest-message preview text
  - rename/delete actions
- Preview text remains the latest persisted message content, not the matched snippet.
- A 1-character query shows a lightweight helper state instead of querying the server.
- The history card needs explicit states for loading, no saved chats yet, query too short, and no results found.

## Requirements

### Functional Requirements

**FR-01**: Add a search input to the AI history card in `RightSidebarContent.tsx`.

**FR-02**: When the search query is empty after trimming, the sidebar continues to load recent chats via `listCurrentUserChatsAction(HISTORY_LIMIT)` and displays the existing “Recent Chats” presentation.

**FR-03**: When the trimmed query length is 1 character, the sidebar does not run the search query and instead shows a helper state prompting the user to type at least 2 characters.

**FR-04**: When the trimmed query length is at least 2 characters, the sidebar runs a debounced search request and shows chat-level search results.

**FR-05**: Search matches a chat when either:
- the chat title matches the query, or
- any persisted message body in that chat matches the query.

**FR-06**: Search results are scoped to the current authenticated user and current tenant only.

**FR-07**: Search returns one row per matching chat; it does not return individual matching messages or duplicate a chat when multiple messages match.

**FR-08**: Search results reuse the existing `ChatHistoryItem` result shape and continue to display `preview_text` derived from the latest persisted message in the chat.

**FR-09**: Selecting a search result loads the full chat via `getChatMessagesAction(chatId)` using the same behavior as selecting a recent chat.

**FR-10**: Rename and delete actions continue to work from search results and refresh the currently active dataset afterward.

**FR-11**: Clearing the search query returns the history card to the recent-chat dataset without requiring the sidebar to be closed and reopened.

**FR-12**: Search uses Postgres full-text search with generated `tsvector` columns and GIN indexes on:
- `chats.title_text`
- `messages.content`

**FR-13**: Message content indexing uses `process_large_lexemes(...)` so unusually long AI responses do not exceed Postgres `tsvector` lexeme limits.

**FR-14**: Search ranking orders results by full-text relevance first, then by `coalesce(chats.updated_at, chats.created_at) desc`.

**FR-15**: Search returns at most the same history limit used for recent chats unless product scope changes later.

**FR-16**: If chat persistence is unavailable, or if the full-text search columns are not yet present during rollout, search fails closed without breaking the sidebar experience.

### Non-functional Requirements

- Search should use indexed query paths appropriate for a growing per-user message corpus; table scans against full message content should be avoided for the steady state.
- The feature must preserve current tenant isolation and current-user isolation.
- The existing chat streaming and persistence flow in `Chat.tsx` should not need architectural changes to support search.
- Search should feel responsive in the sidebar; client debounce should prevent unnecessary request churn during typing.

## Data / API / Integrations

### Persistence Model

Existing persistence remains the source of truth:

- `chats` stores chat metadata (`id`, `user_id`, `title_text`, `updated_at`, etc.).
- `messages` stores persisted message content linked by `chat_id`.

### Schema Changes

Add generated stored search columns and GIN indexes:

- `chats.title_index tsvector generated always as (to_tsvector('english', coalesce(title_text, '')))`
- `messages.content_index tsvector generated always as (process_large_lexemes(coalesce(content, '')))`

### Query Shape

Add a model-level query such as `Chat.searchByUser(userId, query, limit)` that:

- scopes rows to the current user
- matches on `chats.title_index` or any related `messages.content_index`
- deduplicates to one result per chat
- computes a relevance rank
- orders by relevance, then recency
- returns the existing `ChatHistoryItem` shape with `preview_text`

The recommended Postgres query primitive is `websearch_to_tsquery('english', ?)` because it gives user-friendly multi-word search semantics without introducing a second search engine.

### Server Action Boundary

Add `searchCurrentUserChatsAction(query, limit = 20)` alongside the existing history actions. The action should:

- trim the query
- short-circuit on too-short queries
- enforce current-user scope
- return `ChatHistoryItem[]`
- tolerate missing persistence/search schema during rollout by failing closed

## Security / Permissions

- Search is restricted to chats owned by the current user.
- Tenant isolation continues to rely on the existing tenant-scoped DB access and RLS policy applied to `chats` and `messages`.
- No cross-user or cross-tenant search is introduced.

## Observability

No new metrics, audit logging, or analytics are in scope for this plan. Existing warning/error logging patterns in chat actions are sufficient for the initial rollout.

## Rollout / Migration

1. Add the migration for generated `tsvector` columns and GIN indexes.
2. Add the search query path in the chat model and server actions.
3. Add the history search UI in `RightSidebarContent.tsx`.
4. Ship the feature without changing the stream route or message persistence flow.
5. During rollout, if some environments have the chat tables but not the new search columns yet, the action should fail closed rather than breaking the sidebar.

## Open Questions

- None blocking after current scope confirmation. The plan assumes a minimum query length of 2 characters and keeps result rows chat-level only.

## Acceptance Criteria (Definition of Done)

- A user can search saved AI chats from the existing history sidebar.
- A search matches both chat titles and persisted message content.
- Search results display one row per chat, not message hits.
- Selecting a result opens the full conversation using the existing persisted-chat load path.
- Empty query shows recent chats; 1-character query does not hit search; clearing the query restores recent chats.
- Rename/delete continue to work from both recent and search modes.
- The feature is backed by indexed Postgres full-text search on titles and message content.
- Behavioral tests cover at least one DB-backed happy path and one DB-backed guard path, plus sidebar UI behavior for search mode.
