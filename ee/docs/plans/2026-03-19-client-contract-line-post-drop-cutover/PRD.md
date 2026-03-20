# PRD — Client Contract Line Post-Drop Cutover

- Slug: `client-contract-line-post-drop-cutover`
- Date: `2026-03-19`
- Status: Draft

## Summary

Finish the post-`client_contract_lines` cutover so fully migrated environments run billing, recurring invoicing, contract authoring, and related read models entirely through the client-owned contract structure:

- `contracts` as the client-owned contract header
- `contract_lines` as the canonical line/runtime obligation
- `client_contracts` as the client assignment and lifecycle window

This plan covers both:

- restoring runtime correctness in environments where the legacy `client_contract_*` line tables have already been dropped
- cleaning up stale code, tests, and plan/runbook references that still encode `client_contract_lines` as a live dependency

The target end state is that no live billing or contract path requires the dropped `client_contract_lines` table, and recurring client-cadence obligations use a canonical post-drop identity consistent with the client-owned contract model.

## Problem

The branch currently carries two contradictory models at once:

- the March 16 client-owned contracts work says non-template contracts are client-owned, `contract_lines` are the canonical line records, and `client_contracts` is the assignment/lifecycle layer
- a later migration drops `client_contract_lines` and related per-client line tables as redundant
- some newer runtime code already follows that post-drop model
- several recurring, invoicing, contract-authoring, credit, bucket, report, and API paths still query `client_contract_lines` directly or preserve `client_contract_line` as a first-class runtime identity
- server-side contract-line APIs, billing overview reporting, credit flows, and test/runbook fixtures still encode the dropped table as the live assignment model

In a fully migrated environment this causes real breakage, not just cleanup debt:

- `AutomaticInvoices` can 500 while loading recurring due work
- recurring preview/generate can fail when resolving selector-input windows
- service-period repair and regeneration paths can fail
- linkage, bucket, and contract authoring paths can drift between old and new structures
- tests can still pass because they mock or assert the removed table as expected live behavior

The current state is therefore unsafe:

- migrations say the old structure is gone
- runtime code still depends on it
- tests and docs partially protect the old behavior instead of the intended end state

## Goals

- Make fully migrated environments work without `client_contract_lines` or related dropped client-contract line tables.
- Standardize live contract/billing runtime around:
  - `contracts`
  - `contract_lines`
  - `client_contracts`
- Define one canonical post-drop identity for recurring client-cadence obligations.
- Remove live recurring/invoicing dependence on `client_contract_line_id` and `obligation_type = 'client_contract_line'` where those concepts only preserve the removed table.
- Update contract authoring and mutation paths so they no longer write dropped client-contract line tables.
- Update dependent read models, reports, and linkage flows so they no longer query dropped tables.
- Update server-side contract-line service paths so deprecated client-line assumptions do not leak back into live runtime behavior.
- Remove or rewrite stale tests/static guards that preserve the removed structure as expected behavior.
- Update plan/runbook/docs language so future work does not regress back to the dropped structure.

## Non-goals

- Reintroducing `client_contract_lines` or any other dropped client-contract line table.
- Reversing the client-owned contract model established in the March 16 simplification work.
- Redesigning contract templates, invoicing UI, or recurring cadence ownership beyond what is necessary to align them to the post-drop structure.
- Rewriting historical invoice financial data unless linkage/read-side migration is required for correctness.
- Broad billing-domain cleanup outside the specific dropped-table and recurring-obligation identity mismatch.

## Users and Primary Flows

- Billing admin
  1. Creates a client-owned contract and contract lines.
  2. Generates recurring invoices from `AutomaticInvoices`.
  3. Previews, generates, reverses, or deletes recurring invoices without hidden dependence on removed tables.

- Finance / operations
  1. Reviews due recurring work in fully migrated environments.
  2. Uses service-period inspection and regeneration without schema mismatch failures.
  3. Trusts recurring history, linkage repair, and bucket-derived calculations after migration.

- Engineers / support
  1. Can reason about one contract-line runtime model.
  2. Do not have to special-case “post-drop environments” versus “legacy environments” in normal billing code.
  3. Can rely on tests to protect the intended client-owned post-drop structure.

## UX / UI Notes

- This plan is primarily structural/runtime cleanup, but several user-facing surfaces must stop breaking or implying old lineage:
  - `AutomaticInvoices`
  - recurring preview / generate
  - recurring service-period management
  - contract authoring/wizard flows
  - contract line editing/configuration
  - recurring history / reverse / delete affordances
- No new major UI is required.
- Existing UI copy that refers to service periods or client-owned contracts should remain, but hidden legacy dependencies must be removed so the UI actually works in migrated tenants.
- Any operator-facing error about missing service periods should be a canonical repair action, not a missing-table or dropped-structure crash.

## Requirements

### Functional Requirements

- Canonical post-drop contract structure
  - Live billing and recurring paths must treat `contract_lines` as the canonical recurring/service obligation record.
  - Client ownership must resolve through `contracts.owner_client_id`.
  - Assignment lifecycle windows must resolve through `client_contracts`.

- Recurring obligation identity
  - The implementation must define one canonical post-drop identity for client-cadence recurring obligations.
  - Selector-input due work, materialization, regeneration, invoice linkage, reverse/delete repair, and duplicate prevention must all use that same identity.
  - Legacy `client_contract_line` recurring identity may remain only as passive historical compatibility metadata if required, not as a live table dependency.

