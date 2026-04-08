# Scratchpad — Tanium RMM Integration

- Plan slug: `tanium-rmm-integration`
- Created: `2026-04-06`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-04-06) Use a provider-neutral RMM adapter plus shared ingestion path before adding Tanium. Rationale: current NinjaOne and Tactical implementations already diverge enough that a third bespoke stack would compound duplication.
- (2026-04-06) Treat `tenant_external_entity_mappings` as the core asset identity seam for all RMM providers. Rationale: it already exists, is provider-neutral, and both NinjaOne and Tactical depend on it.
- (2026-04-06) Tanium v1 should be inventory-first and scope-mapping-first. Rationale: official Tanium guidance prefers Gateway for querying online/offline systems and reserves module APIs for gaps.
- (2026-04-06) Tanium event push should be modeled as an optional capability, not assumed as a public webhook subsystem. Rationale: official Tanium guidance positions Connect as the push/event delivery method for downstream systems.

## Discoveries / Constraints

- (2026-04-06) `server/src/middleware.ts` hard-codes public or API-key-skipped routes for NinjaOne and Tactical webhooks/callbacks. A new provider with public ingress would currently require another manual middleware change.
- (2026-04-06) `ee/server/src/interfaces/rmm.interfaces.ts` is nominally generic but still contains NinjaOne-specific settings leakage such as `ninja_instance_region`.
- (2026-04-06) `ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts` and `ee/temporal-workflows/src/activities/ninjaone-sync-activities.ts` duplicate asset upsert and external mapping logic.
- (2026-04-06) Official Tanium docs state:
  - Gateway is the preferred integration method.
  - Connect is best for scheduled or event-triggered outbound delivery to files, syslog, webhook, and similar destinations.
  - Asset API is useful for endpoints that have aged out of TDS.
  - Direct Connect is for limited live endpoint troubleshooting/evidence/remediation, not the main integration transport.
- (2026-04-06) Public developer docs give method-selection truth, but exact Gateway schema details still need tenant-backed verification. The docs themselves say the schema reference in Gateway is the most up-to-date source.

## Commands / Runbooks

- (2026-04-06) Pull official Tanium markdown guidance:
  - `curl -L --max-time 20 https://developer.tanium.com/guides/core-platform/integration_methods.md`
  - `curl -L --max-time 20 https://developer.tanium.com/use_cases.md`
- (2026-04-06) Browser inspection of the logged-in Tanium developer portal:
  - `alga-dev list-browsers --allTabs --pretty`
  - `alga-dev browser-eval --paneId=<tanium-pane> --script='(() => document.body.innerText)()'`
  - `alga-dev browser-get-dom --paneId=<tanium-pane> --query='li, a' --pretty`
- (2026-04-06) Repo inspection used for architecture grounding:
  - `rg -n "rmm_organization_mappings|rmm_integrations|tenant_external_entity_mappings" ee packages server -g '!**/node_modules/**'`
  - `sed -n '1,240p' ee/server/src/interfaces/rmm.interfaces.ts`
  - `sed -n '1,220p' ee/server/src/app/api/integrations/ninjaone/callback/route.ts`
  - `sed -n '1,240p' packages/integrations/src/actions/integrations/tacticalRmmActions.ts`

## Links / References

- Official Tanium docs:
  - https://developer.tanium.com/apis/api_intro
  - https://developer.tanium.com/guides/core-platform/integration_methods
  - https://developer.tanium.com/use_cases
  - https://help.tanium.com/bundle/ug_gateway_cloud/page/gateway/index.html
  - https://help.tanium.com/bundle/ug_gateway_cloud/page/gateway/gateway.html
- Key repo files:
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/server/src/middleware.ts`
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/server/migrations/20250502173321_create_tenant_external_entity_mappings.cjs`
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/server/migrations/20251124000001_create_rmm_integration_tables.cjs`
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/ee/server/src/interfaces/rmm.interfaces.ts`
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts`
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/packages/integrations/src/actions/integrations/tacticalRmmActions.ts`
  - `/Users/roberisaacs/alga-psa.worktrees/feature/tanium-integration/packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`

## Open Questions

- What exact Gateway object(s) represent Tanium endpoint inventory in the target tenant?
- What exact field(s) map a Tanium endpoint to an MSP customer/client boundary?
- Is aged-out inventory fallback necessary in the target tenant, or is Gateway sufficient for the required device estate?
- If Connect is used for outbound event delivery, can the customer’s Tanium deployment deliver to the intended Alga-hosted destination model?
- Should Tanium v1 include only inventory, or does the customer expect compliance/vulnerability findings in the initial release?
