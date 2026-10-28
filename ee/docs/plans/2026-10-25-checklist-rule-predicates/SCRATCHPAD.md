# Implementation scratchpad

- The approved plan and design are present at commit `827ae21392`; this work is stacked on the predicate/ticket-schema work in card `9798abc3` and must not merge first.
- SQL evaluation remains the settled decision: compile each predicate through the ticket schema and select all boolean results for the ticket in one tenant-scoped statement inside the caller's transaction. The ticket schema already owns client/contact tag semantics, so a second in-memory matcher would duplicate them. Keep child expansion disabled.
- Persisted predicates must be validated and version 1 is the only supported version; unknown versions must fail explicitly. The migration is not yet installed: dropping matcher columns before all consumers are migrated would break the application.
- Service-request submission linking must move before auto-apply in the same transaction. The existing overlay is still present and the ordering has not yet been changed.
- PR #3865 is not an ancestor of this branch. Its established implementation includes the `checklist_templates.client_id` migration, a hard boundary at the shared apply chokepoint, and a mismatch result surfaced by manual/workflow callers. These need reconciliation together; adding only a predicate constraint does not enforce ownership. The branch currently has neither the column migration nor that check.
- The migration conversion helper handles the legacy dimensions and nested keyword groups; it is not connected to an actual migration yet. Its small runtime tests use the predicate package’s in-memory evaluator and are not the required real-database equivalence matrix.
- Description block-boundary behavior, serialized rich-text descriptions, non-ASCII folding, database migration, editor, CRUD, ownership, and integration behavior remain to be verified.

## Verification

- `npm run build -w @alga-psa/predicates` — passed.
- `node --test server/src/test/unit/migrations/checklistRulePredicate.test.cjs` — passed (4 tests). This does not prove SQL or migration equivalence.
- No application server was started. No workspace build, typecheck, integration, migration, or browser validation was run.
