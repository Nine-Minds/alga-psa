# Scratchpad — Mobile Ticket Rich Text

- Plan slug: `mobile-ticket-rich-text`
- Created: `2026-03-10`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-10) Scope the first plan to mobile ticket flows, not a generic editor platform. The approved first slice is rich display plus immediate edit capability for ticket descriptions and ticket comment composition.
- (2026-03-10) Use a web-based Tiptap runtime inside the Expo mobile app behind a thin React Native wrapper, because Tiptap remains web-first and the current app is already on Expo 54 with WebView-backed DOM support available.
- (2026-03-10) Keep the initial implementation ticket-scoped in shared code ownership. Do not introduce a broad `editor-core` package before the ticket flows work end to end.
- (2026-03-10) Continue treating `ticket.attributes.description` as the persisted description field and preserve the existing ticket attribute update path.
- (2026-03-10) For comments, preserve the current ticket comment API entrypoint in v1, but treat the mobile payload semantically as serialized ticket rich-text content rather than plain text only.
- (2026-03-10) Prefer server-derived HTML render output from shared formatting helpers over a mobile-only conversion layer.
- (2026-03-10) Keep existing comment items non-editable in the first user-facing mobile slice; only description edit and new comment composition are in scope.
- (2026-03-10) Keep the first mobile content contract in `packages/tickets/src/lib/ticketRichText.ts` instead of creating a separate package now. This keeps the parsing logic close to the existing web ticket helpers while still exposing typed mobile bridge envelopes for later runtime/wrapper work.
- (2026-03-10) Remove the `DEFAULT_BLOCK` dependency on `@alga-psa/ui/editor` from the shared ticket helper. The helper now owns a local empty paragraph block shape so unit tests and future mobile/runtime code do not pull in the web editor bundle transitively.
- (2026-03-10) Implement the runtime and bridge as pure library classes in `packages/tickets` before wiring React Native. This keeps Tiptap behavior, request correlation, and debounced state emission testable in jsdom without needing a live WebView.
- (2026-03-10) Use `@tiptap/core` with `StarterKit`, `Link`, and `Underline` for the mobile runtime. Initialize BlockNote/legacy content by converting it through shared HTML conversion helpers, and initialize ProseMirror payloads directly as JSON.

## Discoveries / Constraints

- (2026-03-10) Mobile currently renders ticket comments and descriptions as plain `Text` content in `ee/mobile/src/screens/TicketDetailScreen.tsx`, so existing rich content will not display correctly.
- (2026-03-10) Mobile API types still model comments as `comment_text: string` in `ee/mobile/src/api/tickets.ts`, which is too weak to describe the real ticket content model now used by web flows.
- (2026-03-10) `TicketService.getTicketComments()` currently maps `comments.note` directly to `comment_text`, and ticket comment create validation still accepts only a string payload in `server/src/lib/api/schemas/ticket.ts`.
- (2026-03-10) Web ticket flows already parse and serialize description/comment rich text through `packages/tickets/src/lib/ticketRichText.ts`.
- (2026-03-10) The shared web `RichTextViewer` already handles serialized BlockNote JSON arrays, markdown-like text, and ProseMirror/Tiptap `{type:'doc'}` fallbacks.
- (2026-03-10) `packages/formatting/src/blocknoteUtils.ts` already contains shared HTML conversion logic for both BlockNote and ProseMirror content, which should be reused for mobile-facing render fields.
- (2026-03-10) The mobile package on this branch is Expo 54 and does not currently declare a direct rich-text or HTML rendering dependency in `ee/mobile/package.json`.
- (2026-03-10) Existing web ticket description work was recently formalized in `ee/docs/plans/2026-03-09-ticket-description-rich-text-cutover/PRD.md`; this mobile plan should stay aligned with that storage direction.
- (2026-03-10) `packages/tickets/src/lib/ticketRichText.ts` originally only handled BlockNote arrays and plain text. It also imported `DEFAULT_BLOCK` through `@alga-psa/ui/editor`, which transitively loads `RichTextViewer` and `next-themes`; that made the helper harder to test in isolation.
- (2026-03-10) `packages/tickets/vitest.config.ts` is the right test entrypoint for workspace package tests. Running the repo-root Vitest wrapper with a package file filter did not match the test file because the root config delegates to `server/vitest.config.ts`.
- (2026-03-10) `ee/mobile/package.json` still does not declare `react-native-webview`, so the next mobile-wrapper slice will need to add the dependency and keep runtime logic outside the component layer.
- (2026-03-10) Using the shared formatting package from the runtime test path emits existing test-environment secret fallback warnings on stderr, but the package-local runtime/bridge assertions still pass and the warning is unrelated to the new runtime behavior.

