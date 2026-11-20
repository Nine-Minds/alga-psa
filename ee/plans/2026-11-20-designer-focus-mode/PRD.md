# PRD — Designer focus mode

- Slug: `designer-focus-mode`
- Date: `2026-11-20`
- Status: Draft

## Summary

Every designer screen opens inside the normal MSP layout, with the sidebar and header visible, and carries a **Focus mode** button. Focus mode expands the designer to the whole window so nothing competes with the canvas. The choice is remembered per user and per designer, stored on the user's account the same way view-mode preferences are.

Five screens get it: the service request form builder, the invoice, quote and document layout designers, and the workflow designer. All five use one shared primitive in the designer kit.

The quote and document layout editors are also reorganised to match the invoice layout editor: one compact header row holding the name, version and actions, so the whole job of editing a layout happens on one screen, in either mode.

## Problem

The service request form builder takes over the whole window the moment it opens. The sidebar and header disappear without the user asking, which reads as a jump to a different application. There is no way back to the normal layout except leaving the builder.

The other designers have the opposite problem. They never leave the app chrome, so the canvas is whatever is left after the sidebar, header, page header, tabs and cards:

- The invoice, quote and document layout designers share a shell sized as `h-[calc(100vh-24.75rem)]`. Almost 400 px of window height goes to chrome.
- The workflow designer's graph view is a fixed 650 px tall regardless of the window.

Nothing in the product offers a maximize or focus control for any of them.

The quote and document layout editors spend more of the window than they need to before the designer starts: a large page title with a description, a full-width Layout Details card for two fields, and a footer with dates. The invoice layout editor already fits the same information into one row.

## Goals

- A designer always opens in the normal layout the first time a user visits it.
- One click, or one shortcut, expands the designer to the full window and back.
- Toggling never loses work: unsaved edits, undo history, selection and scroll position survive.
- The choice is remembered per user and per designer, through the same user-preference mechanism as view modes. A user who prefers focus mode in the invoice designer gets it there, on any browser they sign in from, and nowhere else.
- The same control, label, icon and shortcut on all five screens.
- In focus mode the canvas uses the reclaimed space. No designer keeps a height that assumed the chrome was there.
- A user can open a quote or document layout and do everything on that screen: rename it, change its version, design, preview and save. Nothing needed for the job is hidden in focus mode or pushed below the fold in the normal layout.

## Non-goals

- Focus mode for project boards, Gantt, technician dispatch, the schedule calendar, Workflow Run Studio or the knowledge-base article editor. They are candidates for a follow-up.
- Expanding drawers or dialogs (document editor drawer, email template dialog). That is a different control.
- Extension pages. They have no toolbar to hold a toggle.
- Moving the invoice or workflow designer onto the shared `DesignerShell`. Each keeps its own three-pane layout.
- The browser Fullscreen API. Focus mode hides the app chrome, not the browser chrome.
- The client portal.
- Fixing the `h-screen` sizing in dispatch and Run Studio.

## Users and Primary Flows

**MSP admin or billing manager editing a layout, form or workflow.**

1. **First visit.** The user opens a designer. It renders inside the normal layout. A Focus mode button sits in the designer's toolbar.
2. **Enter.** The user clicks the button or presses `Cmd/Ctrl + .`. The designer fills the window. The button shows as pressed and its label changes to Exit focus mode.
3. **Work.** Save, publish, back, tabs, undo and every dialog behave as before. The AI chat panel still opens over the designer.
4. **Exit.** The same button or shortcut returns to the normal layout with the work intact.
5. **Return visit.** The designer opens in whichever mode the user left it, on this or another browser. Other designers and other users are unaffected.
6. **Leave.** Navigating away with the designer's own back control lands on a normal page with the sidebar and header.

## UX / UI Notes

- **Toggle.** An icon button with a tooltip. `Maximize2` when off, `Minimize2` when on. `aria-pressed` reflects the state. The tooltip includes the shortcut.
- **Placement.** In each designer's existing toolbar or header action group, to the left of the primary save or publish action:

  | Designer | Location |
  |---|---|
  | Form builder | builder toolbar, before Publish |
  | Invoice layout | editor header, before Close |
  | Quote layout | editor header, before Close |
  | Document layout | editor header, before Close |
  | Workflow designer | header action group in designer mode |

