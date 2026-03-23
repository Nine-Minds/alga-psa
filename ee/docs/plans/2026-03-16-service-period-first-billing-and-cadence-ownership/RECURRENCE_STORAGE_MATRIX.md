# Recurrence Storage Matrix

This matrix defines the authoritative storage model for recurring authoring defaults during the service-period-first rollout.

## Canonical Storage

| Field | Live contract lines | Template-authored defaults | Preset-authored defaults | Compatibility notes |
| --- | --- | --- | --- | --- |
| `billing_frequency` | `contract_lines.billing_frequency` | `contract_template_lines.billing_frequency` | `contract_line_presets.billing_frequency` | Shared interfaces project the same field directly. |
| `billing_timing` | `contract_lines.billing_timing` | `contract_template_lines.billing_timing` | `contract_line_presets.billing_timing` | `contract_template_line_terms.billing_timing` is legacy read compatibility only and must not outrank `contract_template_lines.billing_timing`. |
| `cadence_owner` | `contract_lines.cadence_owner` | `contract_template_lines.cadence_owner` | `contract_line_presets.cadence_owner` | Existing rows backfill to `client` during staged rollout. |
| `enable_proration` | `contract_lines.enable_proration` | `contract_template_line_fixed_config.enable_proration` | `contract_line_preset_fixed_config.enable_proration` | Fixed-only partial-period compatibility setting. |
| `billing_cycle_alignment` | `contract_lines.billing_cycle_alignment` | `contract_template_line_fixed_config.billing_cycle_alignment` | `contract_line_preset_fixed_config.billing_cycle_alignment` | Legacy compatibility field; no longer part of live recurring execution. |

## Shared Interface Contract

- Authoritative write-shape interfaces:
  - `IContractLine`
  - `IContractTemplateLine`
  - `IContractLinePreset`
- Compatibility projection interfaces:
  - `IClientContractLine`
  - `IContractLineMapping`
  - `IContractLineFixedConfig`
  - `IContractLinePresetFixedConfig`

## Repository And Action Seams

- Live line reads and writes normalize recurring cadence fields through:
  - `shared/billingClients/recurringAuthoringPolicy.ts`
  - `shared/billingClients/recurrenceStorageModel.ts`
  - `packages/billing/src/repositories/contractLineRepository.ts`
  - `server/src/lib/repositories/contractLineRepository.ts`
  - `packages/billing/src/models/contractLine.ts`
- Template-line reads and template-to-contract cloning normalize recurring cadence fields through:
  - `packages/billing/src/models/contractTemplate.ts`
  - `packages/billing/src/repositories/contractLineRepository.ts`
  - `server/src/lib/repositories/contractLineRepository.ts`
  - `packages/billing/src/actions/contractWizardActions.ts`
- Preset reads, writes, and preset-to-contract propagation normalize recurring cadence fields through:
  - `packages/billing/src/models/contractLinePreset.ts`
  - `packages/billing/src/actions/contractLinePresetActions.ts`

## Authoritative Rules

- `contract_lines` is the authoritative live recurring storage surface for v1 runtime execution.
- `contract_template_lines` is the authoritative template recurrence storage surface for cadence owner and billing timing when template authoring supports canonical recurrence semantics.
- `contract_line_presets` is the authoritative preset recurrence storage surface for cadence owner and billing timing when presets are reused into live lines.
- Fixed-only partial-period compatibility settings remain split from cadence/timing on template and preset surfaces until those legacy fixed-config tables are retired.
- Readers may fall back for staged compatibility, but writes must target the authoritative storage surface for the field they own.
