# PRD — Mobile Ticket Rich Text

- Slug: `mobile-ticket-rich-text`
- Date: `2026-03-10`
- Status: Draft

## Summary

Bring the existing ticket rich-text experience to the Expo mobile app for both ticket descriptions and ticket comments. Mobile must be able to render existing saved rich content correctly and provide edit capability immediately for ticket description editing and ticket comment composition.

The implementation will use a web-based Tiptap runtime inside a React Native WebView or Expo DOM component, wrapped by a small React Native API. The first slice is intentionally ticket-scoped rather than a generic editor platform: it should solve the actual mobile ticket flows first, while keeping the bridge and runtime clean enough to extract later if needed.

## Problem

The web ticket UI already persists rich ticket content, but the mobile app still treats those same fields as plain strings.

- Ticket comments are rendered as `Text` nodes in mobile and use `comment_text: string` as the entire contract.
- Ticket descriptions are rendered as plain text extracted from ticket attributes.
- Existing ticket content may already be serialized BlockNote JSON, markdown-like text, or ProseMirror/Tiptap JSON, but mobile does not parse or render those formats.
- Mobile comment composition is a plain `TextInput`, so editing capability on mobile diverges sharply from the browser experience.

This creates three concrete product problems:

1. Existing ticket content is not rendered faithfully on mobile.
2. Technicians cannot edit descriptions or compose comments on mobile with the same formatting affordances they use on the web.
3. The mobile app risks creating or preserving a second, plain-text-only ticket workflow that diverges further from the ticket rich-text model already being established in web ticket flows.

## Goals

- Render saved ticket descriptions and ticket comments correctly in the mobile app.
- Provide edit capability immediately for:
  - ticket description editing
  - ticket comment composition
- Reuse the same broad Tiptap/BlockNote content model already used by ticket web flows.
- Keep the first implementation ticket-scoped and small enough to debug directly.
- Support a stable React Native wrapper API with a thin typed bridge to the web editor runtime.
- Preserve compatibility with legacy plain-text content and currently saved serialized ticket rich-text strings.
- Support both HTML and JSON retrieval internally so the system is not locked into one future persistence strategy.

## Non-goals

- Building a generic monorepo-wide editor framework in this first slice.
- Adding collaborative editing to mobile.
- Recreating every browser-only editor affordance on day one.
- Shipping tables, slash commands, embedded media, or arbitrary extension registration.
- Adding mobile editing for existing historical comments in v1.
- Performing a bulk backfill migration of historical ticket descriptions or comments.
- Replacing the current web ticket editor implementation as part of this effort.

## Users and Primary Flows

Primary users:

- Internal technicians and dispatchers using the Expo mobile app.

Primary flows:

1. View ticket description on mobile
   - User opens a ticket detail screen.
   - Saved rich description content renders with formatting instead of raw JSON or flattened text.

2. Edit ticket description on mobile
   - User opens description edit mode.
   - User applies simple formatting, edits content, saves, and sees the formatted result in read mode.

3. View ticket comments on mobile
   - User scrolls the comment stream.
   - Saved rich comments render correctly, including links and other supported formatting.

4. Compose a ticket comment on mobile
   - User writes a new ticket comment using the mobile rich-text surface.
   - User saves the comment and sees it rendered correctly in the conversation.

## UX / UI Notes

- Use fixed-height editor surfaces first; do not require auto-height for v1.
- Keep the initial toolbar intentionally small and touch-friendly:
  - bold
  - italic
  - underline
  - bullet list
  - ordered list
  - undo
  - redo if feasible with low risk
- Read-only display should feel native to the mobile ticket screen even if the rendering runtime is web-based under the hood.
- Description edit mode should replace the existing plain text entry affordance with the rich editor.
- Comment composition should replace the existing plain text `TextInput` with the rich editor.
- Existing comment items in the thread remain non-editable in v1.
- Links inside rendered content must be tappable.
- Internal/public comment visibility controls remain native React Native controls outside the editor surface.

## Requirements

### Functional Requirements

- `FR-001` Mobile ticket detail screens must render saved ticket descriptions as formatted rich text.
- `FR-002` Mobile ticket detail screens must render saved ticket comments as formatted rich text.
- `FR-003` Mobile must support ticket description editing with the new rich-text editor wrapper.
- `FR-004` Mobile must support ticket comment composition with the new rich-text editor wrapper.
- `FR-005` The editor runtime must support initialization from the existing serialized ticket rich-text string.
- `FR-006` The editor runtime must tolerate legacy plain-text ticket content and represent it as editable rich-text paragraphs.
- `FR-007` The editor runtime must support read-only mode.
- `FR-008` The editor runtime must support editable mode.
- `FR-009` The editor runtime must expose programmatic focus and blur.
- `FR-010` The editor runtime must expose programmatic `getHTML` and `getJSON`.
- `FR-011` The bridge must support `set-content` and `set-editable`.
- `FR-012` The bridge must emit lightweight state changes suitable for enabling and disabling toolbar buttons.
- `FR-013` The bridge must emit debounced content changes rather than streaming the entire document on every keystroke.
- `FR-014` The v1 editor command set must include bold, italic, underline, bullet list, ordered list, and hard line break support.
- `FR-015` Heading support may be included if it falls naturally out of the chosen shared extension set; it is not required to ship v1.
- `FR-016` Read-only rendering must correctly display existing content saved as:
  - serialized BlockNote JSON block arrays
  - legacy plain text
  - ProseMirror/Tiptap `{ type: "doc" }` JSON when encountered
