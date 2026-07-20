# Email Template Variable Reference — Implementation Plan

**Date:** 2026-07-17
**Branch:** `docs/email-templates`
**Status:** Approved design; ready for implementation

## Problem

Email template variables are undocumented. A tenant customizing a template in
Settings → Notifications → Email Templates has no way to discover which variables are
available — the truth lives in 42 template source files and their send-time call sites,
none of it visible to users. User feedback (screenshot of a competitor's searchable
"$-variables" page) asked for a central, searchable variable reference.

Alga cannot copy that page literally: competitor variables are one flat global namespace,
while Alga templates use Handlebars with **per-template contexts** — `{{invoice.invoiceNumber}}`
pasted into a ticket template silently renders empty. The reference must be context-aware.

## Design (settled with Robert, 2026-07-17)

1. **Canonical variable registry** — hand-authored TypeScript, the single source of truth.
2. **Editor side panel** — searchable list of *this template's* variables in the
   Customize/Edit dialog; click inserts at cursor; copy secondary.
3. **Global reference dialog** — "Variable reference" button on the Email Templates screen:
   all variables, search + area filter + copy.
4. **Website docs page** — generated from the registry, published in `~/nm-store`.
5. **CI drift test** — strict-mode render of every template × locale against registry
   examples; landing it green forces the bug fixes below.
6. **`{{`-autocomplete** in the editor — follow-on milestone, same branch.

## Ground truth: the inventory

An Opus 4.8 agent fleet (21 agents: per-category extraction, adversarial verification,
synthesis) inventoried all 42 system email templates and their send-time call sites:
**524 variable entries**, availability traced per template, with types, descriptions, and
example values. The verified output is committed alongside this plan:

**`docs/plans/2026-07-17-email-template-variables-inventory.json`**

Structure: `categories[]` (per-category `templates[]`, each with `variables[]` of
`{path, type, description, example, availability, notes}`, plus `callSiteFiles`,
`conditionals`, `uncertainties`, `verificationNotes`) and `synthesis`
(`sharedBlocks[]`, `observations[]`, `risks[]`). **This file is the seed data for the
registry — do not re-derive variable lists from scratch; start from it and verify against
code where it flags uncertainty.** Read `synthesis.observations` and `synthesis.risks`
in full before writing registry code; they enumerate the traps (naming fragmentation,
client-vs-MSP `company.name` collision, raw-HTML fields, date-format inconsistency,
portal-vs-MSP URL duality).

## Architecture

### Registry module — `packages/notifications/src/lib/templateVariables/`

- `types.ts` — `VariableDef` (`path`, `type`, `description`, `example`, optional `notes`),
  `VariableType` = `'string' | 'number' | 'boolean' | 'date' | 'url' | 'raw-html' | 'array' | 'object'`.
  `date` entries must say in the description whether the value is pre-formatted display
  text or an ISO string (the corpus has both; the inventory records which is which).
- `blocks.ts` — shared blocks from `synthesis.sharedBlocks` (`ticket`, `client`, `invoice`,
  `project`, `task`, `appointment`, `recipient`, `assignee`, `branding`, `contact`) as
  reusable `VariableDef[]` fragments. Blocks are an **authoring convenience only**.