- **No animation.** The switch is immediate in both directions.
- **Restoring the choice.** The designer first renders in the normal layout, applies the locally cached choice as it mounts, and then the account value once it loads. On a browser the user has used before, the two agree and the switch happens within a frame. On a new browser the designer can show the normal layout until the account value arrives. This is how view-mode preferences behave today and is accepted.
- **Form builder at narrow widths.** In the normal layout at 1280 px with the app sidebar open, the canvas is about 284 px wide with the palette open (1280 − 256 sidebar − 24 padding − 292 palette − 424 inspector). With the palette collapsed it is about 532 px. The palette therefore starts collapsed while the builder is narrower than 1100 px, and expands again when the builder gets wider, including on entering focus mode. Once the user collapses or expands the palette by hand, their choice holds for that visit.
- **Quote layout editor header.** The editor becomes one card with a single header row, the same arrangement as the invoice layout editor:

  `[Back to Quote Layouts]  Edit Layout: <name>  Template Name [__________]  Version [__]  Saved <time>  [focus]  [Close]  [Save Layout]`

  - The title is a compact heading, not a page-level title, and it truncates before it pushes the row onto a second line. A new layout reads "New Quote Layout".
  - The name input takes the spare width. Version is a narrow number input.
  - "Saved <time>" replaces the footer's Last Updated line and reads "Not saved yet" for a new layout. The created date is its tooltip.
  - The page description, the Layout Details card and the footer are removed.
  - The row wraps on narrow windows instead of overflowing.
  - The row is the same in the normal layout and in focus mode. Every field stays editable in both.
- **Quote layout editor fit.** In the normal layout the Design view fits the window without the page scrolling, as the invoice editor does.
- **Document layout editor header.** The same card and header row as the quote editor:

  `[Back to <Type> Layouts]  Edit Layout: <name>  Template Name [__________]  Version [__]  [Label settings]  Saved <time>  [focus]  [Close]  [Save Layout]`

  - The document type moves from the title into the back navigation label, as "Invoice" and "Quote" do in the other two editors. A new layout reads "New <Type> Layout".
  - The page description, the Layout Details card and the footer are removed. The created date becomes the saved status's tooltip.
  - **Label settings** appears only for work-tag (label) layouts. It opens a popover holding the label class select, the field checkboxes and their hint, unchanged in behaviour.
  - The row is the same in the normal layout and in focus mode, and the Design view fits the window in the normal layout.
- **Invoice layout designer in focus mode.** The compact header row (back, title, name, save status, Close, Save) stays. The card loses its border, radius and shadow.
- **Workflow designer.** The toggle appears only in designer mode, not on the workflow list or control panel.

## Requirements

### Functional Requirements

**FR-A — Shared primitive** (`packages/ui/src/components/designer/`)

The primitive holds no storage. It is told whether it is focused and reports when that should change, so it stays usable below the user-preference layer.

- **FR-A1.** `DesignerFocusSurface` takes `focused` and `onFocusedChange`.
- **FR-A3.** `DesignerFocusSurface` renders one element in both modes. Unfocused it carries the host's classes. Focused it becomes `fixed inset-0 z-40` with the page background and a flex column. The element is never remounted by a toggle. It exposes `data-focus-mode="on" | "off"`.
- **FR-A4.** The surface provides a context. `useDesignerFocusState()` returns `{ isFocused, toggle }` for descendants and a not-focused, no-op value outside any surface.
- **FR-A5.** `DesignerFocusToggle` reads the context and renders the button described under UX. It takes an `id`.
- **FR-A6.** The surface registers the `designer.toggleFocusMode` shortcut while mounted.
- **FR-A7.** All of it is exported from `@alga-psa/ui/components/designer`.

**FR-J — Per-user preference** (`packages/user-composition/src/hooks/`)

- **FR-J1.** `useDesignerFocusPreference(designer)` returns `{ isFocused, setFocused, toggle }`. It is built on `useUserPreference<boolean>` with key `designer_focus_mode_<designer>` and a default of `false`.
- **FR-J2.** Each of the five designers has its own key. Changing one never changes another.
- **FR-J3.** The value is saved to the signed-in user's preferences and cached locally under the same key, exactly as `useUserPreference` does for view modes.
- **FR-J4.** A toggle made before the account value has loaded is kept and saved; the late-arriving value does not overwrite it.
- **FR-J5.** If the account value cannot be loaded or saved, the cached or default value is used and the toggle keeps working for the visit.
- **FR-J6.** Hosts pass the hook's result to the surface. Each host imports the hook by its module path, not through the hooks barrel.