- `FR-017` Mobile read-only rendering must preserve tappable links.
- `FR-018` Mobile read-only rendering must preserve supported image blocks and attachment-backed inline image references when present in saved content.
- `FR-019` Description save flows must continue to persist through the existing ticket attribute update path.
- `FR-020` Comment creation must continue to persist through the existing ticket comment API path.
- `FR-021` The server must expose enough derived data for mobile rendering and debugging, such as normalized HTML render output, without requiring mobile to implement its own HTML conversion rules.
- `FR-022` Mobile draft behavior for unsent ticket comments must continue to work after the rich editor replacement.
- `FR-023` Toolbar availability must remain disabled until the web editor reports ready state.
- `FR-024` The implementation must be reusable across both ticket description editing and ticket comment composition without duplicating bridge logic.

### Non-functional Requirements

- `NFR-001` The solution must work in the current Expo 54 mobile app.
- `NFR-002` Production usage must not depend on a live dev server.
- `NFR-003` The initial implementation should minimize bridge chatter by sending small state payloads frequently and full content payloads only on debounce, blur, or explicit request.
- `NFR-004` The wrapper must remain debuggable by the application team without introducing a heavy RPC framework.
- `NFR-005` WebView or DOM runtime navigation must be restricted to local/editor-controlled content.
- `NFR-006` Mobile editor performance only needs to be acceptable for normal ticket descriptions and ticket comments; it does not need to optimize for unusually large documents in v1.
- `NFR-007` Existing ticket content must continue to display safely even when malformed or partially legacy-formatted.

## Data / API / Integrations

- Current mobile read/write contracts still treat ticket comments as plain strings.
- Current ticket web flows already persist serialized ticket rich-text strings for descriptions and comments.
- The first mobile implementation should preserve write compatibility by continuing to send serialized strings where practical.
- The editor runtime should operate on JSON internally but the React Native app should not need to understand BlockNote internals.
- Ticket descriptions should continue to persist in `ticket.attributes.description`.
- Ticket comments should continue to persist through the existing ticket comment creation endpoint, but the semantic meaning of `comment_text` in mobile-aware flows becomes “serialized ticket rich-text string” rather than “plain text only.”
- The server should expose derived render-friendly output for mobile, ideally:
  - `description_html`
  - `comment_html`
- Shared conversion logic should come from the existing formatting utilities rather than a mobile-only converter.
- The mobile wrapper should be responsible for:
  - initializing the runtime with current content
  - requesting HTML or JSON when needed
  - sending toolbar commands
  - receiving debounced updates

Likely code areas touched:

- `ee/mobile/src/screens/TicketDetailScreen.tsx`
- `ee/mobile/src/api/tickets.ts`
- ticket comment and ticket attribute API contracts in `server/src/lib/api`
- shared ticket rich-text helpers in `packages/tickets`
- mobile editor runtime and wrapper in a new mobile-focused package or folder

## Security / Permissions

- Do not evaluate arbitrary JavaScript from ticket payloads.
- Treat bridge messages as untrusted serialized data and validate their shapes before acting on them.
- Restrict the WebView or DOM runtime to local content and block arbitrary external navigation.
- Preserve current ticket permission checks on the underlying API endpoints.
- Continue to treat internal/public comment state outside the editor as a server-enforced permission concern, not an editor concern.

## Observability

- Development-only bridge logging is acceptable for:
  - editor ready timing
  - request/response timeout failures
  - unknown inbound message types
  - command execution failures
- Production verbose logging is out of scope.

## Rollout / Migration

- No data backfill is required.
- Existing legacy plain-text content must remain viewable and editable.
- Existing serialized ticket rich-text strings must remain viewable and editable.
- Start with the ticket detail screen only.
- Keep existing non-rich mobile ticket workflows unchanged outside description edit and comment compose/display.
- If comment or description payload mismatches are discovered during rollout, mobile should still fall back to plain-text display rather than failing the entire screen.

## Open Questions

- Should the ticket comments API expose `comment_html` only, or both `comment_html` and a normalized `comment_json` representation for mobile debugging and future parity work?
- Is heading support required in the initial mobile toolbar, or should the v1 command set remain limited to inline formatting plus lists?
- Do we need mobile mention insertion in v1, or is it sufficient to render existing mentions correctly while deferring mention authoring?
- Do we need mobile clipboard or image insertion in v1, or is rendering saved images enough for the first ticket-focused release?
- Should the mobile app support editing existing saved comments in a follow-on phase, or remain limited to composing new comments and editing descriptions?

## Acceptance Criteria (Definition of Done)

1. The mobile ticket detail screen renders saved ticket descriptions as formatted rich text.
2. The mobile ticket detail screen renders saved ticket comments as formatted rich text.
3. Technicians can edit a ticket description on mobile using the new rich-text editor wrapper.
4. Technicians can compose a new ticket comment on mobile using the new rich-text editor wrapper.
5. The mobile rich-text wrapper runs without requiring a live dev server in production.
6. The editor runtime supports initialization from current saved ticket content and tolerates legacy plain text.
7. The toolbar supports at least bold, italic, underline, bullet list, and ordered list.
8. The mobile app can request HTML and JSON from the runtime through the typed bridge.
9. The mobile app remains usable on both iOS and Android under normal ticket-editing conditions.
10. Existing malformed or legacy content falls back safely instead of crashing the ticket detail screen.
