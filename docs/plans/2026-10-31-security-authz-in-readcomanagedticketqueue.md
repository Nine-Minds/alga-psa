# readCoManagedTicketQueue — apply each relationship's own redactions to the queue, its search, counts and export

Card: `12c3b69e-2a70-5713-8d32-29415784bd18`
Finding: **authz · high** — `packages/co-managed/src/ticketQueue.ts:150`
(`readCoManagedTicketQueue`), reviewed on merge `2754f79c8116` (PR #3999).

## What is wrong (confirmed on the branch)

`readCoManagedTicketQueue` computes **one** redaction set for the whole call
(`ticketQueue.ts:148-151`):

```ts
const rules = (await resolveBundleNarrowingRulesForEvaluation(...resource ticket/read...)).filter(...)
const redactions = rules.flatMap(rule => rule.redactedFields ?? []);
const visible = Object.fromEntries(...)          // :152
```

That is the sponsor-side bundle policy only. Every per-relationship row is then loaded inside the loop
(`:210-220`) — the relationship object carries **`redacted_fields`**, and it is stored in the closure
variable `relationship` — but `projection()` (`:161`) closes over the *global* `visible`, so a
relationship configured with `redacted_fields: ['title']` (or `['*']`) still has its title, number,
status, priority, timestamps, responsibility and workspace name selected unmasked (`:190-206`).

Everything downstream consumes those unmasked values, which is what makes this worse than a display bug:

- search filters on the raw `title`/`ticket_number` (`:233-236`);
- state filter and sort (`:237-239`);
- counts (`:246-250`);
- the workspace chooser (`:244`);
- and the CSV export action, which reuses this same read.

So a redacted field remains **searchable, countable and exportable** — a side channel that survives any
cosmetic masking.

## Design: one redaction set per relationship branch, applied before the union

The correct scope is the relationship, not the request: sponsor-home redactions **union** that
relationship's `redacted_fields`. Masking must happen *inside the branch projection*, before `unionAll`,
so search, filter, sort, counts and export all operate on already-masked values — the same reason the
existing code already decides signal membership in the branch (`:222-226`, "so the count and the filter
cannot diverge"). This is the same principle applied to redaction.

### 1. Effective redactions per branch

In the relationship loop (`:210-220`), after `relationship` is loaded:

```ts
const relationshipRedactions = Array.isArray(relationship.redacted_fields) ? relationship.redacted_fields : [];
const effectiveRedactions = [...new Set([...redactions, ...relationshipRedactions])];
```

Pass it into `projection()` so the function no longer reads the outer `visible`.

### 2. Per-branch visibility + mask map

Inside `projection()`:

```ts
const branchVisible = Object.fromEntries(
  Object.entries(sources).map(([field, aliases]) => [field, !isCoManagedReadFieldHidden(effectiveRedactions, aliases)])
);
const workspaceNameVisible = !isCoManagedReadFieldHidden(effectiveRedactions, workspaceNameAliases);
```

Mask exactly as the existing code already does for redacted fields — `trx.raw('NULL::<type> as ??', [field])` —
and mask the workspace name literal (`COALESCE(?::text, NULL)`) when it is redacted. The three derived
signals in the branch (`assignmentVisible`, `escalatedSignalVisible`, `awaitingSignalVisible`) switch from
the global `visible` to `branchVisible`, so a relationship that redacts responsibility also loses the
escalated signal instead of leaking it through a boolean.

### 3. Carry the mask to the response shape

The final row mapping (`:254-257`) currently filters `Object.keys(sources)` by the **global** `visible`, which
is now wrong for every relationship. Two options; take the second:

- ~~filter per row in SQL by nullness~~ — a redacted field is legitimately null for other reasons;
- **emit a `redaction_mask` jsonb column per branch** (`trx.raw('?::jsonb', [JSON.stringify(branchVisible)])`)
  and, in the final mapping, keep `fields` as the fields whose mask is true for that row. The mask travels
  with the row through the union, so the response shape stays exactly as it is today
  (absent keys, not `null` values) and the client contract does not change.

### 4. Workspace chooser

`SELECT DISTINCT tenant, workspace_name AS name FROM scoped` (`:244`) would now produce NULL names for
redacting relationships and silently merge them. Emit the masked label and group by tenant:

```sql
SELECT DISTINCT tenant, COALESCE(workspace_name, '(redacted workspace)') AS name FROM scoped
```

Two redacted workspaces then remain distinguishable by `tenant` (which the client already sends back as
`workspaceTenant`), and no redacted name is ever written to the response.

### 5. Regression tests (fail on main)

`packages/co-managed/src/ticketQueue.redactions.test.ts`, two relationships in the same queue:

1. relationship A redacts `['title']`, relationship B redacts nothing → A's rows have **no** `title` key,
   B's do; both are present in one response;
2. `search: <A's real title>` returns **zero** rows from A (side-channel closed) while still matching B;
3. sorting by `title` orders on masked values and never reveals A's title through ordering;
4. `totalCount`/`openCount` are unchanged by masking (redaction must not distort counts);
5. `redacted_fields: ['*']` masks every `sources` field and the workspace name for that branch only;
6. the workspace chooser contains `(redacted workspace)` with A's `tenant` and A's real name nowhere in the
   serialized response;
7. `exportCoManagedTicketQueueAction` returns the same masked rows (same read path, asserted explicitly
   because export is where the side channel pays off).

## Order of work

1. Thread `effectiveRedactions` into `projection()`; replace the closure reads of `visible` (mechanical,
   types make the remaining uses obvious).
2. Mask workspace name + emit `redaction_mask`; rewire the response mapping and the chooser.
3. Tests 1-7; run the existing co-managed suite (`ticketQueue`, `export`, policy helpers).

## Deliberately not doing

- Not changing `resolveBundleNarrowingRulesForEvaluation` or the bundle policy itself — the sponsor rules
  are correct; the defect is that relationship redactions were dropped on the floor.
- Not adding per-field masking in the *detail* path here. `// LEVERAGE: pattern co-managed-read-admission`
  at `:132` already marks this class; the detail path has its own card. When that card lands, both paths
  should share one `effectiveRedactions(subject, relationship)` helper rather than repeat this arithmetic.
- Not changing the response contract (absent keys stay absent).

## Risks

- **Masked fields that drive authorization**: `is_closed`, `has_msp_assignment` and `work_revision` are used
  by filters and signals. They must keep their *typed* nulls (`NULL::boolean`, `NULL::integer`) so the SQL
  union stays well-formed — the existing `visible[field]` type selection already does this; keep it.
- **Count divergence**: redaction must not change counts. If a masked field is used as a filter, the filter
  legitimately stops matching, which is the intent; the test in §5.4 pins the invariant that unfiltered
  counts do not move.
- **Per-row mask column size**: one small jsonb per row; acceptable for a paginated queue, and it is the
  only way to keep the "absent key" contract without re-deriving visibility in the client.
