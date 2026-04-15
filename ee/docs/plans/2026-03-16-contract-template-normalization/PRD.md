# PRD — Contract Template Normalization

- Slug: `contract-template-normalization`
- Date: `2026-03-16`
- Status: Draft

## Summary

Normalize the contracts domain so reusable templates exist only in `contract_template*` tables and instantiated client-owned contracts exist only in `contracts` / `contract_lines` / `client_contracts`. Remove the remaining runtime, API, UI, and migration compatibility layers that still treat templates as live contract fallbacks or contract-shaped resources.

Make template instantiation the only legal transfer boundary between authoring data and runtime data: templates can be copied into contracts, but live contracts must never read through templates again, and template edits/deletes must never mutate existing contract runtime state.

This is a follow-on to `ee/docs/plans/2026-03-16-client-owned-contracts-simplification/`. That plan established the client-owned contract invariant for non-template contracts. This plan finishes the decoupling by eliminating the mixed-model artifacts that still let runtime billing, contract APIs, and legacy scripts behave as if templates and contracts are interchangeable.

## Problem

The repo currently supports two contradictory realities at once:

- The intended architecture says templates are reusable blueprints stored in dedicated `contract_template*` tables, and instantiated contracts are client-owned runtime objects.
- The implementation still carries multiple compatibility layers from the legacy mixed schema:
  - template rows can still exist in `contracts` and `contract_lines` behind `is_template`
  - client contracts still carry `template_contract_id` as an active runtime lookup key
  - billing still falls back from `client_contracts.contract_id` to `client_contracts.template_contract_id`
  - several actions and UI loaders still map templates into `IContract`-shaped responses
  - template deletion and line repository code still reaches into instantiated contract storage

This keeps the system harder to reason about than necessary and introduces real risks:

- Billing behavior can still depend on template-side data after a contract has supposedly been instantiated.
- The codebase still behaves as if a template and its instantiated contracts are linked by a live mutable relationship instead of a one-way copy boundary.
- Template and contract APIs remain ambiguous, which leaks complexity into every caller.
- Schema cleanup is blocked because runtime still relies on legacy fallback columns and flags.
- Operators still need verification scripts that compare “legacy template rows in contracts” to separated template tables, which means the cutover is not finished.

## Goals

- Make template data authoring-only and one-way copied into instantiated contracts.
- Make template instantiation the only boundary where authoring data crosses into runtime contracts.
- Make runtime billing and discount resolution depend only on instantiated contract/client assignment state.
- Stop treating templates as `IContract`-shaped runtime resources in APIs and UI loaders.
- Remove the remaining behavioral dependence on `contracts.is_template`, `contract_lines.is_template`, and template-backed runtime fallbacks.
- Reduce `client_contracts.template_contract_id` to provenance-only metadata or remove it entirely if no longer needed.
- Retire legacy verification/backfill scripts that assume duplicated storage once cutover is complete.
- Leave the codebase with one clear model:
  - templates define reusable defaults
  - contracts and client contracts define live billing behavior

## Non-goals

- Reversiting the client-owned contracts migration already delivered in the March 16 simplification plan.
- Redesigning the contract template product experience.
- Rewriting historical invoices or moving invoice history to template-aware tables.
- Changing the core contract billing semantics, tax calculation semantics, or renewal business rules beyond removing template fallback.
- General contract-domain redesign outside contract/template normalization.
- Adding observability, metrics, rollout toggles, or operational tooling beyond what is required to validate the cutover.

## Users and Primary Flows

- Billing admin
  1. Creates or edits reusable templates in template-specific screens.
  2. Creates client-owned contracts from templates or from scratch.
  3. Bills clients from instantiated contract data without template-side fallback.

- Finance / operations
  1. Reviews live contracts and invoices without needing to understand template linkage.
  2. Runs billing/reporting flows that operate on instantiated contract facts only.

- Engineers / support
  1. Can trace a bug to either template authoring or contract runtime behavior without a mixed resource model.
  2. Can reason about template provenance separately from live billing state.

## UX / UI Notes

- Templates and contracts should stop sharing a single implicit “contract detail” abstraction.
- Template screens should load template DTOs and template lines directly, not contract-shaped surrogates.
- Contract screens should load only client-owned contract headers and assignment/runtime data.
- `getContractById`-style flows should not silently return a template when a contract lookup misses.
- Any UI still showing `is_template` as a first-class branch on the same runtime type should be replaced with explicit route/view separation.
- Template edit/delete affordances should clearly operate on reusable authoring assets, not on already-instantiated contracts.

## Requirements

### Functional Requirements

- Single-write instantiation boundary
  - Template instantiation must be the only supported path for moving template-defined data into runtime contract tables.
  - After instantiation, runtime billing, reporting, and contract CRUD must treat instantiated rows as self-contained facts.
  - Template edits must not propagate into existing contracts unless an explicit reapply/reclone workflow is intentionally built later.
  - Template deletes must only affect authoring-side records and provenance references, never live contract behavior or runtime rows.

- Runtime/billing decoupling
  - Billing engine contract-line resolution must load only from instantiated contract IDs.
  - Billing discount resolution must not join through `template_contract_id` fallbacks.
  - Cloned contract data must remain billable even if the source template changes later.

- Template provenance
  - Decide and document whether `client_contracts.template_contract_id` remains as provenance metadata.
  - If retained, it must not be used as a live billing/configuration fallback.
  - If dropped, migration and API flows must preserve enough provenance elsewhere for audit/debug needs.

