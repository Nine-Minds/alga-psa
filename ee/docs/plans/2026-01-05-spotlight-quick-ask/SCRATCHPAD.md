# Scratchpad — Spotlight Quick Ask Overlay

## Goal
Spotlight-style Quick Ask overlay that shares chat session logic with the existing right-sidebar AI chat and can hand off an active session into the sidebar.

## Repo Notes / Discovery
- Sidebar toggle currently lives in `server/src/components/layout/DefaultLayout.tsx` (`⌘/Ctrl + L`).
- EE sidebar chat is implemented in `ee/server/src/components/layout/RightSidebarContent.tsx` and renders `ee/server/src/components/chat/Chat.tsx`.
- Chat persistence server actions live in `ee/server/src/lib/chat-actions/chatActions.tsx`.
- Client chat currently calls `POST /api/chat/v1/completions` (EE implementation delegated from `server/src/app/api/chat/v1/completions/route.ts`).
- Streaming routes exist at `POST /api/chat/stream/*` (delegated from `server/src/app/api/chat/stream/[...slug]/route.ts` to `ee/server/src/services/chatStreamService.ts`).
- There is an SSE parsing helper in `ee/server/src/services/streaming.ts` (currently points at an external inference endpoint for token streaming in one codepath).
- A Spotlight-adjacent UI exists as a reference: `server/src/components/assets/AssetCommandPalette.tsx` (Dialog + cmdk usage).

## Key Decisions (pending confirmation)
- Shortcut: hardcode `⌘+ArrowUp` / `Ctrl+ArrowUp`.
- Shortcut is NOT ignored while typing in inputs/textareas/contentEditable.
- If the right sidebar chat is already open, shortcut focuses the sidebar chat instead of opening Quick Ask.
- On “Open in sidebar”: close overlay immediately and open right sidebar bound to same session.
- Overlay session reuse behavior on reopen: always start fresh (past sessions revisited via chat history).
- Collapsed input: multiline supported; `Shift+Enter` inserts newline.

## Proposed Implementation Notes (high level)
- Create a shared chat session hook/provider in EE to avoid duplicating the send/persist/stream logic.
- Add a new overlay component that uses existing `Dialog` and adopts Spotlight-like styling.
- Add a small state handoff mechanism so sidebar can show a session started in the overlay without losing in-flight streamed content.

## Validation Commands
- Validate plan folder: `python3 scripts/validate_plan.py ee/docs/plans/2026-01-05-spotlight-quick-ask`
