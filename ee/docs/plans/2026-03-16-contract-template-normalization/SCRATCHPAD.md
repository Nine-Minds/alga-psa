# Scratchpad — Contract Template Normalization

- Plan slug: `contract-template-normalization`
- Created: `2026-03-16`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-16) Treat this as a new standalone ALGA plan rather than appending to `2026-03-16-client-owned-contracts-simplification`. The earlier plan is implementation-specific and already largely shipped; this work is a broader normalization/cutover effort.
- (2026-03-16) Sequence the work as runtime cutover first, API/UI separation second, schema cleanup last. Deleting legacy columns/rows before removing runtime fallback is unsafe.
- (2026-03-16) Treat template instantiation as the only legal transfer boundary between authoring data and runtime data. Existing contracts must be self-contained after instantiation, with no reverse sync from templates.

## Discoveries / Constraints

- (2026-03-16) `packages/billing/src/lib/billing/billingEngine.ts` still resolves live contract lines through `coalesce(cc.template_contract_id, cc.contract_id)` and discount joins still use `template_contract_id OR contract_id`. This is the primary runtime coupling to remove.
- (2026-03-16) `shared/billingClients/templateClone.ts` is already close to the target shape: it reads `contract_template*` tables and writes `contract_*` tables. The remaining question is whether template provenance should survive only as metadata.
- (2026-03-16) `packages/billing/src/actions/contractActions.ts` still maps template rows into `IContract`-shaped responses and falls back from contract lookup to template lookup.
- (2026-03-16) `packages/billing/src/models/contractTemplate.ts` template deletion still deletes from instantiated contract tables (`contract_lines`, `contract_line_service_*`, `contract_line_services`, `contract_line_service_defaults`). This is a hard coupling and a cleanup blocker.
- (2026-03-16) The strongest framing for this plan is not just “remove legacy template flags,” but “make templates authoring-only assets and instantiated contracts self-contained runtime facts.”
- (2026-03-16) `server/scripts/verify-template-migration.ts` currently validates parity between legacy template rows in `contracts` and canonical rows in `contract_templates`, which means the operational model still assumes duplicated storage exists.
- (2026-03-16) `server/scripts/contract-template-decoupling.ts` still preserves hybrid semantics by backfilling or relying on `template_contract_id`.
- (2026-03-16) Schema artifacts still present from the mixed model:
  - `contracts.is_template`
  - `contract_lines.is_template`
  - `client_contracts.template_contract_id`
- (2026-03-16) Citus / distributed-FK constraints are part of the sequencing risk. Some migrations intentionally avoided strict FKs, so application/runtime cleanup cannot assume the database enforces the final invariant today.

## Commands / Runbooks

- (2026-03-16) Recon:
  - `rg -n "is_template|template_contract_id|contract_templates|mapTemplateToContract|isTemplateContract\\(" packages/billing packages/clients server shared`
  - `sed -n '520,590p' packages/billing/src/lib/billing/billingEngine.ts`
  - `sed -n '1,220p' server/scripts/verify-template-migration.ts`
  - `sed -n '1,240p' packages/billing/src/actions/contractActions.ts`
  - `sed -n '120,210p' packages/billing/src/models/contractTemplate.ts`
- (2026-03-16) Plan validation:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-16-contract-template-normalization`

## Links / References

- Prior related plan:
  - `ee/docs/plans/2026-03-16-client-owned-contracts-simplification/`
- Key runtime files:
  - `packages/billing/src/lib/billing/billingEngine.ts`
  - `shared/billingClients/templateClone.ts`
  - `packages/billing/src/actions/contractActions.ts`
  - `packages/billing/src/models/contract.ts`
  - `packages/billing/src/models/contractTemplate.ts`
  - `packages/billing/src/repositories/contractLineRepository.ts`
- Key migration / ops files:
  - `server/migrations/20251020090000_contract_templates_phase1.cjs`
  - `server/migrations/20251020164500_backfill_contract_template_tables.cjs`
  - `server/migrations/20251020180500_update_client_contract_template_foreign_keys.cjs`
  - `server/migrations/20251028090000_remove_contract_line_mappings.cjs`
  - `server/scripts/verify-template-migration.ts`
  - `server/scripts/contract-template-decoupling.ts`

## Open Questions

- Should `client_contracts.template_contract_id` remain as immutable provenance metadata, or should provenance move to a different field/table before full removal?
- Are there production-only support or ops workflows still depending on legacy template rows living in `contracts`?
- Is there any externally consumed contract API that currently depends on template rows being presented as `IContract` and needs a transition path?
