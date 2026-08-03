# Project template budgeted-hours normalization plan

Date: 2026-08-03

## Goal

Allow project updates in the project/template workflow to round-trip PostgreSQL `bigint` `budgeted_hours` values without Zod failures, while rejecting invalid input and persisting minutes as a number or null.

## Current path and failure

1. `packages/projects/src/components/ProjectDetailsEdit.tsx` displays database minutes as hours, converts a non-empty edit back to numeric minutes, and calls `updateProject` with an explicit payload.
2. `packages/projects/src/components/ProjectPage.tsx` has `handleProjectUpdate(updatedProject)`, which sends an entire `IProject` object back to `updateProject`, including database-originated values.
3. `server/migrations/20250226115600_add_budgeted_hours_to_projects.cjs` defines the field as `bigInteger`. The PostgreSQL driver can return bigint as a string although `IProject.budgeted_hours` says `number | null`.
4. `packages/projects/src/actions/projectActions.ts` strips only `tenant`, validates with `updateProjectSchema`, then calls `ProjectModel.update`.
5. `packages/projects/src/schemas/project.schemas.ts` requires an already-numeric value. A database-shaped value such as `"120"` fails before persistence.
6. `packages/projects/src/models/project.ts` should continue receiving only normalized numbers or null.

`projectTemplateSchema` itself contains template metadata, and `applyProjectTemplate` does not copy a template-level budget. The failing boundary is the shared project update action used after template-driven project work.

## Design

Normalize at shared server-action validation, not in one React caller.

In `packages/projects/src/schemas/project.schemas.ts`:

- Add a focused budgeted-hours preprocessor used by project create/update schemas.
- Preserve `undefined` and `null`; accept finite numbers unchanged.
- Trim strings and convert only non-empty numeric representations.
- Reject empty, non-numeric, negative, and non-finite values; never coerce empty text to zero.
- Keep schema output numeric so persistence never receives a string.

In `packages/projects/src/actions/projectActions.ts`:

- Keep validation before permission/database mutation and retain the existing user-facing validation error from `projectActionErrorFrom`.
- Remove or consolidate the unused `extendedCreateProjectSchema` and `extendedUpdateProjectSchema` after confirming they have no callers, leaving one authoritative rule.
- Do not special-case `ProjectPage` or mutate caller data outside validation.

No migration is needed. Storage remains integer minutes.

## Behavioral tests

Add runtime validation coverage beside the project schema:

1. `budgeted_hours: "120"` parses to numeric `120`.
2. Numeric `120`, `null`, and omission remain valid.
3. Empty, whitespace-only, non-numeric, negative, `NaN`, and infinite values are rejected.
4. Unrelated partial updates remain unaffected.

Where the action harness is practical, add an `updateProject` behavior test with a database-shaped full project payload: assert string budget reaches the model as a number, while invalid text returns the normal validation error without an update. Prefer that action test, but keep schema behavior tests rather than adding source-string assertions if auth/database mocking would be brittle.

Manual smoke:

- Open a project reached or created through the template workflow with an existing budget.
- Exercise the full-object update path and confirm it saves without a validation toast.
- Edit Budgeted Hours, save, reload, and confirm the hours/minutes round-trip.
- Try invalid or negative input and confirm a validation error with no database change.

## Implementation order

1. Add failing behavior tests for database numeric strings and invalid strings.
2. Add schema normalization and numeric constraints.
3. Remove confirmed dead duplicate schemas and use the authoritative validation path.
4. Run focused tests and the projects package typecheck/test command.
5. Smoke the project/template update against the wired server.

## Error behavior

Numeric strings normalize silently because they are a database transport representation. Invalid, blank, negative, or non-finite values use the existing project validation error. No raw Zod issue, SQL error, or partial update reaches the user.

## Non-goals

- Database type or migration changes.
- Minutes-versus-hours semantic changes.
- Adding `budgeted_hours` to template metadata.
- Broad coercion of unrelated fields.
- Generated API/MCP/OpenAPI updates.
- Project form, status, billing, or template-application refactors.
- Cleaning the unrelated modified `package-lock.json`.

## Risks

- `z.coerce.number()` maps empty strings to zero; use explicit preprocessing.
- JavaScript cannot exactly represent every bigint; reject non-safe integers if domain constraints require integer minutes.
- UI-only normalization misses full-object callers; enforce at the shared boundary.
- Tighter constraints can expose old bad data; cover behavior before rollout.
- Removing duplicate schemas can affect inferred types; verify they are unused and typecheck.

