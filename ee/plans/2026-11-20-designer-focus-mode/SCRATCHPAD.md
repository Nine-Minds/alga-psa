# Scratchpad — Designer focus mode

- Plan slug: `designer-focus-mode`
- Created: `2026-11-20`

## Decisions

- (2026-11-20) **Scope is five screens**: service request form builder, invoice / quote / document layout designers, workflow designer. Project boards, dispatch, schedule, Run Studio are a follow-up.
- (2026-11-20) **Remember the choice per user and per designer, the same way view modes are saved** (user request; replaces the first draft's browser-only `localStorage` flag). `useUserPreference<boolean>` with key `designer_focus_mode_<designer>`, default `false`. First visit is always the normal layout.
- (2026-11-20) **The ui primitive holds no storage.** `packages/ui` sits below `packages/user-composition`, so `DesignerFocusSurface` is controlled (`focused` / `onFocusedChange`) and a thin `useDesignerFocusPreference(designer)` hook in `packages/user-composition/src/hooks/` supplies the value. Hosts wire the two together.
- (2026-11-20) **Overlay, not shell-level chrome hiding.** The surface becomes `fixed inset-0`. Reasons: the billing designers sit inside page tabs and cards, so hiding only the sidebar and header would leave that clutter; and it works in `DefaultLayout` and `AlgaDeskMspShell` without touching either.
- (2026-11-20) **`z-40`, not the current `z-50`.** The AI chat panel is `fixed z-[45]` inside the shell (`RightSidebar.tsx:61,77`, `ee/.../RightSidebarContent.tsx:454`) and would open behind a `z-50` surface.
- (2026-11-20) **Same DOM node in both modes.** Class switch only. A portal would remount the subtree and drop undo history and unsaved state.
- (2026-11-20) **Shortcut is `mod+.`**, not Escape. Escape is `editor.cancel` (deselect) in the designers. Nothing in the catalog binds `mod+.` today.
- (2026-11-20) **Billing shell reads focus state from context**, not props. `<DesignerShell />` is rendered with no props in three hosts and in many tests; a context with a not-focused default keeps all of them working.

- (2026-11-20) **Quote layout editor is reorganised to match the invoice layout editor** (user request): one card, one compact header row with back, title, Template Name, Version, saved status, Close, Save Layout. Description, Layout Details card and footer go. Name and version stay on screen and editable in focus mode. This replaces the earlier default of hiding the details card while focused. Built as its own group (`quote-editor-header`) before focus mode is wired into the quote editor.
- (2026-11-20) **Document layout editor is reorganised the same way** (user request), as its own group `document-editor-header` after the quote one. The label-only settings (label class, field checkboxes) do not fit in a header row, so they go behind a Label settings popover shown only for work-tag layouts. The document type moves from the title into the back label ("Back to <Type> Layouts"), matching "Back to Invoice Layouts" / "Back to Quote Layouts".

## Discoveries / Constraints

- (2026-11-20) Per-user preference mechanism: `packages/user-composition/src/hooks/useUserPreference.ts`. It renders the default first, reads `localStorage` in an effect, then calls `getUserPreference(userId, key)` and lets the server value win; `setValue` writes `localStorage` immediately and debounces `setUserPreference` (500 ms). Actions are in `packages/user-composition/src/actions/userQueryActions.ts:414,473`. Existing view-mode keys are snake_case (`project_detail_view_mode`, `documents_view_mode`, `client_list_view_mode`).
- (2026-11-20) Two quirks of that hook matter here:
  - `setValue` only saves to the server once `isUserLoggedIn` is true, which is set by the load effect. A toggle before the load finishes is not saved, and the loaded value then overwrites it. `useDesignerFocusPreference` has to hold an early toggle and re-apply it after `hasResolved` (FR-J4).
  - The `localStorage` cache key is the preference key, with no user id. A server value of `null` leaves the cached value in place, so a second user on the same browser inherits the first user's choice until they toggle. Same as view modes today; listed as a risk, not fixed here.
- (2026-11-20) `packages/billing` already imports `@alga-psa/user-composition/hooks` (`ContractReports.tsx:30`). `server/` has its own older copy at `server/src/hooks/useUserPreference.ts` without `hasResolved`; use the package hook. `ee/server` imports `@alga-psa/user-composition` only from API routes so far, so confirm the hooks subpath resolves from `WorkflowDesigner.tsx`.
- (2026-11-20) Import the hook by module path (`@alga-psa/user-composition/hooks/useDesignerFocusPreference`), not the hooks barrel; the package exports `./hooks/*`.
- (2026-11-20) Today's takeover is one line: `ServiceRequestFormBuilderPage.tsx:93-96`, `fixed inset-0 z-50`. Its comment says the chrome left the canvas unusable at 1280 px.
- (2026-11-20) Form builder widths: `DesignerPalette` is 280 expanded / 32 collapsed, plus `py-3 pl-3` in the shell; inspector default 420, min 360, max 760 (`designerSidebarSizing.ts`). App sidebar is `w-64` open, `w-16` collapsed (`Sidebar.tsx:321`). `main` adds `px-3`.
- (2026-11-20) The MSP shell root is `fixed inset-0` (`DefaultLayout.tsx:442`, `AlgaDeskMspShell.tsx:72`), so it is its own stacking context. Anything portaled to `<body>` (Dialog `z-[70]`, Drawer `z-50`, toaster, CustomSelect `z-[10001]`, Tooltip `z-[9999]`) renders above the whole shell, including a focused surface.
- (2026-11-20) No `transform`, `filter` or `contain` found on `Body`, `Card` (`card-elevated` is a box-shadow only) or `.app-shell-ground`. Radix `Tabs.Content` adds none.
- (2026-11-20) Billing `DesignerShell` root: `DesignerShell.tsx:2517`, `h-[calc(100vh-24.75rem)] min-h-[480px]`. Hosts:
  - `InvoiceTemplateEditor.tsx:293` (`<Card>`), header actions `:335-340`, shell reached through `DesignerVisualWorkspace.tsx:340`.
  - `quotes/QuoteDocumentTemplateEditor.tsx:529`, button group `:543`, details card `:562`, shell `:610`.
  - `documents/DocumentTemplateEditor.tsx:393`, button group `:408`, details card `:429`, shell `:555`.
- (2026-11-20) Invoice header to copy: `InvoiceTemplateEditor.tsx:293-350` (`<Card>`, `<CardHeader className="pb-3">`, one `flex flex-wrap items-center gap-x-4 gap-y-2` row, `BackNav`, `h2.text-lg`, name input with `containerClassName="flex-1"`, `aria-live` saved status, Close, Save). Its comment: one compact row leaves the rest of the window to the designer so the page never scrolls.
- (2026-11-20) Quote editor today (`QuoteDocumentTemplateEditor.tsx`): header block `:530-553`, details card `:562-588` (name and version inputs have no ids), footer with Created / Last Updated `:848-857`. `handleBack` at `:87` is `onBack` or push to `/msp/billing?tab=quote-templates`; `QuoteDocumentTemplatesPage.tsx:276` passes `onBack`. `BackNav` navigates by `href` and goes through `UnsavedChangesContext`, so check it can take the editor's `onBack` or use a plain button styled the same.
- (2026-11-20) The billing shell's `24.75rem` height budget was tuned for the invoice editor's compact header. Once the quote header matches, the quote Design view should fit on the billing tab; `/msp/quote-document-templates` has different page chrome above it and needs its own check.
- (2026-11-20) Quote editor strings are in `msp/quotes` under `templateEditor.*`.
- (2026-11-20) Document editor today (`DocumentTemplateEditor.tsx`): header block `:394-415`, details card `:429-503`, footer `:753-772`. `isLabelTemplate = documentType === 'work-tag'` (`:136`); label controls are `#document-template-label-class-select` and `#document-template-label-field-<field>`. Back is `onCancel` (prop, `:79`). Strings are in `msp/invoicing` under `documentTemplates.editor.*`. One existing suite: `DocumentTemplateEditor.existingDocument.test.tsx`.
- (2026-11-20) `Popover` is in `@alga-psa/ui/components/Popover` (`z-50`, portaled). `CustomSelect` content is `z-[10001]`, so the label class dropdown opens above the popover. Check that picking an option does not count as an outside click and close the popover.
- (2026-11-20) Each billing host nests the shell inside two tab sets (Visual / Code, then Design / Transforms / Preview). In focus mode every level needs `flex-1 min-h-0 flex flex-col`.
- (2026-11-20) The invoice editor's Code tab is a Monaco editor whose height comes from `getBoundingClientRect()` in an effect (`InvoiceTemplateEditor.tsx:157-175`). It must rerun on toggle.
- (2026-11-20) The document editor is local state inside `DocumentTemplatesPage.tsx` (`view.mode === 'editor'`); the URL does not change. One namespace covers all document types.
- (2026-11-20) Workflow designer root `WorkflowDesigner.tsx:5886`; header `:5887`; designer-mode action group `:5906`. Floating panels are positioned from `designerFloatAnchorRect`, kept current by a `ResizeObserver` plus window resize / scroll listeners (`:1574-1591`), so a toggle should re-anchor them without extra code. Graph view is `h-[650px]` at `:5632`; properties panel `max-h-[calc(100vh-220px)]` at `:4135`.
- (2026-11-20) `Body.tsx:14-16` already locks body scroll for `/msp/workflow-editor`.
- (2026-11-20) Only the invoice designer and `TextEditor` push the `editor` shortcut scope. The form builder uses a raw `window` keydown listener and the workflow designer pushes none. Hence page scope for the new shortcut.
- (2026-11-20) `themeContract.paletteBaseline.ts` pins hard-coded palette class counts per file: billing `DesignerShell.tsx` at 223, `DesignerPalette.tsx` at 3, `DesignerPaletteItem.tsx` at 9. Do not add `slate-*` / `gray-*` classes.
- (2026-11-20) Locales: `de en es fr it nl pl pt sv` plus pseudo `xx yy`. Spanish is usted-only. `keyboard-shortcuts/i18n.contract.test.ts` requires key parity and a label for every catalog action.
- (2026-11-20) `ee/server` component tests are not in the PR-gated lane.
- (2026-11-20, implementation) `@alga-psa/user-composition/hooks/*` resolves from `ee/server`: the package's exports map carries `./hooks/*` and `tsconfig.base.json` maps `@alga-psa/user-composition/*` to its `src/*`, so the workflow designer imports the hook the same way its API routes already import `./actions`.
- (2026-11-20, implementation) Seven `ee/server` workflow-designer suites already fail locally on this machine (`window.localStorage.clear is not a function` — the Node 22 unconfigured-`localStorage` quirk that `packages/ui/vitest.setup.ts` patches and `ee/server` does not). Verified identical with this change reverted; the new `WorkflowDesignerFocusMode.test.tsx` installs an in-memory Storage of its own.
- (2026-11-20, implementation) The document editor's own root carried the `p-6` page margin its list view uses; folding it into one card moved that margin onto the focus surface, which drops it when focused.
- (2026-11-20, implementation) FR-H7 / FR-I6 cannot hold on the shell's viewport budget. Measured in the browser: the quote editor leaves 390px of chrome around `h-[calc(100vh-24.75rem)] min-h-[480px]`, so the page scrolls at 900px tall (the `min-h` floor alone overflows an 800px window), and the budget cannot cover both of the editor's routes, a header row that wraps, and the layout's dismissable banners. The quote and document editors now measure the room their Design view actually has (`useFitToAvailableHeight`) and the shell takes `fillParent` to fill it; the invoice designer keeps the viewport budget untouched. Verified headless at 1440x900 with both integration banners shown: page overflow 0.

## To verify during implementation

- **Answered (2026-11-20, implementation).** A page-scope action does **not** fire under a pushed `editor` scope: `isScopeEligible` drops page-scope candidates whenever `panel`, `dialog` or `editor` is anywhere in the stack, and `allowInEditable` has no bearing on it. The catalog entry stays at page scope (it is what the help dialog and the settings panel list), and `DesignerFocusSurface` registers the same resolved binding a second time under an internal id (`designer.toggleFocusModeInEditor`) at editor scope — the registry is keyed by action id, so one id cannot hold two scopes. The two are never eligible at once, and the clone follows the user's own binding and disabled flag. Covered by `designer-focus-mode.test.tsx` ("fires while the editor shortcut scope is active").
- Still open (browser): whether `mod+.` reaches the page in Chrome, Safari and Firefox on macOS and Windows.
- Still open (browser): the sidebar tooltip (`Sidebar.tsx:417`, `z-50`) is inside the sidebar; confirm it never shows over a focused surface.
- Still open (browser): whether the Preview and Transforms tabs carry fixed heights that look wrong at full window size. In focus mode each scrolls inside the surface (`min-h-0 flex-1 overflow-y-auto`), so a fixed inner height shows as empty space rather than a page scroll.

## Commands / Runbooks

- UI package tests: `cd packages/ui && npx vitest run src/components/designer`
- Preference hook tests: `cd packages/user-composition && npx vitest run src/hooks`
- Form builder tests: `cd server && npx vitest run src/app/msp/service-requests/form-builder`
- Billing designer tests: `cd packages/billing && npx vitest run src/components/invoice-designer src/components/billing-dashboard`
- Shortcut contract tests: `cd packages/ui && npx vitest run src/keyboard-shortcuts`
- Routes for the browser pass:
  - `/msp/service-requests/<definitionId>/form-builder`
  - `/msp/billing?tab=invoice-templates&templateId=<id>`
  - `/msp/billing?tab=quote-templates&templateId=<id>` and `/msp/quote-document-templates?templateId=<id>`
  - `/msp/document-templates/<type>` → edit a layout
  - `/msp/workflow-editor/<workflowId>`

## Links / References

- Shared designer kit: `packages/ui/src/components/designer/`
- Shortcut catalog: `packages/ui/src/keyboard-shortcuts/catalog.ts`
- Form Studio PR: #4440

## Open Questions

- None blocking. See PRD "Open Questions" for the three defaults.
