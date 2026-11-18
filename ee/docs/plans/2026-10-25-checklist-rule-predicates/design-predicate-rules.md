# Design — auto-apply rules on the predicate model

Mechanism for `PLAN.md`. Decisions there are settled; this file is how the code is shaped.

## 1. One idea

An auto-apply rule stops being a row of typed columns with its own matcher. It is a
`PredicateGroup` over the **ticket query schema** — the same model, paths and set semantics the ticket
list uses. Everything else follows: tag targeting is just `client.tags in [...]`, evaluation is one
compiled fragment, and adding a dimension is one schema attribute, not a matcher change.

## 2. Schema additions (`packages/tickets/src/lib/ticketQuerySchema.ts`)

| Attribute | Kind | Type | Operators |
| --- | --- | --- | --- |
| `ticket_origin` | column | string, `castToText` | `equals, not_equals, in, not_in, is_empty, is_not_empty` |
| `title_folded` | computed | string | `equals, not_equals, contains, starts_with, ends_with, is_empty, is_not_empty` |
| `description_folded` | computed | string | same as above |
| `from_service_request` | computed | boolean | `equals` |
| `service_request_definition_id` | computed | uuid | `equals, in, is_empty, is_not_empty` |

Resolvers (SQL lives only in `COMPUTED_RESOLVERS`, as the file's header requires):

- `title_folded` → `LOWER(t.title)`.
- `description_folded` → plain text of `t.attributes->'description'`, lowercased:
  - `jsonb_typeof = 'string'` → `LOWER(t.attributes->>'description')`;
  - otherwise (BlockNote JSON / parsed array) → `LOWER((SELECT string_agg(v, ' ') FROM jsonb_path_query(t.attributes->'description', '$.**.text') AS v))`;
  - `NULL` when absent or empty → `is_empty` keeps working.
- `from_service_request` → `EXISTS (SELECT 1 FROM service_request_submissions s WHERE s.created_ticket_id = t.ticket_id)`.
- `service_request_definition_id` → `(SELECT s.definition_id FROM service_request_submissions s WHERE s.created_ticket_id = t.ticket_id)`.

`COMPUTED_META` gains these entries; the completeness test already asserts the declared set is the
whole set, so it will force the test update with the code.

## 3. Migration (`packages/db` / server migrations)

Add and backfill in one transactional migration:

```sql
ALTER TABLE checklist_template_apply_rules
  ADD COLUMN "where" jsonb NOT NULL DEFAULT '{"join":"and","clauses":[]}'::jsonb,
  ADD COLUMN where_version smallint NOT NULL DEFAULT 1;
-- Backfill in JS (needs the keyword normalisation).
-- Retain legacy columns, constraints and values for the previous release.
```

Column removal requires a later release whose baseline no longer reads or writes the legacy fields.
Once the predicate column exists, reinvoking the migration skips backfill to preserve predicate edits.

`where_version = 1` is the schema version of the stored group. A reader that meets a version it does
not know fails the rule evaluation loudly (`UnsupportedRuleVersionError`) rather than guessing — a
wrong match is worse than a skipped apply.

Backfill mapping (clauses emitted in this order so migrations are reviewable):

| Column (non-null) | Clause |
| --- | --- |
| `board_id` = B | `{board_id, equals, B}` |
| `category_id` = C | `{category_id, equals, C}` |
| `subcategory_id` = S | `{subcategory_id, equals, S}` |
| `priority_id` = P | `{priority_id, equals, P}` |
| `client_ids` = [..] | `{client.id, in, [..]}` |
| `ticket_origins` = [..] | `{ticket_origin, in, [..]}` |
| `service_request_definition_id` = D | `{service_request_definition_id, equals, D}` (subsumes `from_service_request`) |
| `from_service_request` = true, no definition | `{from_service_request, equals, true}` |
| `keywords` = K[] | see below |

Keywords: fold each `k` as `trim().toLowerCase()`, drop empties; if none remain emit nothing. For
target `title` / `description` the keyword's group is a single clause on `title_folded` /
`description_folded` with `contains`. For `title_and_description` the group is
`{join:'or', clauses:[title_folded contains k, description_folded contains k]}` — today's
`found(k) = fields.some(…)`. The top join is `or` for `keyword_mode = 'any'`, `and` for `'all'`;
`all` therefore becomes `AND_k [ OR_f … ]`, exactly today's `keywords.every(found)`.

A rule with no matchers becomes `{join:'and',clauses:[]}`, which matches every ticket — today's
behaviour.

## 4. Evaluation (`shared/lib/ticketChecklists/applyTemplates.ts`)

Delete `ruleMatchesTicket`, `ChecklistApplyRuleMatchers`, `ChecklistRuleTicketInput` and the keyword
types. One function replaces them:

```ts
/** Ids of the enabled rules whose `where` matches the ticket, in one round trip. */
export async function matchingRuleTemplateIds(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<string[]>;
```

- Load enabled rules with an active template: `select r.template_id, r."where", r.where_version`.
- Compile each `where` once with `compilePredicate(rule.where, createTicketQuerySchema(), { rootAlias: 't' })`.
- Build **one** statement: `SELECT (<f0>) AS r0, (<f1>) AS r1, … FROM "tickets" AS "t" WHERE "t"."ticket_id" = ?`
  with `bindings = [...fragments.flatMap(f => f.bindings), ticketId]` (select-list bindings precede
  the where binding), executed through `tenantDb(trx, tenant)` so the tenant column and the caller's
  transaction both apply. The just-inserted ticket is visible because it is the same transaction.
- Duplicate `template_id`s collapse as they do today (`seenTemplates`), then each applies through
  `applyChecklistTemplateToTicket` unchanged — ownership (`checklist_templates.client_id`) is still
  enforced there, not by the predicate.

`selfOrAnyChild` stays off: the old matcher compared the ticket's own columns, and child tickets of a
bundle carry the same client.

Evaluation points are unchanged: ticket creation, and board/category change. Both already call
`applyMatchingChecklistTemplates`; idempotency remains `ticket_checklist_items.template_id`.

`applyMatchingChecklistTemplates` loses its `serviceRequest` overlay parameter: the create-from-service-
request path writes `service_request_submissions.created_ticket_id` inside the transaction right after
the ticket insert and before this call, so `from_service_request` resolvers see it.

## 5. Rule CRUD (`packages/tickets/src/actions/checklists/checklistTemplateActions.ts`)

Input becomes `{ template_id, is_enabled, where: PredicateGroup }`. Validate with
`predicateGroupSchema`, then `validateClause` against the ticket schema per clause (path exists,
operator allowed for the attribute type, list/single value shape). Reject `where_version` other than 1
on write. On an owned template apply D6: reject other-client `client.id` values; drop owner-only ones.
Reads select `template_id, is_enabled, "where", where_version`.

## 6. Editor (`server/src/components/settings/general/ChecklistRuleMatchers.tsx`)

A row-per-clause editor driven by descriptors:

```ts
interface TicketPredicateField {
  path: string;
  labelKey: string;
  defaultLabel: string;
  control: 'select' | 'multiselect' | 'tags' | 'text' | 'boolean';
  operators: PredicateOperator[];
  options?: 'boards' | 'categories' | 'subcategories' | 'priorities' | 'origins'
          | { tags: 'client' | 'contact' };
  fold?: 'lower';        // literal is lowercased before it is written
  ownerSensitive?: boolean; // client.id on an owned template
}
```

Rows: `board_id`, `category_id`, `subcategory_id`, `priority_id`, `client.id`, `client.tags`,
`contact.tags`, `ticket_origin`, `title_folded`, `description_folded`, `from_service_request`,
`service_request_definition_id`. The tag rows reuse `WHERE_TAG_FILTERS` from
`packages/tickets/src/lib/ticketWhereFilters.ts` for their pickers, so tag selection behaves like the
list. On an owned template `client.id` renders read-only.

The editor writes the same `PredicateGroup` shape the workflow conditions editor writes (one top-level
join + flat clauses); a group it cannot represent (deeper nesting produced by API callers) is
round-tripped untouched with a read-only "advanced rule" notice, never silently flattened.

## 7. Tests

- **Equivalence table** (`shared/lib/ticketChecklists/__tests__/ruleMatchesEquivalence.test.ts`): keep
  the pre-change matcher as a frozen fixture module; for a seeded matrix of tickets (origins, board /
  category / priority, clients, service-request and not, multi-block descriptions, mixed-case
  keywords) and every legacy rule shape, assert `ruleMatchesTicket(legacyRule, t) === compiled(where, t)`.
  This is the migration's proof and the card's "every existing rule behaves the same" requirement.
- **Tag targeting** (integration): rule `client.tags in [Managed M365] AND category New User AND
  title_folded contains onboarding` applies to exactly the fixture ticket, not to a client with a
  different tag, not to a contact tag on the same client, not to a bundle child with a different client.
- **`contact.tags` vs `client.tags`** are not interchangeable (one test each way).
- **Schema**: `title_folded` / `description_folded` / computed completeness; multi-block description
  folding; `is_empty` on both.
- **Migration**: seed pre-migration rules, run the migration, assert each becomes the expected `where`
  and that evaluation is unchanged.
- **Ownership boundary**: another-client `client.id` rejected on save with a message naming the value;
  owner-only clause dropped.
- **Editor**: descriptor-driven rows render; tag picker writes `in [ids]`; `client.id` read-only on an
  owned template.
- **`ruleMatchesTicket` deleted**: a grep assertion in the test suite (`packages/predicates` export
  surface unchanged).

## 8. SCRATCHPAD entry (write on implementation)

> Auto-apply rules: evaluated by compiling `where` into `createTicketQuerySchema()` and asking the
> tickets table (`SELECT (fi) AS ri … WHERE ticket_id = ?`), not in memory. Why: the tag sets that
> this card exists for are only expressed by the schema (`tagSet` over `tag_references`), no
> in-memory ticket shape carries client/contact tags, and the list already owns the semantics the
> acceptance test states. One round trip; no second evaluator. Case-insensitivity is preserved by
> folded attributes (`title_folded`, `description_folded`) rather than by relaxing the predicate
> contract's case-sensitive `contains`.
