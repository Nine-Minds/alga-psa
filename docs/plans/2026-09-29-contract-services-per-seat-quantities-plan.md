# Plan — Contract services: per-seat recurring quantities (wizard, templates, presets, quote conversion)

Card: 174cf6a7 (alga-2026 task). Parent: contract products quantity/price scheduling, PR #3492.
Author: XO (conn design desk). Date: 2026-09-29.

## Goal

Make per-unit recurring services ("Managed Workstation x 42 at $50") first-class on **every**
contract-authoring path, so an operator can set a seat count when authoring and change it later
through the existing seat-revision path. The billing engine already supports this; the gap is
authoring reach.

## Scope

In: contract wizard Fixed step, contract template wizard + preview + detail + model, contract-line
presets UI, quote-to-contract conversion for recurring service items, and API/type exposure.
Out: mid-period **price** proration (boundary-only price policy stands, per the parent card's
Option B); auto-syncing seat counts from assets/users/RMM; any change to existing bundle/allocation
rows; product conversion behavior.

## What already exists — reuse, do not rebuild

- **Unit-priced fixed lines**: `contract_line_service_fixed_config.pricing_basis = 'unit'`
  (recurring quantity × unit rate) vs `'bundle'` (allocation splits the line total).
  Billing: `packages/billing/src/lib/billing/compute/computeFixedCharges.ts`,
  `pricing/loadFixedLineRateInputs.ts`, `shared/billingClients/resolveFixedLineRate.ts`,
  `contractMonthlyValue.ts`.
- **Dated seat revisions with billed-period protection**:
  `packages/billing/src/lib/billing/seatRevisions.ts`,
  `actions/contractLineUnitPricingActions.ts`,
  `services/contractLineServiceConfigurationService.ts` (~L297–315 turns a quantity/rate edit on a
  unit-priced service into a revision at the next unbilled boundary).
- **The reference authoring control**: `FixedServiceConfigPanel`
  (`packages/billing/src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel.tsx`)
  already renders the pricing-basis + unit-rate choice. `CreateCustomContractLineDialog.tsx` uses it
  at L416–431 with `configuration={{ pricing_basis, base_rate: unit_rate }}`; the dialog's own model
  is `{ service_id, service_name, quantity, pricing_basis: 'bundle'|'unit', unit_rate? }`
  (L67), validates a unit rate when `pricing_basis === 'unit'` (L139), sends `pricing_basis` per
  service (L224) and requires `base_rate` only when at least one bundle member exists (L273).
  **This dialog is the behavior to replicate exactly.**
