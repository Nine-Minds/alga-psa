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
- (2026-03-10) Resolve the first API contract revision by exposing derived HTML only for now: `description_html` on ticket detail responses and `comment_html` on ticket comment responses. This satisfies mobile rendering/debugging needs without expanding the transport shape to normalized JSON yet.
- (2026-03-10) Keep the browser runtime authoritative in `packages/tickets`, but keep the React Native-side bridge client local to `ee/mobile`. The mobile app is not configured as a workspace package consumer, so this avoids dragging unrelated web/server package code into Expo typecheck while still generating the local WebView HTML bundle from the shared runtime.
- (2026-03-10) Package the mobile editor runtime as a generated inline HTML module (`generatedEditorHtml.ts`) built by esbuild from a browser-only entry file. This satisfies the no-dev-server requirement while keeping the generated asset reproducible from source.
- (2026-03-10) Use the same `TicketRichTextEditor` wrapper for both read-only and editable ticket surfaces in v1. Read mode passes the saved serialized content string through the read-only runtime, while edit/compose mode turns on the native toolbar and saves back serialized ProseMirror JSON.
- (2026-03-11) Let ticket screen read-only surfaces provide the external-link callback to the wrapper, and have the wrapper fall back to `Linking.openURL` only when the screen does not supply one. This keeps external navigation blocked inside the WebView while making link handling testable at the screen layer.
- (2026-03-11) Use Tiptap's `Image` extension in the mobile runtime so BlockNote image blocks converted to HTML are preserved in read-only rendering without adding mobile-side image authoring.

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
- (2026-03-10) There is still no existing local WebView HTML asset pattern in `ee/mobile`; the closest repo precedent is the extension iframe/browser bundle flow, so the wrapper slice will need to establish its own asset-loading path.
- (2026-03-10) `convertBlockContentToHTML()` already handles serialized BlockNote JSON and ProseMirror `{type:'doc'}` payloads, but it logs and returns an invalid-content placeholder for legacy plain strings. The new server helper wraps it and falls back to escaped plain text for malformed/legacy content instead of propagating the placeholder to mobile.
- (2026-03-10) Server ticket detail/comment contracts can be extended compatibly by adding optional `description_html` and `comment_html` fields; existing `comment_text` and description storage semantics do not need to change for this slice.
- (2026-03-10) `ee/mobile` is not listed in the repo workspaces, has no existing Metro config, and cannot safely import `packages/*` source directly without extra setup. Adding `ee/mobile/metro.config.js` is enough for app/runtime resolution, but mobile typecheck still needs to exclude the generator scripts that intentionally import shared package source.
- (2026-03-10) `react-native-webview` was not installed in `ee/mobile` even though the package lock mentioned it transitively. The wrapper slice installed it explicitly and added `react-test-renderer` + types for wrapper-level unit tests.
- (2026-03-10) Bundling the shared runtime for WebView initially failed because `ticketMobileEditorRuntime.ts` imported the formatting package root, which pulled server-only transitive modules into the browser bundle. Switching that runtime import to the specific `packages/formatting/src/blocknoteUtils` source file made the inline browser bundle viable.
- (2026-03-10) The mobile ticket screen did not previously have any description edit mode at all; the rich-text slice adds explicit add/edit/cancel/save actions for the description section while continuing to use the existing `updateTicketAttributes()` path.
- (2026-03-10) For comment drafts, the screen now stores the serialized rich content string in secure storage and derives plain text locally for length validation, empty checks, and accessibility labels. On send, it re-reads editor JSON and serializes it so legacy plain-text drafts get upgraded on the next successful send.
- (2026-03-10) Existing saved comment items stay non-editable by rendering the read-only wrapper only. System/event timeline items still render as plain italic text rather than going through the rich wrapper.
- (2026-03-11) After installing `@tiptap/extension-image`, the lockfile refreshed Tiptap to `3.20.x`; `@tiptap/starter-kit` now includes `link` and `underline`, so the runtime must configure those through `StarterKit.configure(...)` instead of registering duplicate standalone extensions.
- (2026-03-11) Explicit malformed-content detection in `ee/mobile/src/features/ticketRichText/helpers.ts` now keeps JSON-looking but unparsable payloads on a plain-text fallback path instead of mounting the WebView editor.
- (2026-03-11) Export `TicketDetailBody` for behavior-focused tests so mobile ticket save/draft/send coverage can exercise the actual screen state machine with mocked APIs/storage instead of reimplementing it through isolated section tests.

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
- (2026-03-10) Server/mobile render-contract implementation/validation:
  - `sed -n '1,220p' server/src/lib/api/services/ticketRichRender.ts`
  - `git diff -- server/src/lib/api/services/ticketRichRender.ts server/src/lib/api/services/TicketService.ts server/src/lib/api/schemas/ticket.ts ee/mobile/src/api/tickets.ts`
  - `npx eslint server/src/lib/api/services/ticketRichRender.ts server/src/test/unit/api/ticketRichRender.responseSchema.test.ts server/src/test/unit/api/ticketRichRender.helper.test.ts server/src/test/unit/api/ticketService.richRender.contract.test.ts ee/mobile/src/api/tickets.ts --max-warnings=0`
  - `cd server && npx vitest run src/test/unit/api/ticketRichRender.responseSchema.test.ts src/test/unit/api/ticketRichRender.helper.test.ts src/test/unit/api/ticketService.richRender.contract.test.ts src/test/unit/api/ticketCommentResponseSchema.contactAuthor.test.ts src/test/unit/api/ticketService.getTicketComments.contactAuthor.test.ts`