**FR-B — Shortcut and strings**

- **FR-B1.** `designer.toggleFocusMode` is added to the shortcut catalog with `mod+.`, at page scope, allowed while an input is focused.
- **FR-B2.** The shortcut appears in the shortcut help dialog under the Editor group.
- **FR-B3.** Toggle labels live in the `common` namespace. The shortcut label and description live in `msp/keyboard-shortcuts`. All production locales and the pseudo-locales are filled.

**FR-C — Service request form builder**

- **FR-C1.** `ServiceRequestFormBuilderPage` no longer forces a full-window layer. The builder fills the content area of the normal layout.
- **FR-C2.** The builder is wrapped in the surface, driven by the `service_request_form` preference. The preference is read in the page component, so it is usually resolved before the builder's data has loaded. The toggle is in the builder toolbar.
- **FR-C3.** The palette follows the narrow-width rule under UX.
- **FR-C4.** Loading and error states render in the normal layout in both modes.
- **FR-C5.** The back link, autosave, draft restore banner, Try it mode and publish work in both modes.

**FR-D — Billing layout shell**

- **FR-D1.** The billing `DesignerShell` reads `useDesignerFocusState()`. Unfocused it keeps `h-[calc(100vh-24.75rem)] min-h-[480px]`. Focused it fills its parent.
- **FR-D2.** Rendered outside any surface, the shell behaves exactly as it does today.
- **FR-D3.** (operator feedback) Entering focus mode puts the canvas at 100%, including when a layout loads while focused. Leaving focus mode restores the zoom the page layout was working at. A zoom chosen by hand inside focus mode is left alone until focus ends, and the Fit button keeps working in both modes.

**FR-E — Invoice layout designer**

- **FR-E1.** `InvoiceTemplateEditor` is wrapped in the surface, driven by the `invoice_layout` preference. The toggle is in the header action group.
- **FR-E2.** In focus mode the header row stays fixed at the top and the Visual → Design shell fills the rest of the window.
- **FR-E3.** The Transforms, Preview and Code views scroll inside the surface in focus mode. The Code editor recomputes its height on toggle.

**FR-H — Quote layout editor header** (independent of focus mode; built first)

- **FR-H1.** `QuoteDocumentTemplateEditor` renders as one card: a compact header row, then the Visual / Code tabs. The page title block, description, Layout Details card and footer are removed.
- **FR-H2.** The header row holds, in order: back navigation, title, Template Name input, Version input, saved status, Close, Save Layout.
- **FR-H3.** Back navigation and Close both use the editor's existing back behaviour (`onBack`, else the quote layouts tab).
- **FR-H4.** Name and version keep their current behaviour: name is free text, version is an integer of at least 1, both disabled while loading.
- **FR-H5.** The saved status shows the last updated time, or "Not saved yet", and announces changes politely. The created date is available as its tooltip.
- **FR-H6.** A load or save error renders inside the header, under the row.
- **FR-H7.** In the normal layout the Design view fits the window with no page scroll, on both routes that host the editor.
- **FR-H8.** Loading, saving, new-from-standard defaults and the preview behave as before.

**FR-I — Document layout editor header** (independent of focus mode; built after FR-H)

- **FR-I1.** `DocumentTemplateEditor` renders as one card: a compact header row, then the Visual / Code tabs. The page title block, description, Layout Details card and footer are removed.
- **FR-I2.** The header row holds, in order: back navigation naming the document type, title, Template Name input, Version input, Label settings (work-tag layouts only), saved status, Close, Save Layout.
- **FR-I3.** Back navigation and Close both call the editor's `onCancel`.
- **FR-I4.** Name and version keep their current ids and behaviour.
- **FR-I5.** Label settings opens a popover with the label class select and the field checkboxes. Their ids, state and effect on the saved layout are unchanged. The popover stays open while its controls are used.
- **FR-I6.** The saved status, error placement and window fit follow FR-H5, FR-H6 and FR-H7.
- **FR-I7.** Loading, saving and the sample / existing-document preview behave as before, for every document type.

**FR-F — Quote and document layout designers**

