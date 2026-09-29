# Ticket create field persistence — scratchpad

## Scope and sources

- Planning assignment: preserve `url`, `severity_id`, `urgency_id`, and `impact_id` on ticket creation.
- Read the card dossier using `alga-dev workflow-list-facts`; corroborate its source references against this checkout because line numbers have moved.
- Dossier reproduction: ticket alga-2026-0002512, main revision `b0bd888ab4`: POST returned 201 with `url: null`, while a later PUT persisted the URL. This is reported evidence, not a reproduction performed during planning.
- Dossier asks for regression coverage and prefers a single declared field map or type-level exhaustiveness over another extension of an unchecked literal.
- Existing unrelated `package-lock.json` modification was present before planning.

## Initial findings

- REST `createTicketSchema` accepts `url` but omits the three classification UUIDs.
- `TicketService.createTicket` forwards `url` but omits those UUIDs from `CreateTicketInput`.
- Shared `CreateTicketInput` already declares all four fields; inspect cleaning, row construction, and validation before finalizing the fix.

## Status

- Design only; implementation and runtime validation have not started.

## Confirmed source findings

- `shared/models/ticketModel.ts`: `CreateTicketInput` around line 122 declares all four fields; `ticketData` around line 750 omits all four. `ticketSchema` around line 59 contains URL but omits classification UUIDs. `completeValidation` is spread into `dbData` around line 796, so adding only mapping entries is insufficient.
- `cleanNullableFields` around line 361 normalizes a fixed list of other nullable fields, not these four. Preserve this behavior; do not describe empty classification strings as an existing supported input.
- `server/src/lib/api/schemas/ticket.ts`: create schema around line 114, derived update schema around line 135, response schema around line 230. Preserve update acceptance deliberately when adding fields to shared bases.
- `server/src/lib/api/services/TicketService.ts`: create adapter around line 1613 forwards URL only; the transaction reloads the saved row for the response.
- `server/src/lib/api/openapi/routes/workManagementV1.ts`: `WorkV1CreateTicketBody` is declared separately around line 69 and needs explicit additions.
- `server/migrations/202409071803_initial_schema.cjs`: classification tables around lines 165–193; nullable ticket columns around 257–259; tenant-qualified foreign keys around 278–280. No migration expected, subject to migrated-schema verification.
- `packages/types/src/interfaces/ticket.interfaces.ts`: relevant ticket type currently has numeric ITIL fields; inspect and align optional nullable UUID response fields during implementation.
- `packages/tickets/src/actions/ticketImportActions.ts`: current `createInput` around line 763 does not supply any affected fields. The dossier identifies the shared caller correctly, but its suspected import data loss is unconfirmed; do not add import UI/CSV scope.

## Design decisions

- Scope estimate: nine atomic implementation items and seven representative regression checks. This bounded persistence defect does not need a 25-item feature list.
- Use an explicit typed handling declaration local to shared ticket creation, covering direct fields, transformations, and intentional exclusions. It must participate in row construction, not merely assert a disconnected list of names.
- Keep the plan as a draft for review; create all four requested planning artifacts from the card evidence without treating plan creation as board approval.
- Keep REST URL validation unchanged; classification UUIDs are optional, non-null request inputs and nullable stored values. Do not broaden inherited update contracts accidentally.
- Invalid reference guard coverage must run actual queries in an isolated transaction against migrated tables. A source-string test or mocked insert alone cannot prove this fix.

## Implementation / verification guide

1. Add a failing shared-model DB persistence regression and REST schema retention case.
2. Implement the local exhaustive row mapping and shared schema additions; preserve transformed/defaulted values.
3. Add REST forwarding, response/type alignment, and OpenAPI fields; audit derived update schemas.
4. Run the seven planned checks and relevant existing create regressions. Record actual commands/results here and update checklist flags only when implementation is complete.

Useful existing harnesses:

- `server/src/test/integration/ticketCreateBoardStatusValidation.integration.test.ts` uses `createTestDbConnection`, migrated tables, generated fixture IDs, and tenant-scoped cleanup.
- `server/src/test/integration/ticketExternalLinks.integration.test.ts` covers atomic create-related mutations.
- `server/src/test/e2e/api/tickets.e2e.test.ts` provides API create/update patterns.
- `server/vitest.api-e2e.config.ts` runs HTTP tests against an already running application and its owned database.
- `server/vitest.workspace-db.config.ts` has explicit include patterns that do not currently include `src/test/integration/**`; select a suitable runner or wire new DB tests into the intended CI job, rather than assuming discovery.
- Read the integration-testing skill before implementing database tests. Some DB harnesses recreate `test_database`; use isolated test infrastructure and do not reset the shared development stack.

Planning validation command:

```sh
python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-19-ticket-create-field-persistence
```

## Planning validation results

- Plan validator passed: nine features and seven tests.
- Additional checks passed: unique IDs, every feature referenced by a test, all implementation flags false, and all four artifacts present.
- `git diff --check` passed for tracked changes; the plan directory is newly created and untracked. No application code was changed and no runtime tests were run.
