# Fix: long-text service request fields reject typed input

Ticket: alga-2026-0002584 (Discord report from Eric, 2026-09-24).

## Problem

In a published client portal service request form, typing into a long-text field does nothing. Other field types work.

### Root cause (confirmed by reading the code)

`packages/ui/src/components/TextArea.tsx:34` destructures `value = ''`. Line 165 then always renders `<textarea value={value}>`, so the textarea is always controlled. A caller that leaves out `value` gets a textarea locked to `''`. `handleInput` (lines 124–132) only forwards `onChange` and never stores the typed text, so React puts the DOM value back to `''` on every keystroke. Any `defaultValue` reaches the DOM through `{...props}` (line 169), but React ignores it because `value` is also set, and it logs a warning about having both.

`server/src/app/client-portal/request-services/[definitionId]/RequestServiceForm.tsx:109-116` renders long-text fields as `<TextArea name defaultValue rows>`, with no `value` and no `onChange`. That hits the bug above.

### Other consumers with the same bug

A scan of every `<TextArea` JSX use found four that leave out `value`:

| Site | Pattern | Effect today |
|---|---|---|
| `server/.../RequestServiceForm.tsx:109` | `defaultValue`, native form submit | **The reported bug** |
| `packages/documents/src/components/DocumentForm.tsx:175` | react-hook-form `{...register('content')}` (ref + onChange + name, no value) | **Same bug**: Content cannot be typed. It is also a required field. |
| `server/src/app/msp/test/ui-kit/page.tsx:1233` | Bare `<TextArea>` | Cannot type (internal showcase page only) |
| `packages/surveys/src/components/templates/SurveyPreviewPanel.tsx:97` | `disabled` | No visible effect |

Every other consumer (about 130 files) passes `value=` explicitly, and they all work today.

## Approach

Fix the shared component, not the call site. `TextArea` should follow React's rule: it is controlled only when the caller passes a `value` prop. This fixes the service request form and DocumentForm together. Adding `useState`/`onChange` to `RequestServiceForm` would only hide the bug at one call site.

### Keeping controlled consumers exactly as they are

Some controlled callers pass `value={maybeUndefined}`, for example `QuoteForm.tsx:1429` with `value={form.description}`. A plain "controlled when `value !== undefined`" rule would turn these into uncontrolled inputs whenever the value is undefined. That causes React's uncontrolled→controlled warning and can leave stale text in the DOM. To avoid this, decide based on whether the prop key is present:

- `isControlled = Object.prototype.hasOwnProperty.call(props, 'value')`. A JSX attribute `value={undefined}` still puts the key in props, so every current controlled caller is still controlled and still falls back to `''`, exactly as today.
- Only callers that leave out `value` entirely become uncontrolled. Those are exactly the broken sites in the table above.

## Changes, in order

1. **`packages/ui/src/components/TextArea.tsx`**
   - Take the full props object (`function TextArea(allProps)`), then destructure. Drop the `value = ''` default and work out `isControlled` from whether the key is present.
   - Controlled: render `value={value ?? ''}`. Behavior stays the same as today.
   - Uncontrolled: do not pass `value`. Pass `defaultValue` through (it already flows via `...props`). Keep a small internal mirror (`useState` seeded from `defaultValue`, updated in `handleInput`). Use it only to feed autosize (the `useLayoutEffect` dependency, lines 92–96) and UI-reflection metadata (lines 99–122). It must never be passed back to the DOM as `value`.
   - Keep `handleInput` calling `adjustHeight` and forwarding `onChange`. Keep `mergedRef`, so react-hook-form's `register` ref still receives the node.
   - Existing prop order stays the same: `{...finalAutomationProps}{...props}` after `value`/`onChange`. `rows` from callers still overrides `rows={1}`.
2. **`packages/ui/src/components/TextArea.test.tsx`** (new; jsdom, mock `useAutomationIdAndRegister` the same way `CurrencyInput.test.tsx` does)
   - Uncontrolled, no props: typing with `@testing-library/user-event` updates the DOM value.
   - Uncontrolled with `defaultValue`: the initial text shows and can be edited. No "both value and defaultValue" console error (spy on `console.error`).
   - Uncontrolled with `onChange` only (the react-hook-form shape): the handler receives the typed text and the DOM keeps it.
   - Controlled with `value` + `onChange` in a stateful harness: typing updates the value.
   - Controlled with `value` and no-op `onChange`: the DOM stays at the prop value. This locks in the controlled contract.
   - Controlled with `value={undefined}`: renders `''` and stays controlled. No uncontrolled→controlled warning when it later receives a string.
   - The forwarded ref receives the textarea element.
3. **`server/src/app/client-portal/request-services/[definitionId]/RequestServiceForm.test.tsx`** (new; jsdom)
   - Render with a long-text field (optional) and a required long-text field that has an initial value. The `action` is a `vi.fn()`.
   - Type into the empty field with user-event. Check that the DOM shows the text. Append text to the defaulted field.
   - Submit through the `request-service-submit` button. Check that the `FormData` given to `action` holds the typed value for field 1 and the default plus the appended text for field 2. (React 19 calls function `action` props with `FormData`. If jsdom cannot do this reliably, fall back to `new FormData(form)` on submit, which is the same payload the browser sends.)
   - Blank required long-text: the form keeps `noValidate`, so required checking stays on the server (`submissionService.ts:184-205` trims and rejects empty values). This case needs no client change. Note it in the test file; do not duplicate the server logic.
4. **`RequestServiceForm.tsx`**: no functional change needed. Keep `defaultValue` + `name`, so native `FormData` submission keeps working. The only optional cleanup is to drop the `: ''` fallback in favor of `undefined`. That is cosmetic and can be skipped.
5. **DocumentForm regression check**: add one test case to the TextArea suite for the register shape (covered in step 2). If the documents package already has a DocumentForm test harness, also add a behavioral case there to confirm Content can be typed and submitted.
6. Run: `cd packages/ui && npx vitest run src/components/TextArea.test.tsx`, the new server test, the existing `page.test.tsx`, and a typecheck of `packages/ui` and `server`.
7. Manual smoke test on dev port 3465: client portal → Request Services → a published definition with long-text fields (starter templates in `starterTemplateProvider.ts` have several). Type, submit, and confirm the answer shows in the created submission/ticket. Also check Documents → new document → the Content field.

## Out of scope

- Redesigning `TextArea`, or making it `forwardRef`-based. It already takes `ref` as a React 19 prop.
- Aligning `Input` with this pattern. `Input` has no `''` default and already supports `defaultValue`.
- Client-side required validation for service request forms. The server already enforces it, and the form sets `noValidate` on purpose.
- The ui-kit showcase page and SurveyPreviewPanel. The component fix covers them, and they need no edits.

## Risks

- **Controlled callers that don't pass a `value` key but expect a controlled `''`**: none found. All four no-`value` sites are listed above. A wrapper that builds props without a `value` key and forwards them would become uncontrolled. The scan found no such wrapper.
- **UI-reflection metadata** for uncontrolled textareas now reports the mirrored typed value. Today it reports `''`. This is harmless and more accurate.
- **Autosize** for uncontrolled mode depends on the mirror state and `handleInput`. If a parent resets the form (for example `form.reset()`), the DOM changes without an input event, so the height can be stale until the next keystroke. This is acceptable, and matches what happens with any uncontrolled textarea.
- **React 19 form `action` in jsdom**: step 3 includes a fallback if React's action dispatch does not fire in the test environment.
