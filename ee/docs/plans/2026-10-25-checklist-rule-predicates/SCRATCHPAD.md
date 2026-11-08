# Checklist rule predicates: implementation notes

Approved specification: `PLAN.md` and `design-predicate-rules.md`, committed at `827ae21392`.
Internal ticket: **alga-2026-0002836**. This branch remains stacked on PR #3858 and must not merge first.
The ownership prerequisite from PR #3865 was reconciled locally in `4cf81f5d2f`.

## Evaluation and persisted format

Rules compile through `createTicketQuerySchema()` in `shared/lib/ticketQuery/ticketQuerySchema.ts`.
The tickets package re-exports that declaration, so the ticket list and auto-apply use the same schema.
`matchingRuleTemplateIds` loads enabled rules with active templates, validates every stored group and
version, then selects one Boolean per compiled rule against the tenant-scoped ticket row. There are
**two statements regardless of rule count**: the rule load and one evaluation statement. Both use the
caller's transaction. No child expansion, per-rule queries, ticket-record overlay, or fallback matcher
remains. Template IDs are deduplicated before applying through the existing provenance/idempotency
and ownership boundary.

SQL was chosen because the ticket schema already resolves client/contact tags and their tenant
correlation. A second in-memory ticket projection would have duplicated those semantics. Creation
and existing targeting-change entry points remain in place. Service-request submissions are linked
after ticket insertion and before auto-apply in the same transaction.

Migration `20261028120000_checklist_rule_predicates.cjs` installs the text functions, adds `where`
JSONB and `where_version`, backfills through the frozen legacy conversion helper, and drops all eleven
matcher columns. Version **1** is the only accepted stored/written version. Unknown versions raise
`UnsupportedRuleVersionError`. Empty AND matches every ticket, as the old unconstrained rule did.
The editor creates new rules disabled until the operator enables them.

The migration deliberately refuses a downgrade: arbitrary nested predicates and tag targeting cannot
be represented losslessly by the removed columns. Recovery requires a pre-migration backup.
`checklist_template_apply_rules` was already registered in tenant metadata; no new table was needed.

## Compatibility evidence

`checklistRulePredicates.integration.test.ts` creates an old-format rule table in an isolated schema,
runs the **real migration**, and evaluates the stored predicates against seeded public tickets through
`matchingRuleTemplateIds`. The unchanged pre-cutover matcher lives exclusively in a frozen test
fixture. The matrix covers **30 rule shapes × 14 tickets = 420 comparisons**.

| Rule shapes | Count | Seeded ticket comparisons |
| --- | ---: | ---: |
| Unconstrained and empty values | 2 | 28 |
| Board/category/subcategory/priority | 5 | 70 |
| Client lists | 2 | 28 |
| Ticket origins | 1 | 14 |
| Service request / definition | 3 | 42 |
| All dimensions combined | 1 | 14 |
| Any/all × title/description/both | 6 | 84 |
| Literal symbols, metadata negatives, Unicode, mentions, and boundary cases | 10 | 140 |

The original SQL draft had two demonstrated mismatches. Both are addressed:

- **Serialized rich text:** the SQL description interpreter decodes serialized attributes and
  serialized documents, then reads visible inline/block content. It handles BlockNote and ProseMirror,
  links, mentions, child blocks, and tables. JSON keys, styles, and URLs are not searchable text.
  Inline text fragments concatenate, so formatting boundaries do not split a keyword.
- **Unicode folding:** local PostgreSQL `lower('İ')` differed from JavaScript. The versioned
  `alga_predicate_lower_v1` uses a frozen Unicode **16.0** mapping, the dotted-I expansion, and the
  Unicode final-sigma context rule. Property tests use deterministic `C` collation. Database tests
  compare all case-changing code points and sigma contexts with ECMAScript, including non-BMP text.
  The predicate package's case-sensitive substring contract is unchanged. Migration/editor literals
  are folded before storage. Future Unicode semantics changes require a new persisted-format review,
  rather than replacing the v1 mapping under existing rules.

The approved block-boundary difference remains: block text is joined with spaces, whereas the frozen
BlockNote projection used newlines. A separate database test asserts that `hello world` can span two
blocks. This accepted difference is not presented as an equal-result row in the compatibility matrix.

## Ownership, CRUD, and editor

Ownership remains outside `where`, enforced in `applyChecklistTemplateToTicket` for every caller.
Save and owner changes recursively reject another client's `client.id` value with that offending ID
in the error. Owner-only conditions are substituted with TRUE and groups simplified algebraically:
removing a TRUE branch from OR would otherwise change its meaning. Null comparisons and empty sets
are preserved. Template locks serialize ownership changes and rule writes/deletes.