- `registry.ts` — the compiled artifact: **per-template** entries keyed by system template
  name (the DB `name` from `upsertEmailTemplate`). Each entry: `category`, `variables`
  (composed from blocks + template-specific extras, then pruned/extended to match that
  template's actual send-time contract — availability is per-template, never block-global),
  `concept` tags on variables so naming variants (`ticket.id` / `ticketNumber`) are
  cross-searchable, and `contractInferred: boolean` for the 8 templates with no wired send
  path (see triage). Raw-HTML variables carry `type: 'raw-html'`.
- Descriptions are English-only, but keep them in a shape that can later be keyed for i18n.

### Derivations from the registry (one source of truth)

- **Preview sample data:** `packages/notifications/src/lib/templateSampleData.ts` currently
  hand-maintains sample values for previews. Replace its data with values derived from
  registry `example`s (keep the module's public API so `EmailTemplates.tsx` preview code
  is untouched). Delete the duplicated literals.
- **UI (panel + dialog):** import the registry directly — it's static data in the same
  package as `EmailTemplates.tsx`; no server action needed.
- **Docs page:** generator script (below) emits markdown from the registry.

### Editor side panel

In `packages/notifications/src/components/settings/EmailTemplates.tsx`, the
Customize/Edit dialog gains a variables panel beside the source editor:

- Lists only the current template's registry entry; search filters on path, description,
  and concept tags.
- Row: monospace path, type badge, one-line description; hover/expand shows example.
- Click inserts at the textarea cursor: `{{path}}` normally, `{{{path}}}` when
  `type === 'raw-html'`. Copy icon as secondary action. Insertion targets whichever field
  (subject/html/text) last had focus.
- Templates flagged `contractInferred` show a "not currently sent" note in the panel and
  on the templates list row (see triage bucket 3).
- View-only dialog for system templates shows the same panel without insert.
- Follow all conventions in `docs/AI_coding_standards.md` (component `id`s / ui-reflection).

### Global reference dialog

"Variable reference" button on the Email Templates screen header opens a dialog:
search box + category filter (mirroring the screenshot the user sent) over all registry
entries, grouped by category → template, copy-to-clipboard per row. Variables shared by
many templates within a category collapse into one row listing where they apply
(use concept tags + identical path/description to group).

### `{{`-autocomplete (follow-on milestone)

In the template textareas: typing `{{` opens a popover filtered to the current template's
variables as the user types; Enter/click completes the token (closing braces included;
triple-stache for raw-html). Implement against the plain textarea (mirror-div caret
positioning); do not swap in a heavyweight editor for this.

### Docs generator + website page

- `packages/notifications/scripts/generate-variable-docs.ts` (or repo-appropriate
  location): emits a markdown variables reference from the registry — per category, per
  template, table of path / type / description / example, honest "not currently sent"
  labels for `contractInferred` templates.
- The page itself lands in the **website repo `~/nm-store`** (separate commit/PR there),
  placed with the existing docs. Author it with the `alga-business-documentation` skill
  and house voice (`psa-copywriting` / `alga-tech-doc-writing` conventions): satisfy the
  brief, never quote it; screenshots of the new panel/dialog per that skill's conventions.
- Link the settings screen's reference dialog to the published docs page.

### CI drift test

New test (vitest, in `packages/notifications` or server test tree — wherever it can read
both the registry and `server/migrations/utils/templates/email/**`):

For every system template file × every language variant: compile subject/html/text with
Handlebars **strict mode** and render against a data object built from that template's
registry `example` values. Fails when a template references a path the registry doesn't
declare (undocumented or phantom variable) or when registry examples don't satisfy the
template. This is the mechanism that keeps registry, templates, and docs from drifting.

## Findings triage (from the inventory — dispositions are settled decisions)

### Bucket 1 — fix in this branch (the drift test cannot land green without them)

1. **`billing/creditExpiration.cjs` live bug:** template reads `{{company.name}}`; the
   subscriber assembles `client.name` — client name renders empty in production. Fix the
   template to the assembled path (verify at the call site; inventory says `client.name`).
2. **Polish/French phantom paths:** pl/fr variants reference paths no call site assembles
   (`ticket.summary` in created/assigned/team-assigned/updated, `ticket.closedAt`,
   `ticket.updatedAt`, `comment.authorName`/`comment.body` in comment-added; see
   `tickets` category `verificationNotes`). Re-point each to the equivalent assembled path.
3. **Surveys escaping:** raw HTML (`rating_buttons_html` et al.) rendered via
   double-stache. Verify actual rendering behavior at the call site, then correct the
   stache form (or the compile options) so intended HTML is deliberate, not accidental.

Template content fixes ship the way template changes always ship here: a new dated
migration using `upsertEmailTemplate` (see
`server/migrations/20260211120000_consolidate_templates_source_of_truth.cjs` pattern) —
edit the source `.cjs` files and add a migration that re-upserts the affected templates.

### Bucket 2 — document truthfully in the registry (not code changes)

`ticket.id`/`project.id` hold human-readable numbers, not UUIDs (say so in descriptions);
raw-HTML fields typed `raw-html` with triple-stache guidance; portal-vs-MSP URL duality
noted per URL variable; `referenceNumber`'s two runtime formats both documented.

### Bucket 3 — visible but labeled; wiring is future work

8 templates are customizable in the UI but never sent: `invoice-generated`,
`payment-overdue`, `payment-received`, `milestone-completed`, `task-updated`, and the three
time-entry templates. Registry marks them `contractInferred`; UI shows "not currently
sent". Do **not** wire them up in this task.

### Out of scope entirely (filed on the workflow board)

Naming normalization across the three conventions (a future migration this registry
finally makes possible); duplicate assembled fields (`priority`/`priorityName`,
`timeRemaining` variants); wiring bucket-3 templates.

## Milestones (implement in order)

1. **Registry foundation** — types, blocks, per-template registry seeded from the
   inventory JSON; resolve every `uncertainties` entry against code while authoring.
2. **Drift test + bucket-1 fixes** — land the test; fix credit-expiring, pl/fr paths,
   surveys escaping (+ migration) to get it green.
3. **Sample-data consolidation** — derive preview data from registry examples; remove
   duplicated literals from `templateSampleData.ts`.
4. **Editor side panel** — search/insert/copy panel in the edit dialog; "not currently
   sent" labels.
5. **Reference dialog** — global search/filter/copy dialog on the templates screen.
6. **Docs generator + nm-store page** — script, generated page, published in `~/nm-store`
   with house voice; settings dialog links to it.
7. **`{{`-autocomplete** — popover completion in the editor textareas.

Each milestone should leave the branch green (typecheck, existing tests, new drift test
from milestone 2 onward).

## Verification

- Drift test green across all templates × locales.
- Manual: dev stack on `http://localhost:3339` — customize a ticket template, insert a
  variable via panel and via autocomplete, preview renders the example value, send test
  email; open reference dialog, search across areas, copy a variable.
- Confirm credit-expiration email now renders the client name (preview + test send).

## Key files

| Purpose | Path |
| --- | --- |
| Seed data (committed) | `docs/plans/2026-07-17-email-template-variables-inventory.json` |
| Registry (new) | `packages/notifications/src/lib/templateVariables/` |
| Settings UI | `packages/notifications/src/components/settings/EmailTemplates.tsx` |
| Sample data to consolidate | `packages/notifications/src/lib/templateSampleData.ts` |
| Template sources | `server/migrations/utils/templates/email/**` |
| Template upsert helper | `server/migrations/utils/templates/_shared/upsertEmailTemplates.cjs` |
| Render path (Handlebars) | `packages/notifications/src/notifications/email.ts` |
| Server actions | `packages/notifications/src/actions/notification-actions/notificationActions.ts` |
| Coding standards | `docs/AI_coding_standards.md` |