- Due-work and invoicing
  - `getAvailableRecurringDueWork()` must work in environments where `client_contract_lines` does not exist.
  - Recurring due-work selection, preview, and generation must not join dropped tables.
  - `AutomaticInvoices` must load, preview, and generate recurring rows in a fully migrated environment.

- Service-period lifecycle
  - Recurring service-period inspection, regeneration, and repair actions must resolve obligation metadata without dropped tables.
  - Client-cadence regeneration must load obligations from the surviving structure and persist records keyed to the canonical post-drop identity.

- Contract authoring and mutation
  - Contract wizard and related create/update flows must stop inserting or updating dropped client-contract line tables.
  - Contract line mutation paths must use the surviving structures only.

- Linkage and dependent billing flows
  - Invoice/service-period linkage must resolve recurring obligation candidates without `client_contract_lines`.
  - Bucket period resolution and related recurring helpers must use the surviving structure.
  - Credit or other dependent billing flows that still look up client-contract line rows must be rewritten or removed.

- Reports / read models / API
  - Read models and report definitions must stop querying dropped client-contract line tables as live fact sources.
  - Server/package contract-line services that still use dropped client-line tables for unassign/deactivate, usage analytics, in-use checks, overlap validation, or overview counts must be rewritten or removed from live paths.
  - API/services that remain intentionally legacy must be clearly isolated and must not be called by live billing/runtime paths.

- Tests and docs cleanup
  - Static tests and integration tests that currently assert `client_contract_lines` usage as live expected behavior must be updated or removed.
  - Plans/runbooks/docs that still describe `client_contract_lines` as an expected live runtime table must be corrected or explicitly marked historical.
  - Cleanup-only references in teardowns, fixtures, tracked backup files, and stale runbooks should be removed so new work does not keep cargo-culting the dropped structure.

### Non-functional Requirements

- No live runtime path should crash simply because a fully migrated database no longer contains `client_contract_lines`.
- The cutover should reduce structural ambiguity, not add more compatibility layers.
- Tests must fail if a live billing/runtime path reintroduces dropped-table dependence.
- The plan should prefer one clear canonical model over mixed old/new identity shims.

## Data / API / Integrations

- Runtime data shape
  - `contracts.owner_client_id` remains the client ownership anchor.
  - `client_contracts` remains the assignment/lifecycle source.
  - `contract_lines` remains the canonical recurring/service obligation row.

- Recurring identity cleanup
  - The current use of `obligation_type = 'client_contract_line'` and `client_contract_line_id` in recurring service periods must be reviewed and either:
    - migrated to canonical `contract_line` identity, or
    - formally retained as a logical compatibility identity that no longer depends on a dropped table.
  - The chosen approach must be applied consistently across:
    - materialization
    - due-work selection
    - preview/generate
    - linkage
    - regeneration
    - reverse/delete repair

- API/services
  - Server and package services that still expose or derive live behavior from `client_contract_lines` must be rewritten or clearly deprecated away from runtime codepaths.
  - Report definitions and billing overview readers must use surviving contract/assignment structures.

## Security / Permissions

- No new permissions are required.
- Existing billing, contract, invoice, and recurring-service-period permissions remain the guardrails.
- Cleanup must not bypass any existing authorization checks while rewriting dropped-table lookups.

## Observability

- Errors that currently manifest as missing-relation failures should become explicit domain failures only where a real business precondition is missing.
- The plan does not require new observability infrastructure, but runtime failures should become diagnosable from the canonical structure instead of surfacing raw dropped-table errors.

## Rollout / Migration

- This work assumes the migration dropping `client_contract_lines` and related tables has already run in target environments.
- Runtime code must therefore treat those tables as unavailable, not optional.
- The implementation sequence should be:
  1. unblock recurring due-work / `AutomaticInvoices`
  2. unblock recurring preview/generate/linkage/repair
  3. fix regeneration and service-period management
  4. remove dropped-table writes from contract authoring and mutation paths
  5. clean up dependent read models, contract-line services, credits, buckets, and reports
  6. rewrite stale tests/docs/runbooks that preserve the old structure
  7. remove tracked backup artifacts and low-value cleanup references that keep the removed table visible in active development flows
- If any historical data or compatibility read path still requires legacy recurring identity fields, keep them as passive metadata only and document the boundary clearly.

## Open Questions

- Should recurring client-cadence obligations migrate fully to `obligation_type = 'contract_line'`, or should the code retain a logical `client_contract_line` identity that is no longer backed by a physical table?
- If any historical invoices or recurring records still encode legacy line identity, what minimal read-side compatibility is required to keep them explainable without preserving old runtime joins?
- Which deprecated server/package services should be cleaned up in this plan versus explicitly deferred once live billing/runtime paths are fixed?
- Which stale historical plan/design docs should be left untouched but explicitly treated as historical, versus corrected because they are still used as operational guidance?

## Acceptance Criteria (Definition of Done)

- `AutomaticInvoices` loads successfully in a fully migrated environment with no `client_contract_lines` table.
- Recurring due-work, preview, generate, reverse/delete repair, and service-period management no longer query dropped client-contract line tables.
- Contract wizard and related contract-authoring flows do not write dropped client-contract line tables.
- Invoice linkage, bucket timing, and dependent recurring/billing helpers work through the surviving contract-owned structure.
- Live report/read-model and contract-line service paths no longer depend on `client_contract_lines`.
- Tests and static guards no longer preserve dropped-table dependence as expected live behavior.
- Documentation and runbooks describe the post-drop client-owned structure accurately, and tracked backup artifacts or stale cleanup fixtures no longer point engineers back at the removed table.