Rule CRUD validates the package Zod shape and every schema leaf. It maintains tag references in its
write transaction and cleans them up on rule/template deletion. In this branch, a tag definition's
ID is `tag_definitions.tag_id`; targeting reads `tag_mappings`, while `tag_references` protects
configuration lifetime. These are separate concerns.

`TICKET_PREDICATE_FIELDS` drives path, operator, control, option-source, folding, and ownership behavior.
Client/contact tag fields derive from `WHERE_TAG_FILTERS`. Conditions are edited locally and saved
explicitly; incomplete typing is not persisted. Owned client controls are read-only. Nested or other
unrepresentable groups display an advanced-rule notice and remain unchanged, including across an
enabled-state edit. Missing tag choices retain their saved IDs and tag loading failures offer retry.
New strings use translation keys; non-English locales currently carry English fallbacks for these
new keys. Pseudo-locales were regenerated with the repository generator.

Ticket-template defaults remain separate, with the planned `LEVERAGE` marker. Their stored matcher
format was not migrated. Existing ticket-template, duplication, and recurring regression fixtures
were updated only where they create checklist apply rules.

## Verification

- Selected Vitest run: **166 tests passed across 13 suites**, including the real migration matrix,
  tag targeting/near misses, tenant isolation, bundle behavior, service-request ordering, ownership,
  idempotency, CRUD/tag-reference lifecycle, editor behavior, and ticket-template/duplicate/recurring
  regressions. Run from `server` with `npx vitest run --coverage.enabled=false --hookTimeout=600000`
  and these paths:
  - `src/test/integration/checklistRulePredicates.integration.test.ts`
  - `src/test/integration/ticketChecklists.integration.test.ts`
  - `src/test/integration/ticketPredicateComputed.integration.test.ts`
  - `src/test/integration/serviceRequestTicketExecution.integration.test.ts`
  - `src/test/integration/api/clientService.checklistTemplateDeletion.integration.test.ts`
  - `src/test/integration/ticketTemplates.integration.test.ts`
  - `src/test/integration/ticketDuplicate.integration.test.ts`
  - `src/test/integration/recurringTicketTemplates.integration.test.ts`
  - `../packages/tickets/src/lib/ticketQuerySchema.test.ts`
  - `../packages/tickets/src/actions/ticketCloseChecklistFacade.contract.test.ts`
  - `../shared/lib/ticketChecklists/__tests__/ruleMatchesTicket.test.ts`
  - `../shared/lib/ticketChecklists/__tests__/rulePredicates.test.ts`
  - `src/test/unit/settings/ChecklistRuleMatchers.test.tsx`
- `node --test server/src/test/unit/migrations/checklistRulePredicate.test.cjs`: **4 passed**.
- `npm run build -w @alga-psa/shared`: passed.
- Shared/tickets typechecks: passed on the final sources.
- `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -w server`: passed on the final sources.
- `NODE_OPTIONS=--max-old-space-size=12288 npm run build -w server`: passed, including 74 static pages.
  The build reports dynamic-import and Edge-runtime
  warnings in untouched modules and skips its embedded typecheck; the separate server check is run.
- Pseudo-locale generation, translation validation, bidi guard, and `git diff --check`: passed.
- The tickets workspace's direct `npm run build` is not its supported build target: its unchanged
  script calls tsup without entries, while its Nx build target is a no-op. The application build
  compiles the tickets source.

## Review and environment limits

Review the migration/text functions first, then the matrix and recursive ownership normalization.
Tests ran on isolated PostgreSQL databases. The wired development database has not been migrated;
apply the new migration before starting its app. No app server or live browser was started.
Citus execution was not exercised locally. Its function DDL propagation is a deployment review item;
see the [Citus DDL reference](https://learn.microsoft.com/en-us/postgresql/citus/reference-ddl?view=citus-14).
The unrelated pre-existing `package-lock.json` modification is excluded from this work. No push or PR.

## Fresh checkout verification (2026-10-28)

The 13-suite selection above passed again: 166 tests, including the migration matrix and automatic
application acceptance case. The four Node conversion tests also passed. The test run used the
disposable `checklist_predicate_draft_verify` database. A read-only inspection of the wired database
found `board_id` and no `where` column, so it still needs the migration. Shared build and shared and
tickets typechecks passed again. `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -w server`
and `NEXT_PUBLIC_EDITION=enterprise NODE_OPTIONS=--max-old-space-size=12288 npm run build:enterprise -w server`
also passed. The build emitted existing scheduling export, dynamic-import, and webpack cache warnings.
The pre-existing lockfile modification remains outside this work.