- (2026-03-10) Validation note:
  - Linting `server/src/lib/api/services/TicketService.ts` and `server/vitest.config.ts` with `--max-warnings=0` still fails because those files already carry unrelated repo warnings. The targeted lint pass for the new helper/tests/mobile API types is clean.
- (2026-03-10) Mobile wrapper/runtime packaging implementation/validation:
  - `cd ee/mobile && npm install`
  - `cd ee/mobile && npx expo install react-native-webview`
  - `cd ee/mobile && npm install -D react-test-renderer@19.1.0 @types/react-test-renderer@19.1.0`
  - `node ee/mobile/scripts/generate-ticket-mobile-editor-html.mjs`
  - `cd ee/mobile && npx vitest run src/features/ticketRichText/TicketRichTextEditor.test.ts --config vitest.config.ts`
  - `cd ee/mobile && npx tsc --noEmit`
  - `npx eslint ee/mobile/src/features/ticketRichText/TicketRichTextEditor.tsx ee/mobile/src/features/ticketRichText/TicketRichTextToolbar.tsx ee/mobile/src/features/ticketRichText/bridge.ts ee/mobile/src/features/ticketRichText/helpers.ts ee/mobile/src/features/ticketRichText/types.ts ee/mobile/src/features/ticketRichText/TicketRichTextEditor.test.ts ee/mobile/test/mocks/react-native.ts ee/mobile/test/mocks/react-native-webview.ts ee/mobile/vitest.config.ts ee/mobile/vitest.setup.ts ee/mobile/metro.config.js packages/tickets/src/lib/ticketMobileEditorRuntime.ts --max-warnings=0`
- (2026-03-10) Validation note:
  - `react-test-renderer` emits an upstream deprecation warning on stderr under React 19 during the wrapper tests, but the tests themselves pass and there is no current mobile-native testing library in this app to replace it.
- (2026-03-10) Ticket screen rich-flow implementation/validation:
  - `sed -n '1,260p' ee/mobile/src/screens/TicketDetailScreen.tsx`
  - `sed -n '1445,1910p' ee/mobile/src/screens/TicketDetailScreen.tsx`
  - `cd ee/mobile && npx tsc --noEmit`
- (2026-03-10) Ticket screen section test coverage:
  - `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.richTextSections.test.ts --config vitest.config.ts`
  - `cd ee/mobile && npx vitest run src/features/ticketRichText/TicketRichTextEditor.test.ts src/screens/TicketDetailScreen.richTextSections.test.ts --config vitest.config.ts`
- (2026-03-10) Validation note:
  - The section tests mock `TicketRichTextEditor`, `Badge`, and `PrimaryButton` so they verify the ticket screen’s read/edit/compose wiring without retesting the WebView runtime internals.
- (2026-03-10) Validation note:
  - `TicketRichTextEditor.test.ts` now also covers the dev-only diagnostics path by asserting ready-timing and request-timeout logs appear when `__DEV__` is true and stay silent when `__DEV__` is false.
- (2026-03-11) Rich read-only rendering checkpoint:
  - `npm install @tiptap/extension-image@^3.0.0 --save`
  - `cd ee/mobile && npm run generate:ticket-editor`
  - `cd packages/tickets && npx vitest run src/lib/ticketMobileEditorRuntime.test.ts --config vitest.config.ts`
  - `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.richTextSections.test.ts src/features/ticketRichText/TicketRichTextEditor.test.ts --config vitest.config.ts`
  - `cd ee/mobile && npx tsc --noEmit`
