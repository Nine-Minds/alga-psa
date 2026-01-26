# Spotlight Quick Ask Overlay (AI Chat)

## Summary
Add a **Spotlight-style “Quick Ask” overlay** that opens centered over the app and lets users ask a question fast. When an answer begins returning, the UI **expands into a chat-style dialog** with the response streaming in. The user can then optionally **move the in-progress chat into the existing chat sidebar** (right sidebar), continuing with the normal chat UI.

Quick Ask and the sidebar chat are **the same underlying chat session** (same persistence, same chat id, same messages). The difference is primarily UX: Quick Ask is optimized for “one quick question”, while the sidebar is optimized for extended interaction.

## Problem Statement
Today, AI chat lives in the right sidebar and requires a more deliberate UI mode switch. Users often want to ask a fast question without opening/committing to the sidebar. We need a lightweight, global entry point that feels like macOS Spotlight: a focused input that can quickly expand to show results.

## Goals
- A global keyboard shortcut opens a centered overlay:
  - macOS: `⌘` + `↑` (hardcoded initially)
  - Windows/Linux: `Ctrl` + `↑` (hardcoded initially)
- Quick Ask starts as a minimal input UI; upon sending a prompt and receiving the first response bytes/chunks, it transitions to an expanded dialog showing:
  - user prompt
  - assistant response streaming in (token/chunk streaming supported)
  - follow-up prompts supported (multi-turn)
- Quick Ask shares as much logic as possible with the existing sidebar chat:
  - message persistence (create chat + save messages)
  - request/response handling (including “function proposed” / approval flows if enabled)
  - stop/cancel
  - error handling
- In “expanded dialog” state, provide an action to **move/open the chat in the right sidebar**:
  - The right sidebar should open and display the same session seamlessly.
  - Quick Ask should close (or optionally remain open in minimized state; see Open Questions).
- Messages asked via Quick Ask must persist exactly as messages asked via the sidebar chat do today.

## Non-Goals
- A configurable shortcut UI (future enhancement; we will hardcode initially).
- A full “command palette” that searches app entities (assets/tickets/etc).
- A chat history list UI (the current sidebar chat does not expose prior chats).
- New analytics/telemetry, observability, or rollout flags beyond existing AI gating (unless requested).

## Users / Personas
- **Technician**: wants a fast answer while working in tickets/projects without changing context.
- **Dispatcher/Coordinator**: uses quick prompts for “how do I…” and procedural guidance.
- **Admin**: may use AI to understand settings/integrations quickly.

## Primary User Flows
### Flow A: Quick One-Off Answer
1. User presses `⌘↑` / `Ctrl↑`.
2. Overlay opens centered and focuses the input.
3. User types question and hits `Enter`.
4. Overlay expands; assistant response streams in.
5. User hits `Esc` to close overlay.

### Flow B: Follow-Ups in Overlay
1. User opens overlay and asks question.
2. While response is shown, user asks a follow-up in the same overlay.
3. Chat continues as a single persisted chat session.

### Flow C: Move to Sidebar
1. User opens overlay, asks question, sees response.
2. User clicks “Open in sidebar”.
3. Right sidebar opens showing the same session.
4. User continues in the normal sidebar chat UI.

## UX / UI Notes
### Overlay look & feel (“Spotlight style”)
- Centered on screen horizontally + vertically.
- Rounded container, subtle border/shadow; darkened translucent backdrop.
- Collapsed state:
  - single prominent input (optionally with “Ask Alga…” placeholder)
  - small hint row (e.g., `Esc` to close, `Enter` to ask)
- Expanded dialog state:
  - input remains available at bottom for follow-ups
  - transcript area above (user + assistant)
  - streaming indicator while generating
  - “Open in sidebar” control (only in expanded state)
- Accessibility:
  - focus trap while open
  - `Esc` closes
  - reasonable ARIA labeling via existing `Dialog` component patterns

### Transition (“seamless switch”)
- Use a single Dialog container; animate height/width between collapsed and expanded states.
- Expansion should trigger when:
  - user submits a prompt, and
  - the response begins (first SSE chunk / first tokens received), OR
  - immediately after submit if non-streaming response is used.

### Keyboard behaviors
- Global shortcut toggles open/close when appropriate.
- Inside overlay:
  - `Enter` submits prompt (single-line mode).
  - `Shift+Enter` inserts a newline (multiline input supported).
  - `Esc` closes overlay.
- Shortcut should still work even when focus is inside a text input/textarea/contentEditable in the main app.
- If the right sidebar chat is already open, the shortcut should focus the sidebar chat (instead of opening Quick Ask).