## Commands / Runbooks

- (2026-03-10) Repository search used to find current ticket editor/viewer implementations:
  - `rg -n "RichTextViewer|TextEditor|ticket comment|description" packages server ee/mobile`
- (2026-03-10) Inspect current mobile ticket rendering and compose flow:
  - `sed -n '1520,1715p' ee/mobile/src/screens/TicketDetailScreen.tsx`
- (2026-03-10) Inspect mobile ticket API types:
  - `sed -n '1,240p' ee/mobile/src/api/tickets.ts`
- (2026-03-10) Inspect current ticket comments API service mapping:
  - `sed -n '639,765p' server/src/lib/api/services/TicketService.ts`
- (2026-03-10) Inspect shared ticket rich-text parsing:
  - `sed -n '1,240p' packages/tickets/src/lib/ticketRichText.ts`
- (2026-03-10) Inspect shared rich render helpers:
  - `sed -n '1,70p;932,990p' packages/formatting/src/blocknoteUtils.ts`
- (2026-03-10) Scaffold the plan folder:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Mobile Ticket Rich Text" --slug mobile-ticket-rich-text`
- (2026-03-10) Inspect and validate the first shared helper slice:
  - `sed -n '1,260p' packages/tickets/src/lib/ticketRichText.ts`
  - `sed -n '1,220p' packages/tickets/src/lib/ticketRichText.test.ts`
  - `cd packages/tickets && npx vitest run src/lib/ticketRichText.test.ts --config vitest.config.ts`
- (2026-03-10) Validation notes:
  - `npx vitest run packages/tickets/src/lib/ticketRichText.test.ts` from the repo root did not find the package test because the root Vitest config is server-scoped.
  - `cd server && npx vitest run ../packages/tickets/src/lib/ticketRichText.test.ts` loaded the package test but failed before collection due to the helper's transitive `next-themes` dependency from `@alga-psa/ui/editor`; removing that dependency fixed the package-local test path.
- (2026-03-10) Runtime and bridge implementation/validation:
  - `sed -n '1,240p' packages/documents/src/components/DocumentEditor.tsx`
  - `sed -n '1,220p' packages/documents/src/components/DocumentViewer.tsx`
  - `cd packages/tickets && npx vitest run src/lib/ticketRichText.test.ts src/lib/ticketMobileEditorBridge.test.ts src/lib/ticketMobileEditorRuntime.test.ts --config vitest.config.ts`
  - `npx eslint packages/tickets/src/lib/ticketMobileEditorRuntime.ts packages/tickets/src/lib/ticketMobileEditorRuntime.test.ts packages/tickets/src/lib/ticketMobileEditorBridge.ts packages/tickets/src/lib/ticketMobileEditorBridge.test.ts --max-warnings=0`

## Links / References

- Key files:
  - `ee/mobile/src/screens/TicketDetailScreen.tsx`
  - `ee/mobile/src/api/tickets.ts`
  - `server/src/lib/api/services/TicketService.ts`
  - `server/src/lib/api/schemas/ticket.ts`
  - `packages/tickets/src/lib/ticketRichText.ts`
  - `packages/tickets/src/lib/index.ts`
  - `packages/tickets/src/lib/ticketMobileEditorBridge.ts`
  - `packages/tickets/src/lib/ticketMobileEditorRuntime.ts`
  - `packages/tickets/vitest.config.ts`
  - `packages/ui/src/editor/RichTextViewer.tsx`
  - `packages/formatting/src/blocknoteUtils.ts`
- Related plan:
  - `ee/docs/plans/2026-03-09-ticket-description-rich-text-cutover/PRD.md`
- External references used during research:
  - Expo DOM components docs
  - react-native-webview docs
  - Tiptap React docs
  - BlockNote supported formats docs

## Open Questions

- Should the first API contract revision expose only derived HTML render fields, or both HTML and normalized JSON payloads for mobile consumers?
- Is heading support required in the initial mobile toolbar, or should v1 remain limited to inline formatting and lists?
- Is rendering saved image content sufficient for v1, or do we need image insertion support in the first mobile editor release?
- Is rendering existing mentions sufficient for v1, or do we need mobile mention authoring in the first release?