- (2026-03-11) Ticket screen behavior coverage checkpoint:
  - `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.richTextBehaviors.test.ts --config vitest.config.ts`
  - `cd ee/mobile && npx tsc --noEmit`
- (2026-03-11) Legacy guard-path coverage checkpoint:
  - `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.richTextSections.test.ts src/screens/TicketDetailScreen.richTextBehaviors.test.ts --config vitest.config.ts`
  - `cd ee/mobile && npx tsc --noEmit`
  - `cd server && npx vitest run src/test/e2e/api/tickets.e2e.test.ts`

## Links / References

- Key files:
  - `ee/mobile/src/screens/TicketDetailScreen.tsx`
  - `ee/mobile/src/api/tickets.ts`
  - `server/src/lib/api/services/TicketService.ts`
  - `server/src/lib/api/services/ticketRichRender.ts`
  - `server/src/lib/api/schemas/ticket.ts`
  - `packages/tickets/src/lib/ticketRichText.ts`
  - `packages/tickets/src/lib/index.ts`
  - `packages/tickets/src/lib/ticketMobileEditorBridge.ts`
  - `packages/tickets/src/lib/ticketMobileEditorRuntime.ts`
  - `packages/tickets/vitest.config.ts`
  - `ee/mobile/metro.config.js`
  - `ee/mobile/scripts/generate-ticket-mobile-editor-html.mjs`
  - `ee/mobile/scripts/ticket-mobile-editor-browser-entry.ts`
  - `ee/mobile/src/features/ticketRichText/TicketRichTextEditor.tsx`
  - `ee/mobile/src/features/ticketRichText/TicketRichTextToolbar.tsx`
  - `ee/mobile/src/features/ticketRichText/bridge.ts`
  - `ee/mobile/src/features/ticketRichText/helpers.ts`
  - `ee/mobile/src/features/ticketRichText/types.ts`
  - `ee/mobile/src/features/ticketRichText/generatedEditorHtml.ts`
  - `ee/mobile/src/features/ticketRichText/TicketRichTextEditor.test.ts`
  - `ee/mobile/test/mocks/react-native-webview.ts`
  - `ee/mobile/src/screens/TicketDetailScreen.tsx`
  - `ee/mobile/src/screens/TicketDetailScreen.richTextSections.test.ts`
  - `ee/mobile/src/screens/TicketDetailScreen.richTextBehaviors.test.ts`
  - `packages/ui/src/editor/RichTextViewer.tsx`
  - `packages/formatting/src/blocknoteUtils.ts`
  - `server/src/test/unit/api/ticketRichRender.responseSchema.test.ts`
  - `server/src/test/unit/api/ticketRichRender.helper.test.ts`
  - `server/src/test/unit/api/ticketService.richRender.contract.test.ts`
- Related plan:
  - `ee/docs/plans/2026-03-09-ticket-description-rich-text-cutover/PRD.md`
- External references used during research:
  - Expo DOM components docs
  - react-native-webview docs
  - Tiptap React docs
  - BlockNote supported formats docs

## Open Questions

- Is heading support required in the initial mobile toolbar, or should v1 remain limited to inline formatting and lists?
- Is rendering saved image content sufficient for v1, or do we need image insertion support in the first mobile editor release?
- Is rendering existing mentions sufficient for v1, or do we need mobile mention authoring in the first release?

## Recent Progress

- (2026-03-11) Completed `F022` by preserving image-backed content in the mobile runtime and wiring read-only description/comment surfaces to hand external link taps back to native `Linking`.
- (2026-03-11) Completed `T023`, `T028`, and `T029` with component coverage for malformed description fallback, comment-link handoff, and image-backed comment routing, plus runtime coverage that serialized image blocks survive read-only initialization.
- (2026-03-11) Completed `F025` by adding behavior-level screen tests for description save/cancel plus comment draft persistence/send flows on top of the existing helper, bridge, runtime, wrapper, and section coverage.
- (2026-03-11) Completed `T025`, `T026`, `T031`, and `T032` in `ee/mobile/src/screens/TicketDetailScreen.richTextBehaviors.test.ts`.
- (2026-03-11) Completed `T039` and `T041` with legacy-content guard coverage at the mobile screen layer: plain-text descriptions still seed the editor and save back serialized JSON, while plain-text comments remain viewable through the read-only wrapper path.

## Current Blockers

- (2026-03-11) `server/src/test/e2e/api/tickets.e2e.test.ts` is currently skipped wholesale by the existing local server/e2e harness in this environment, so the new DB-backed API round-trip assertions for serialized rich descriptions/comments compile but do not execute here. `T038` and `T040` remain blocked pending a runnable server e2e environment.