## Technical Design Notes
### Current-State Notes (as observed in repo)
- Right sidebar is toggled in `server/src/components/layout/DefaultLayout.tsx` via `⌘/Ctrl + L`.
- EE sidebar chat uses `ee/server/src/components/layout/RightSidebarContent.tsx`, which renders `ee/server/src/components/chat/Chat.tsx`.
- Chat persistence is handled via server actions in `ee/server/src/lib/chat-actions/chatActions.tsx` (`createNewChatAction`, `addMessageToChatAction`, `updateMessageAction`).
- Chat requests are currently sent to `POST /api/chat/v1/completions` (delegates to `ee/server/src/services/chatCompletionsService.ts`).
- Streaming endpoints exist at `POST /api/chat/stream/*` (delegates to `ee/server/src/services/chatStreamService.ts`), and there is a client-side SSE parser in `ee/server/src/services/streaming.ts`.

### Proposed Architecture
#### 1) Extract shared chat “session” logic
Create a headless hook/service (EE-only) that encapsulates:
- conversation state (model messages + UI messages)
- `chatId` lifecycle (create on first send)
- persistence for user + assistant messages
- request execution (completions today; optional SSE streaming)
- abort/stop
- function proposal/approval flow state (if applicable)

This logic becomes the single source of truth for both:
- sidebar chat UI
- Quick Ask overlay UI

#### 2) Add an EE “Quick Ask Overlay” component
Implement `QuickAskOverlay` as an EE component that:
- is controlled from `DefaultLayout` (open state + close handler)
- uses the shared chat session hook for sending and rendering
- supports “collapsed” and “expanded” UI states
- exposes an “Open in sidebar” action to hand off the active session

In CE builds (or when AI is disabled), the overlay should either:
- do nothing on shortcut, or
- show a small “EE required / AI unavailable” message consistent with existing patterns (decision).

#### 3) Enable handoff (“Open in sidebar”)
Introduce a minimal shared state channel between overlay and sidebar:
- Option A (preferred): a `ChatSessionProvider` at layout/root that stores the active session and exposes:
  - `activeSessionId` / `activeSession`
  - `setActiveSession(...)`
  - `openInSidebar(sessionId)` helper
- Sidebar chat reads from this provider; if a session is active, it renders that session (instead of creating a new one).
- The overlay calls `openInSidebar()` and closes itself.

This avoids brittle prop drilling and ensures both UIs show the same in-memory stream while also persisting to the DB.

### Streaming vs non-streaming
- The Quick Ask overlay UI must support streamed updates.
- Implementation can start by:
  - using the existing `POST /api/chat/stream/...` SSE endpoint and progressively appending chunks, OR
  - extending the completions service to provide an SSE mode.
- Even if the backend currently emits a single SSE chunk, the UI should be built to handle true token streaming later without rewrites.

### Persistence requirements
- On first user message in a session:
  - create chat row (title defaults to first user message)
  - persist user message
- On assistant completion:
  - persist assistant message
- When using streaming:
  - persist assistant message once final (or update incrementally if/when supported by server actions; optional).

### Gating / Feature Availability
- The existing `AI-stuff` feature flag check in `ee/server/src/components/layout/RightSidebarContent.tsx` should be reused for Quick Ask.
- If AI is disabled, opening Quick Ask should present a clear disabled state and not call the API.

## Risks / Edge Cases
- Global shortcut conflicts with OS/browser navigation or app keybindings.
- Focus stealing: opening Quick Ask while typing in a form could be disruptive.
- Session handoff consistency: ensuring the sidebar renders the exact in-memory state (esp. during streaming) without duplicating sends.
- SSE parsing and abort behavior across browsers.

## Open Questions
1. Where should “chat history” live for revisiting past sessions (if not already present in the product)?

## Acceptance Criteria / Definition of Done
- Pressing `⌘↑` on macOS or `Ctrl↑` on Windows opens a centered Spotlight-like overlay with focused input.
- If the right sidebar chat is already open, pressing `⌘↑` / `Ctrl↑` focuses the sidebar chat instead of opening Quick Ask.
- Submitting a question causes the overlay to expand and display the assistant response streaming in.
- Messages asked in Quick Ask persist using the same storage path as the sidebar chat.
- Clicking “Open in sidebar” opens the right sidebar and shows the same session, allowing continued conversation.
- The right sidebar continues to work as before for starting a new chat; the new shared logic does not regress existing chat behavior.
