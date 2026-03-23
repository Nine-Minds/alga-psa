# PRD — Template Runtime Normalization Completion

- Slug: `template-runtime-normalization-completion`
- Date: `2026-03-20`
- Status: Draft

## Summary

Finish the remaining template/runtime cleanup after the service-driven invoicing cutover so instantiated contracts no longer depend on `template_contract_id` fallback semantics in client actions, runtime loaders, legacy scripts, or API/service adapters.

This plan is intentionally narrower than the earlier normalization umbrella in [2026-03-16-contract-template-normalization](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-contract-template-normalization/PRD.md). Core billing fallback joins have already been removed in the service-driven invoicing cutover. What remains is the tail of mixed-model behavior around contract application, contract-line cloning/setup, provenance exposure, and legacy decoupling utilities.

## Problem

The codebase is now in a partially normalized state:

- live recurring billing no longer needs template fallback joins in its critical execution paths
- contract-cadence materialization now reads instantiated contracts directly
- several static guards and post-drop migrations are already complete

but a smaller set of runtime paths still behaves as if `template_contract_id` can stand in for live contract identity or as if template/runtime resources are interchangeable.

Concrete remaining examples:

- `packages/clients/src/actions/clientContractActions.ts` still resolves template source with `clientContract.template_contract_id ?? clientContract.contract_id`
- `packages/clients/src/actions/clientContractLineActions.ts` still uses mixed template/runtime lookup semantics in line-add flows
- `server/src/lib/api/services/ContractLineService.ts` still carries template-source fallback reads
- `server/scripts/contract-template-decoupling.ts` still preserves hybrid fallback semantics
- several runtime DTO/model surfaces still expose `template_contract_id` without a clear provenance-only contract

This leaves three real problems:

1. runtime behavior is still inconsistent across modules
2. provenance and live identity are still blurred for engineers and callers
3. final schema cleanup remains blocked because the codebase has not fully converged on what `template_contract_id` is allowed to mean

## Goals

- Remove the remaining behaviorally active `template_contract_id` fallback paths from runtime code.
- Make any retained `template_contract_id` usage explicitly provenance-only and read-only.
- Make template-source-dependent operations resolve authoring source explicitly instead of silently falling back from runtime IDs.
- Tighten tests and static guards so mixed template/runtime fallback patterns cannot be reintroduced accidentally.
- Leave a clear, reviewable end state for whether `template_contract_id` remains as metadata or becomes removable.

## Non-goals

- Reworking service-period-driven recurring invoicing behavior already covered by the March 18 cutover plan.
- Redesigning the contract template UX or authoring model.
- Changing billing semantics, discounts, taxes, or renewals beyond removing leftover fallback behavior.
- Forcing immediate column removal if the final decision is to keep `template_contract_id` as provenance metadata for now.
- Rewriting historical invoices or rebuilding template migration history.

## Users and Primary Flows

- Billing/ops engineer
  1. Instantiates a contract from a template.
  2. Applies/configures lines on the instantiated contract.
  3. Bills the client from runtime contract state only.

- Support/debugging engineer
  1. Inspects a live contract or client assignment.
  2. Can tell whether a template reference is provenance metadata or a live dependency.
  3. Can reason about failures without guessing whether a fallback path exists.

- Backend engineer
  1. Changes contract or client-contract code.
  2. Gets clear type/test/static-guard feedback if a new fallback path is introduced.

## UX / UI Notes

- This plan is mostly backend/model cleanup.
- Any UI that surfaces `template_contract_id`-derived information must treat it as provenance text only, not as a second valid runtime lookup path.
- Runtime contract detail screens must not silently widen “contract” lookups to template-shaped resources.

## Requirements

### Functional Requirements

1. Inventory every remaining runtime use of `template_contract_id` in the active packages touched by contract application, line cloning, runtime loaders, API services, and maintenance scripts.
2. Classify each remaining use as one of:
   - allowed provenance-only read
   - forbidden runtime fallback
   - obsolete legacy cleanup
3. `applyContractToClient(...)` and equivalent contract-application flows must stop deriving template source with `template_contract_id ?? contract_id`.
4. Contract-line add/clone/setup flows must resolve source template data explicitly and fail closed when the required authoring source cannot be identified.
5. Runtime client-contract and contract-line DTO/model surfaces must stop implying that `template_contract_id` is a live runtime key.
6. API/service-layer contract-line mutation flows must not backfill, infer, or rely on template fallback semantics beyond explicit provenance reads.
7. Contract/template decoupling scripts must be retired or rewritten so they no longer preserve hybrid fallback behavior.
8. Static guards must forbid known fallback patterns in the relevant runtime packages and scripts.
9. DB-backed integration tests must prove that post-normalization contract application and line configuration operate without template fallback joins or mixed runtime IDs.
10. The final plan output must state whether `client_contracts.template_contract_id` remains as provenance-only metadata or is now ready for a future drop migration.

### Non-functional Requirements

- Failures should be explicit. If a flow requires template provenance and it is missing, the system should error clearly rather than silently reinterpreting `contract_id`.
- The resulting code should be easier to reason about than the current partially normalized state.
- Static source guards should cover the packages that actually own these remaining runtime paths.

## Data / API / Integrations

- Clarify the contract for `client_contracts.template_contract_id`:
  - allowed as provenance-only read metadata
  - not allowed as live runtime contract identity
- Align shared interfaces/schemas that still expose `template_contract_id` so callers understand its provenance-only meaning.
- Review whether any API/service flows still expect a mixed template/contract ID space and split them if necessary.
- Rewrite or retire `server/scripts/contract-template-decoupling.ts` so it does not backfill or depend on hybrid semantics.

## Security / Permissions

- No new user-facing permissions are required.
- Existing contract/contract-line mutation permissions remain unchanged.
- Cleanup must not widen template visibility through runtime contract APIs.

## Rollout / Migration

- This is a cleanup/completion plan after the service-driven cutover, not a major feature flag rollout.
- Implementation should proceed by:
  1. classifying remaining references
  2. removing forbidden runtime behavior
  3. keeping or narrowing provenance-only reads explicitly
  4. updating tests and static guards
- If the final decision is to retain `template_contract_id` temporarily, the plan must leave the codebase ready for a later drop migration without behavioral dependence on the column.

## Risks

- Some contract-application flows may still need template provenance to locate authoring-side data. If that provenance is absent for old rows, removing fallback can turn a silent compatibility path into an explicit failure.
- Interfaces that expose `template_contract_id` may have downstream callers relying on old assumptions.
- Legacy scripts may still be used operationally even if their semantics are outdated.

## Open Questions

- Should `client_contracts.template_contract_id` remain as provenance-only metadata for renewals/draft-resume/debug flows, or is the codebase ready to deprecate it entirely after this cleanup?
- For flows that still need authoring-source context, should the source template ID be required data, or should the flow be redesigned to avoid re-reading authoring tables entirely?
- Do any remaining UI/detail surfaces still need explicit provenance labels once runtime fallback behavior is removed?

## Acceptance Criteria

- No live runtime contract application, line-clone/setup, or billing-adjacent flow derives template source with `template_contract_id ?? contract_id`.
- Remaining `template_contract_id` references are either provenance-only reads, tests/fixtures, or migration history.
- Legacy scripts no longer preserve hybrid template/runtime fallback behavior.
- Shared interfaces and runtime loaders no longer blur provenance metadata with live runtime identity.
- Focused DB-backed integration tests and static guards prove the remaining fallback patterns are gone from the targeted packages.
