# @alga-psa/predicates

One predicate model for workflow conditions and ticket-list filters.

- `src/` root exports: types, zod schema, in-memory evaluator, query-schema validation. Deterministic, no Node APIs
  (the workflow evaluator runs in the Temporal sandbox). The package is bundled into `@alga-psa/shared`.
- `@alga-psa/predicates/sql`: the PostgreSQL compiler. `knex` is a peer dependency (type-only import).
- `spec/SEMANTICS.md` is the contract; `spec/conformance.json` is its executable form. Every backend runs every row:
  evaluator (`src/__tests__`), SQL compiler (`server/src/test/integration/predicatesSql.integration.test.ts`),
  workflow JSONata path (`shared/workflow/runtime/designer/__tests__/conditionModel.conformance.test.ts`).

## Adding a ticket-list dimension

1. Declare the attribute or relation in the ticket query schema (`packages/tickets/src/lib/ticketQuerySchema.ts`). If
   it is not a plain column or relation, add a named computed-attribute resolver beside the others; that is the only
   place raw SQL is allowed.
2. If it introduces an operator, path kind or value type, update `SEMANTICS.md` and add conformance rows first; all
   backends must pass.
3. Add rows to the table-driven ticket filter matrix with explicit expected ids and totals, including bundled view and a
   client-portal user.
4. Add a filter descriptor table entry for the toolbar and active-filter chip.
5. The new path is a persisted contract from its first release: renames go through the migrate-hook alias map.