- **A schedule UI to mount for existing lines**: `RecurringUnitSchedulePanel.tsx` (added by #3492),
  mounted on product rows and unit-priced Fixed service rows.
- **Backend input support already partially present**: `contractWizardActions.ts` already types
  `unit_rate?` on both `TemplateFixedServiceInput` (L78) and `ClientFixedServiceInput` (L136), and
  `contractLinePresetActions.ts` already accepts `pricing_basis?: 'bundle'|'unit'` (L648), validates
  it (L709–712) and defaults it (L824). The gap is the **UI and the persistence of `pricing_basis`
  through the wizard/template paths**, plus quote conversion.

## Work items (in order)

1. **Shared per-service row model.** Extend `ContractWizardData.fixed_services`
   (`ContractWizard.tsx` L161) with `pricing_basis: 'bundle' | 'unit'` (default `'bundle'`) and
   `unit_rate?: number | null`. Keep `quantity` semantics: allocation quantity for bundle, recurring
   seats for unit. Same shape for the template wizard's fixed-service type. Extract nothing to a new
   hook yet; the `FixedServiceConfigPanel` is the shared component.

2. **Contract wizard — `FixedFeeServicesStep.tsx`.** Per service: add the basis choice and, when
   `unit`, a whole-number quantity (≥ 0) + unit-rate input mirroring the dialog's labels
   ("Recurring quantity" vs "Allocation quantity", recurring seats/units terminology). Reuse
   `FixedServiceConfigPanel` (idPrefix per row) for the basis + rate control. Prefill the unit rate
   from the service catalog price in the contract currency (reuse the alga-2026-0002525 catalog
   prefill), overridable. Change the quantity `min` from 1 to 0 for unit rows. Make the wizard's
   "Recurring Base Rate" required only when at least one allocation member exists (currently it is
   always required once services exist). Show per-unit services in the wizard preview as
   "quantity × unit rate = amount" and include them in the total/recurring preview.

3. **Wizard persistence — `contractWizardActions.ts`.** For each fixed service, set
   `pricing_basis` and, when unit, a `unit`-basis fixed config with the stored `quantity` and
   `unit_rate` — route through the same service-configuration creation path used for unit pricing
   today, and through the revision path on later edits. Both the client-contract and
   template-to-contract entry points (`ClientFixedServiceInput`, L111–165) already carry
   `unit_rate`; thread `pricing_basis` through and stop treating fixed services as always-bundle.
   Verify the Fixed line base rate is derived only from allocation members.

4. **Contract templates.** Persist per-service `pricing_basis`, default quantity and unit rate in the
   template model (`models/contractTemplate.ts` — the `contract_template_line_service_fixed_config`
   writes at L196 and the `contract_template_line_services` copy at L205). UI:
   `template-wizard/steps/TemplateFixedFeeServicesStep.tsx` (mirror item 2),
   `TemplateServicePreviewSection.tsx` (render per-unit rows), and `ContractTemplateDetail.tsx`
   (display). Contracts created from a template inherit basis/quantity/rate; the create-from-template
   step must allow adjusting quantity at creation.

5. **Contract line presets.** The backend already accepts `pricing_basis`
   (`contractLinePresetActions.ts` L648/709/824). Find the preset authoring dialog under
   `billing-dashboard/contract-lines/`, add the same basis choice + unit rate, include the fields in
   the preset payload, and confirm instantiation reproduces unit-priced services faithfully.

6. **Quote-to-contract conversion — `services/quoteConversionService.ts`.** Where a recurring
   **service** quote item (quantity × `unit_price`) becomes a Fixed line today, emit a unit-priced
   fixed service with `quantity` = quoted quantity and `unit_rate` = quoted unit price, instead of
   collapsing to a line amount. Keep discount handling as-is (allocation-based, L186–263), and leave
   **product** conversion unchanged.

7. **API / types / MCP.** Confirm
   `packages/types/src/interfaces/contractLineServiceConfiguration.interfaces.ts` and the REST v1
   contract/contract-line schemas expose `pricing_basis`, recurring `quantity` and `unit_rate` on
   create **and** update, and that MCP-registered endpoints surface them; updates must route through
   `contractLineServiceConfigurationService`'s revision path (~L297–315), not a direct write.

8. **Tests.** Mirror the existing unit-priced fixed-config tests (find them alongside
   `contractLineServiceConfigurationService` / `computeFixedCharges`). Cover: wizard row → unit
   config persisted with quantity + rate; base rate required only with an allocation member; catalog
   prefill; template round-trip incl. quantity adjustment at create; preset instantiation; quote
   conversion preserving quantity × unit price; later quantity edit creating a boundary revision via
   `seatRevisions`; existing bundle rows unchanged.

## Order

Items 1–2–3 are one vertical slice (wizard works end-to-end) and should land first and be validated
against the acceptance example. Then 4 (templates), 5 (presets), 6 (quote conversion), 7 (API
audit), with tests (8) growing alongside each slice.

## Explicitly NOT doing

- Mid-period **price** proration (boundary-only price policy). Quantity true-up is opt-in and already
  exists via #3492.
- Auto-syncing quantities from assets/users/RMM.
- Migrating or changing `pricing_basis` on existing rows.
- Changing product conversion.

## Risks

- **Base-rate semantics**: the line base rate currently means "total fixed fee"; unit members must
  contribute through quantity × unit rate, not the base rate. Getting this wrong double-bills or
  drops revenue. Gate on the acceptance numbers ($3,900 → $4,200).
- **Template model depth**: the template fixed-config rows must be copied to the contract's
  fixed-config on instantiation; a missed field silently demotes a template's per-seat service to an
  allocation. Cover with a template round-trip test.
- **Currency**: unit rate must prefill and display in the contract's currency via the standard
  currency components; never hardcode.
- **Revision bypass**: any update that writes `pricing_basis`/quantity directly instead of through
  the revision path would break billed-period protection.

## Acceptance (from the card)

1. Andrew's example via the wizard as services: Managed User $100 × 20, Managed Endpoint $50 × 30,
   Managed Location $200 × 2 = $3,900/month. Invoice it; schedule Managed User → 23 at the next
   boundary ⇒ $4,200 thereafter, earlier invoice unchanged; exercise the opt-in mid-period quantity
   true-up once.
2. Same package saved as a template, then a contract created from it with adjusted quantities.
3. A preset carrying per-unit services.
4. A quote with a recurring service item converting to a unit-priced service.
