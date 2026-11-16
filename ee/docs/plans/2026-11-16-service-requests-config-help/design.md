# Design — Explain Visibility Configuration and Advanced Form Behavior (in-app help + docs)

Card `9879f1cf` · internal PSA `alga-2026-0003312` · branch
`feature/service-requests-explain-visibility-configuratio` · app `:3645`.
Step: Design Session (conn — XO desk).

## The triage is stale in one important place — correct it before building

The card's facts were taken on main @ `33187af9bc` (2026-10-20). Since then **`beb1af2f2d` and `46e488d7f2` landed
predicate-based audiences**, and the panel the customer read as "Visibility Config (JSON object)" no longer exists as raw
JSON:

- `ServiceRequestDefinitionEditorPage.tsx:1919` renders `ServiceRequestAudienceEditor` under
  `editor.execution.visibility.title` — a clients / client-tags / contact-tags / client-group picker whose own heading is
  **"Who can see this form"**.
- `editor.execution.visibility.config` / `.save` and `messages.error.visibilityNotObject` have **zero** references left
  (checked across `server/src`, `ee/server/src`, `packages`). They are dead locale keys.
- `visibilityConfig` survives only as plumbing (`definitionEditor.ts:39/190`, `definitionManagement.ts:308`,
  `actions.ts:496-505`, provider contracts) — the audience predicates read it. Leave it alone.

So fix item 1's first half ("clear names + help for each JSON panel") collapses to *naming*, and the surviving raw-JSON
panel is the one that actually hides and shows fields.

## The real defect is that the two panels' names are inverted

| Panel in the product today | What it actually does | Why it fails |
| --- | --- | --- |
| **Visibility Configuration** | Which client users may open the form at all | A reader expects field visibility. The customer guessed exactly this, and was wrong. |
| **Advanced Form Behavior** | Which *fields* appear in the form | The words never say "fields", the panel is a JSON textarea behind a `<details>`, and its only help sentence tells you to use "Show when…" instead. |

`FieldVisibilityEditor` (per-field **"Show when…"**) is already the good path and is where the rules actually belong.
Nobody needs to hand-write JSON to configure field visibility — but a power user can, and that panel is undocumented
except for one line.

Semantics the help must be exact about (read from `server/src/lib/service-requests/formVisibility.ts`):

- a field with no rule is **visible**; a field is visible when **every** rule naming it passes (AND, never OR);
- a rule's `source` may only be a field that appears **earlier** in the form — later fields cannot be read;
- a hidden field counts as empty, so hiding a controller hides its dependents;
- evaluation happens **server-side at page load** in the client portal (`portalDetail.ts:146-160`) — not live as the
  client types. That is the single most expensive thing to learn by trial and error.

## Design

### 1. Name each panel for what it does

| Key | Today | New |
| --- | --- | --- |
| `editor.execution.visibility.title` | "Visibility Configuration" | **"Who can see this form"** |
| `editor.execution.visibility.description` (new) | — | "Controls which client users can open this request. It does not show or hide answers inside the form." |
| `editor.execution.advanced.title` | "Advanced Form Behavior" | **"Show or hide fields (advanced)"** |
| `editor.form.visibility.advancedJson` | "Advanced (JSON)" | **"Edit as JSON"** |

Copy only; no key, provider or data-model change. The audience editor keeps its inner heading, so title and content now
agree.

### 2. The JSON panel explains itself, in place

`editor.execution.advanced.*` grows a help block between the section title and the `<details>` — short paragraphs, then
two copy-paste-able examples. Written as i18n keys, not prose in the component:

- **what it is** — "Field visibility and prefilled values, stored as JSON. Use **Show when…** on a field for the normal
  way to do this; this panel is for bulk edits and for `contextDefaults`, which have no other UI."
- **rules** — a `visibilityRules` entry is `{fieldKey, source, operator, value?}`; all conditions on a field must pass;
  a field with no condition is always shown; `source` must be a field that appears **earlier** in the form.
- **operators** — rendered **from `VISIBILITY_OPERATORS`** in `fieldVisibilityModel.ts` with `t()` labels, not retyped
  into the copy. That module and `formVisibility.ts` already carry two copies of the six-operator list with a
  `LEVERAGE: pattern visibility-operator-list` marker; a third copy in help text would be the one that drifts.
- **contextDefaults** — `{{clientId}}`, `{{contactId}}`, `{{requesterUserId}}` resolve for the requesting user at page
  load; show the one-object example.
- **when it is evaluated** — "Conditions and defaults are applied when the client opens the form. They are not
  re-evaluated as they type."
- **edition** — the JSON panel only exists with the Enterprise *advanced* form-behavior provider
  (`showAdvancedFormBehaviorConfigPanel`, `definitionEditor.ts:199`); say so, so a CE reader does not go looking.
- **one example per schema**, as a `<pre>` block with a copy button (existing `Button` + `toast`), because "worked
  example" is the acceptance bar and an example that cannot be copied is a picture, not an example:
  1. show a "Tell us more" field only when "Reason" equals "Other";
  2. hide "Company" when "I am the end user" is checked;
  3. prefill a hidden "Client" field with `{{clientId}}` (shows both keys together).