- Contract/template API separation
  - Contract list/detail APIs must only return instantiated contracts.
  - Template list/detail APIs must only return template resources.
  - Shared DTO adapters that map templates into `IContract`-shaped responses must be removed or isolated behind explicit compatibility endpoints slated for deletion.

- Repository/action separation
  - Contract line repositories/actions must stop accepting a single “maybe template, maybe contract” ID space.
  - Template line CRUD and contract line CRUD must be separated at the repository/action boundary.
  - Template delete/update flows must not mutate instantiated contract tables.

- Schema cleanup
  - Remove live reliance on `contracts.is_template`.
  - Remove live reliance on `contract_lines.is_template`.
  - Remove or re-scope legacy verification scripts that compare duplicated legacy template rows with dedicated template tables.
  - After runtime cutover and validation, add cleanup migration(s) that drop obsolete columns / legacy rows / compatibility references.

- Data validation and migration safety
  - Before destructive cleanup, validate that all legacy template rows in `contracts` and `contract_lines` have equivalent canonical records in `contract_template*`.
  - Fail closed if any tenant still relies on legacy-only template data or missing canonical template records.
  - Provide a deterministic operator runbook for preflight, cutover, and post-cutover verification.

### Non-functional Requirements

- Cutover must be staged so runtime behavior changes land before schema deletion.
- Validation must rely on real database reads against migrated schema, not only source-string tests.
- The resulting architecture must be simpler than the current one: no hidden runtime fallback from live contracts to templates.
- The resulting architecture must have a single, obvious data-flow direction: template authoring data can be copied into runtime contracts, but runtime contracts do not read back through template state.
- The cleanup must remain compatible with the current multi-tenant / Citus environment constraints.

## Data / API / Integrations

- Template source of truth
  - `contract_templates`
  - `contract_template_lines`
  - `contract_template_line_*`

- Runtime source of truth
  - `contracts`
  - `contract_lines`
  - `client_contracts`
  - `contract_pricing_schedules`
  - contract-line child/config tables

- Required cleanup targets
  - `contracts.is_template`
  - `contract_lines.is_template`
  - any runtime `coalesce(template_contract_id, contract_id)` joins
  - any OR joins on `template_contract_id` vs `contract_id`
  - contract/template action adapters that flatten templates into contract DTOs

- Scripts and verification
  - `server/scripts/verify-template-migration.ts` currently assumes duplicated storage and will need to become either:
    - a strict pre-cutover verifier only, or
    - a cleanup verifier that proves legacy rows are gone and canonical template rows remain
  - `server/scripts/contract-template-decoupling.ts` currently preserves hybrid semantics and should be retired or rewritten to match the normalized model

- External/accounting integrations
  - No intentional behavior change to invoice export payloads, but invoice generation must continue to derive from instantiated invoices/contracts only.
  - If any downstream export uses template provenance today, document and preserve that explicitly rather than via hidden fallback joins.

## Security / Permissions

- No new roles or permissions are required.
- Existing billing/contract/template permissions remain in force.
- API separation must not accidentally broaden template visibility through contract endpoints or vice versa.

## Observability

- Out of scope as a product feature.
- Migration/cutover scripts must log sufficient validation output to identify blocking tenants and mismatched legacy/template records.

## Rollout / Migration

- Phase 0: inventory and invariants
  - inventory all runtime uses of `template_contract_id`, `contracts.is_template`, and `contract_lines.is_template`
  - inventory all API/UI contract-template compatibility adapters
  - verify canonical template data exists for every legacy template row

- Phase 1: runtime cutover
  - codify template instantiation as the sole transfer boundary from authoring data to runtime data
  - remove billing-engine and discount fallback to template-backed contract IDs
  - ensure all template-to-contract instantiation paths fully clone required data into runtime tables
  - validate invoice generation and discount application on instantiated contracts only

- Phase 2: API/UI and repository separation
  - split template DTOs/routes/actions from contract DTOs/routes/actions
  - split template-line CRUD from contract-line CRUD
  - remove “contract lookup falls back to template lookup” behavior

- Phase 3: schema and script cleanup
  - stop relying on duplicated legacy template rows
  - retire or rewrite legacy backfill/verification scripts
  - drop obsolete legacy columns / rows once preconditions are satisfied

- Phase 4: post-cutover validation
  - verify no runtime code path joins templates as a live billing source
  - verify no contract endpoint returns template-backed data
  - verify deleting/updating a template cannot mutate live contract rows

## Open Questions

- Should `client_contracts.template_contract_id` remain as immutable provenance metadata, or should provenance move to a different field/table before removal?
- Do any production tenants still depend on template rows remaining present in `contracts` for operational tooling outside the app?
- Should the final cleanup physically delete legacy template rows from `contracts`/`contract_lines`, or mark them unreachable first and purge later?
- Do we want a temporary compatibility API for callers currently expecting templates in contract-shaped payloads, or should we cut those consumers over directly?

## Acceptance Criteria (Definition of Done)

- Billing and discount resolution no longer fall back from `client_contracts.contract_id` to template-backed IDs.
- Template instantiation is the only supported authoring-to-runtime transfer path, with no reverse sync or live template reads after assignment.
- Templates are no longer returned from contract endpoints or contract lookups.
- Template CRUD no longer mutates instantiated contract tables.
- Editing or deleting a template after contract instantiation does not change live contract runtime behavior.
- Contract line CRUD and template line CRUD are separated in repositories/actions and no longer share a mixed “contract or template” code path.
- Canonical template records fully replace legacy template rows as the reusable source of truth.
- Legacy compatibility scripts/paths are either removed or rewritten to validate the normalized model.
- The system can safely drop obsolete legacy template markers/columns without changing runtime behavior.