- **FR-F1.** `QuoteDocumentTemplateEditor` is wrapped in the surface, driven by the `quote_layout` preference; `DocumentTemplateEditor` by `document_layout`. Each has the toggle in its header row before Close.
- **FR-F2.** In focus mode each editor keeps its whole header row, with name, version and (for labels) Label settings usable, and the Design shell fills the rest of the window.
- **FR-F3.** The quote editor behaves the same on both of its routes (`/msp/billing?tab=quote-templates…` and `/msp/quote-document-templates`).
- **FR-F4.** The document editor's choice is shared across document types.

**FR-G — Workflow designer (EE)**

- **FR-G1.** `WorkflowDesigner` is wrapped in the surface, driven by the `workflow` preference, when it renders in designer mode. The toggle is in the header action group.
- **FR-G2.** The floating palette and properties panels re-anchor after a toggle.
- **FR-G3.** In focus mode the graph view grows with the window instead of staying 650 px tall, and the properties panel may use the extra height.

### Non-functional Requirements

- **NFR-1.** Dialogs, drawers, toasts, selects, tooltips and the AI chat panel render above a focused surface.
- **NFR-2.** Every new interactive element has a kebab-case `id`.
- **NFR-3.** New shared files use theme tokens, not hard-coded palette classes.
- **NFR-4.** No user-visible text is hard-coded.

## Data / API / Integrations

One boolean user preference per designer, stored through the existing `getUserPreference` / `setUserPreference` actions:

| Designer | Preference key |
|---|---|
| Form builder | `designer_focus_mode_service_request_form` |
| Invoice layout | `designer_focus_mode_invoice_layout` |
| Quote layout | `designer_focus_mode_quote_layout` |
| Document layout | `designer_focus_mode_document_layout` |
| Workflow designer | `designer_focus_mode_workflow` |

No schema change, no new server action and no API change. The preference rows are created on first toggle.

## Security / Permissions

No change. Focus mode is a layout switch on screens the user can already open, and each user reads and writes only their own preference through the existing actions.

## Rollout / Migration

No flag and no migration. Existing form builder users land in the normal layout on their next visit, because no saved preference exists yet.

Suggested build order, one commit group each: primitive → shortcut and strings → form builder → billing shell and invoice editor → quote editor header → document editor header → quote and document editors → workflow designer.

## Risks

- **A transformed ancestor traps `position: fixed`.** None was found on the path from the MSP shell to any of the five hosts. Each screen still needs a browser check.
- **Flex chain through nested tabs.** The billing hosts nest the shell inside two tab sets. Every level needs to pass height down in focus mode.
- **Local cache is per browser, not per user.** `useUserPreference` caches under the preference key alone. A second user on the same browser can briefly see the first user's choice, and keeps it if they have never set their own. View-mode preferences behave the same way today.
- **Workflow designer tests are outside CI.** `ee/server` component tests do not gate PRs, so the workflow designer relies on a local run and a browser check.
- **Palette baseline test.** `themeContract.paletteBaseline.ts` pins a count of hard-coded palette classes per file, including the billing `DesignerShell`. Edits there must not add any.

## Open Questions

None blocking. Three defaults were chosen and can be changed during review:

1. In the quote and document editors the created date moves to a tooltip on the saved status.
2. Label-only settings sit behind a Label settings popover in the document editor's header.
3. The shortcut is `Cmd/Ctrl + .`.

## Acceptance Criteria (Definition of Done)

- A user with no saved preference opens each of the five designers and sees the sidebar and header.
- The toggle and `Cmd/Ctrl + .` enter and leave focus mode on each of the five.
- After entering focus mode on one designer and reloading, that designer opens focused and the other four do not.
- The same user signing in on a different browser finds that designer focused. A different user does not.
- The quote and document layout editors each show one header row with name, version, saved status, Close and Save, and no Layout Details card, description or footer.
- A quote or document layout can be renamed, re-versioned, designed, previewed and saved without leaving focus mode, and without scrolling the page in the normal layout's Design view.
- For a label layout, the label class and visible fields can be changed from Label settings in both modes, and the saved layout reflects them.
- Unsaved edits and undo history survive a toggle on each of the five.
- In focus mode on each of the five: a dialog, a dropdown, a toast and the AI chat panel all appear above the designer.
- In focus mode the invoice, quote and document shells and the workflow graph fill the window height with no page scroll on the Design view.
- At 1280 × 800 with the app sidebar open, the form builder opens with the palette collapsed and a usable canvas.
- All listed tests pass, and the shortcut help dialog lists the new shortcut in every locale.
