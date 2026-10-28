# Checklist auto-apply rules become predicates (client + contact tag targeting, alga-2026-0002836)

Internal-only card (Nine Minds LLC). Stacked on 9798abc3 (VIP badges / `@alga-psa/predicates` + ticket
query schema) and must not merge before it. Mechanism: `design-predicate-rules.md`.

## Problem

Auto-apply rules (PR #3857) are a hand-written condition dialect: eleven typed matcher columns on
`checklist_template_apply_rules`, evaluated by a bespoke `ruleMatchesTicket` that already carries
`// LEVERAGE: pattern rule-matching — third copy …`. Targeting by client/contact tags ("every client
tagged Managed M365") would be a fourth copy. Meanwhile the ticket query schema — shared by the ticket
list and the VIP tag work — already declares `client.tags`, `contact.tags`, `client.id`, board,
category, subcategory and priority with one semantics. This card moves the dialect onto that model.

## Decisions (settled here; implementation must not re-open)

### D1 — Evaluate by compiling into the ticket query schema, not in memory

Chosen: **SQL through `createTicketQuerySchema()`**, evaluated inside the caller's transaction as
`ticket_id = <X> AND <where>`.

Evidence:

- Every dimension the rules need is already a schema attribute, including the tag sets that motivate
  the card (`client.tags`, `contact.tags` as `tagSet` over `tag_references`) — and tag semantics
  ("has any of" = `in`, "has none" = `not_in`) already exist and are conformance-tested.
- There is no in-memory ticket record that carries client/contact tags or a flattened description.
  An in-memory evaluator would have to load them, i.e. re-derive what the schema already resolves.
- `done = "applies … to a matching ticket and to no other"` is *the ticket list's* question. Proving
  it with the same schema is proving it with the same engine, not a lookalike.
- One round trip regardless of rule count: compile each enabled rule once, then
  `SELECT (<rule0>) AS r0, (<rule1>) AS r1, … FROM tickets t WHERE t.ticket_id = ?` (see design §4).
  No per-rule queries, no per-ticket fan-out.

Rejected: in-memory evaluation over a loaded record (fourth matcher copy, drifts from the list);
bespoke SQL per dimension (that is the dialect again).

### D2 — The predicate model is not changed, and its contract stays literally true

`spec/SEMANTICS.md` states `contains` / `starts_with` / `ends_with` are **case-sensitive**, and
today's keyword matcher is case-insensitive. We do not soften the model. Instead the schema exposes
**folded text attributes** (`title_folded`, `description_folded`) whose *values* are lowercased, and
the editor folds the literal it writes (`fold: 'lower'` on those descriptors). The contract stays true
— the attribute is already folded — and existing keyword rules keep their exact behaviour.

### D3 — `from_service_request` / definition id become computed attributes, and the link is written first

Add `from_service_request` (boolean) and `service_request_definition_id` (uuid) as computed resolvers
over `service_request_submissions.created_ticket_id`. Today the create path passes an in-memory
`serviceRequest` overlay because `created_ticket_id` is written *after* auto-apply. Fix the order at
the create-from-service-request call site: write `created_ticket_id` inside the same transaction
immediately after the ticket row is inserted, before auto-apply. Then the row is the truth, the
overlay parameter and its conditional lookup disappear, and compiled evaluation needs no special case.

### D4 — Storage: one `where` group + a version, with an additive migration

`checklist_template_apply_rules.where jsonb not null default '{"join":"and","clauses":[]}'` and
`where_version smallint not null default 1`, validated with `predicateGroupSchema`. The empty AND
group matches everything — identical to today's "no matchers" rule.

Column-by-column migration (exact mapping in design §3) retains: `board_id`, `category_id`,
`subcategory_id`, `priority_id`, `client_ids`, `ticket_origins`, `from_service_request`,
`service_request_definition_id`, `keywords`, `keyword_mode`, `keyword_target`. Add the predicate
columns and backfill in JS (needs the matcher's normalisation, e.g. keyword trimming). The previous
release still reads and writes the legacy columns during blue/green upgrades, so removal requires
a later release whose baseline no longer uses them. Reinvoking the transactional migration preserves
existing predicates rather than repeating the backfill. `where_version` is the persisted-format
version: readers reject a version they do not know rather than guessing.

### D5 — New targeting: client tags and contact tags by tag definition id

`client.tags` / `contact.tags` as `in` (has any of) / `not_in` (has none of), values are
`tag_definitions.definition_id`. No new column, no new table — the tag referrer registration this
depends on is the VIP card's `tag_references` work.

### D6 — Template ownership stays outside the predicate

Unchanged: `checklist_templates.client_id` is a hard boundary enforced in `applyChecklistTemplateToTicket`,
not a rule. On save of a rule for an owned template: reject a `where` containing `client.id` clauses
naming any other client, and drop `client.id` clauses naming only the owner (redundant). Errors name
the offending value, never another client's rule.

### D7 — Editor is generated from descriptors, not one control per column

`ChecklistRuleMatchers.tsx` is replaced by a row-based predicate editor driven by a curated
`TICKET_PREDICATE_FIELDS` descriptor table (design §5): path, label, type, operators, control kind,
options source, `fold`. The tag controls reuse the list's `WHERE_TAG_FILTERS` descriptor shape. On an
owned template the client control renders read-only. Adding a future targeting dimension is one
descriptor row.

### D8 — Ticket templates keep their own matcher for now

Their defaults are the other copy named in the LEVERAGE marker. Leave them, add a marker naming this
card's model as the destination. Not this card's scope.

## Scope

In: schema attributes (`ticket_origin`, `title_folded`, `description_folded`, `from_service_request`,
`service_request_definition_id`), additive migration + backfill, rule CRUD (`checklistTemplateActions.ts`
and its zod input), evaluation (`applyTemplates.ts`: delete `ruleMatchesTicket` and the matcher types;
one compiled evaluation), editor (`ChecklistRuleMatchers.tsx` + settings screen), tests,
`tenantTableMetadata.ts`, docs/SCRATCHPAD decision.

Out: predicate model semantics, tag definitions/referrers (VIP card owns them), template ownership
behaviour, ticket-template defaults, any new evaluation point.

## Done / acceptance

- A rule `client.tags has any [Managed M365] AND category New User AND title_folded contains onboarding`
  applies its checklist to a matching ticket and **to no other** (positive + negative fixture each).
- Every rule shape from #3857 behaves identically after migration, proven by a table-driven test that
  runs the **old matcher** (kept only in the test, imported from a frozen copy) and the **new compiled
  evaluation** against the same seeded tickets and asserts equal results for every rule.
- `ruleMatchesTicket` and the matcher column types are gone; no fallback path exists.
- Editor: an owned template cannot name another client; tag pickers exist for client and contact tags.
- Evaluation points unchanged: ticket creation, and board/category change — both still idempotent
  (`ticket_checklist_items.template_id` provenance is the idempotency key).

## Risks

- **Folded text differs from the old matcher at block boundaries.** `description_folded` extracts the
  text of a BlockNote document in SQL (`jsonb_path_query(…, '$.**.text')`, space-joined) whereas the old
  matcher flattened with `flattenBlockContentToPlainText`. Substring matching inside one block is
  identical; a keyword spanning two blocks may now match where it did not. Cover with a multi-block
  description conformance test and accept the (wider) behaviour.
- **`lower()` vs `toLowerCase()`** for non-ASCII: Postgres locale vs JS. Fold in one place — the
  resolver — and fold literals in the editor/migration; note the difference for accented glyphs.
- **`where` is a reserved word.** Always quoted by knex builders; the one raw fragment in the
  select-list shape must quote it too.
- **Stacking.** The worktree is on 9798abc3's branch; re-read `ticketQuerySchema.ts` and the predicates
  package on the merge base before editing (both moved there).