### 3. Remove what is dead

Delete `editor.execution.visibility.config`, `editor.execution.visibility.save`, `messages.error.visibilityNotObject`
and `messages.error.visibilityInvalid` (0 live callers — verify again at implementation, `visibilityInvalid` had 3 hits
that need checking one by one) from **every** locale, including pseudo-locales `xx`/`yy`. Keep
`editor.execution.advanced.save` (the JSON panel's own save) — it stays live.

### 4. Docs — different repository, so a separate PR

`nm-store` is a **sibling checkout** on the host (`~/nm-store/packages/nm-store/src/site/content/docs/
configure-ticket-routing-and-execution.md`, category 17.4), not a package of this repo. Today that page ends the
Execution section with one sentence that names both panels, explains neither, and repeats the stale naming:

> **Advanced:** The editor also exposes **Advanced Form Behavior** and **Visibility Configuration** sections for power
> users who need custom form logic or visibility rules.

Plan: this card authors the documentation as an in-repo file
**`ee/docs/service-requests/form-behavior-and-visibility-config.md`** — reviewable with the code and the copy-paste
source for the site — and the nm-store edit becomes a **named follow-up** (separate repository, separate PR, separate
release). Do not reach into the sibling checkout from this branch: a card's PR must be one repository, and the site's
editorial rules (`AGENTS.md` in nm-store) are not this branch's to satisfy.

The doc structure: what each panel controls (the same inverted-naming correction), the `visibilityRules` schema with an
operator table and the three examples, the `contextDefaults` placeholders, "only earlier fields count", "evaluated at
page load", edition requirements, and a pointer to **Show when…** as the recommended path.

### 5. Acceptance

An admin can configure either panel from the help text alone:
open `:3645`, create a service request, add a field, use **Show when…**, then open **Edit as JSON**, paste each example,
save, publish, and confirm the portal form behaves as the help describes — with no console or validation error.

## What we are deliberately NOT doing

- **No new JSON-to-picker UI for `visibilityRules`.** "Show when…" already is that picker, per field. A second
  bulk editor is a separate card, and building it here would leave the help text unowned.
- **No live re-evaluation** of conditions as the client types. That is a portal evaluation change with its own risks
  (and a stated limitation the help now simply tells the truth about).
- **No removal of the `visibilityConfig` plumbing**, no schema migration, no audience-editor changes.
- **No nm-store edit in this branch** (see 4).
- **No rewriting of the existing per-field "Show when…" copy** beyond what §1 changes.

## Order of work

1. Locale keys: renames, new help keys, dead-key removal, parity across all locales (incl. `xx`/`yy`).
2. Help block component in `ServiceRequestDefinitionEditorPage` (or a small `AdvancedFormBehaviorHelp.tsx` next to
   `FieldVisibilityEditor.tsx`), operators rendered from `VISIBILITY_OPERATORS`.
3. Example blocks with copy buttons; verify each example parses through the real save action.
4. `ee/docs/service-requests/form-behavior-and-visibility-config.md`.
5. Tests (below) + a Prepare Human Review checklist item for the live walkthrough, and the nm-store follow-up named on
   the card.

## Tests

- **Unit** — the help's operator list is generated from `VISIBILITY_OPERATORS` (a test that adds a fake operator and
  sees it appear would be over-engineering; instead assert the rendered list length equals the exported table's and
  that every entry has a translation).
- **Component** — the editor renders the new section titles and the help block; the examples are present and the JSON
  panel is still collapsed by default; no dead key is referenced.
- **Locale parity** — every key in `en/msp/service-requests.json` exists in all 11 locales (there is an existing parity
  habit in this repo; use it rather than a bespoke script), and the removed keys are gone everywhere.
- **Existing suites that must stay green** — `serviceRequestEnterpriseAuthoringPanels.integration.test.ts` asserts
  `showAdvancedFormBehaviorConfigPanel` values (booleans, not copy), `FieldVisibilityEditor`/`AnswerMappingSection`
  tests, and the portal form visibility tests, which prove the behaviour the help describes.
- **Manual (Prepare Human Review)** — the §5 walkthrough on `:3645`, plus one paste of each example into the JSON panel
  and a save to prove the documented shape is accepted.

## Risks

- **Long copy × 11 locales.** Agent-translated help text in ten languages is a real review burden; the fact that the
  examples are JSON (language-neutral) keeps the translated surface to labels and paragraphs. Pseudo-locales must be
  filled so layout/text-length problems show up before a customer sees them.
- **Renaming a visible section** may surprise admins who learned the old names; the docs page and the section
  description carry the bridge ("this is the panel formerly called Visibility Configuration" belongs in the nm-store doc,
  not in the UI).
- **Operator drift** — mitigated by rendering from the exported table (§2).
- **CE vs EE** — the help must not describe a panel CE does not render; keep the edition sentence factual and test the
  CE path renders the audience editor without the advanced panel.
