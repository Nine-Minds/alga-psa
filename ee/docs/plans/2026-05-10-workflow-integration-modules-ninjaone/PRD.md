# PRD — Workflow Integration Modules: NinjaOne First Pass

- Slug: `2026-05-10-workflow-integration-modules-ninjaone`
- Date: `2026-05-10`
- Status: Draft

## Summary

Add a first-party workflow integration module system so enabled integrations can appear as app-specific modules in the Workflow Designer. The first implementation will expose a NinjaOne module when a tenant is actively using NinjaOne and will provide a focused set of NinjaOne workflow actions for devices and alerts.

## Problem

Workflow actions are currently registered globally and grouped mostly by action ID prefix. This works for generic PSA capabilities, but not for tenant-specific integrations. Users should only see integration-specific workflow modules when that integration is configured and active for their tenant. Integration-owned actions also need a clear registry pattern so new integrations can add their own workflow capabilities without hardcoding each one into the generic designer.

## Goals

- Add a formal registry for first-party workflow integration modules.
- Allow each integration module to define catalog metadata, action IDs, default action, icon/logo token, and tenant availability logic.
- Show the NinjaOne module in the Workflow Designer only when NinjaOne is actively in use for the tenant.
- Register real NinjaOne workflow actions for a representative mixed set of read, sync, and side-effect operations.
- Use user-facing terminology in the designer, following least surprise for MSP operators.
- Preserve the generic Ticket module as the way to create tickets from NinjaOne alert outputs.

## Non-goals

- Do not build workflow modules for accounting, Entra, Google, email, or calendar in this first pass.
- Do not add a NinjaOne-specific “create ticket from alert” action.
- Do not add a new permission model for NinjaOne workflow actions; workflow editors can use them.
- Do not redesign the entire Workflow Designer palette.
- Do not replace the existing ActionRegistry or NodeTypeRegistry.
- Do not introduce a generalized external extension marketplace mechanism beyond the first-party module registry.

## Users and Primary Flows

### Target users

- MSP workflow builders who configure automation in Alga PSA.
- MSP admins who have connected NinjaOne and want workflow automation around RMM devices and alerts.

### Primary flow: discover NinjaOne actions

1. A tenant has an active NinjaOne RMM integration.
2. A workflow editor opens the Workflow Designer.
3. The palette shows a NinjaOne app tile with the NinjaOne logo/icon.
4. The user adds the NinjaOne node to a workflow.
5. The node action dropdown shows NinjaOne-specific actions only.

### Primary flow: automate from NinjaOne alert to generic ticket creation

1. The user adds a NinjaOne action such as “List active alerts” or “Get alert.”
2. The action returns normalized alert fields including alert ID, severity, device ID, asset ID, title/message, and timestamps.
3. The user adds a generic Ticket module action, such as `tickets.create`.
4. The ticket input mapping uses outputs from the NinjaOne alert step.

### Primary flow: device operation

1. The user adds a NinjaOne “Find devices” or “Sync device” action.
2. The user maps an external NinjaOne device ID, asset ID, or search criteria.
3. The workflow runs and returns normalized device information for downstream steps.
4. For “Reboot device,” the action sends a device reboot command with engine-provided idempotency.

## UX / UI Notes

- The Workflow Designer palette should show a NinjaOne app tile only for tenants actively using NinjaOne.
- The tile should use a NinjaOne-specific icon/logo token, not a generic app icon when the UI supports it.
- Action labels must be operator-facing:
  - `ninjaone.alerts.reset` should display as **Acknowledge alert**.
  - Descriptions can clarify that acknowledging uses the NinjaOne reset operation.
- Generic PSA actions remain in generic modules. Creating tickets from NinjaOne alerts should be done with the Ticket module.
- If NinjaOne becomes inactive after a workflow was authored, existing workflow definitions may still reference NinjaOne actions, but execution should fail fast with a clear configuration error.

## Requirements

### Functional Requirements

1. Add a workflow integration module registry for first-party integrations.
2. Support integration module metadata: group key, label, description, tile kind, icon token, default action ID, allowed action IDs, and availability key/resolver.
3. Extend designer catalog building so registered integration modules produce stable app records rather than relying only on action ID prefix grouping.
4. Extend catalog availability filtering so first-party integration records are shown only when their resolver reports the tenant is using the integration.
5. Preserve existing extension app filtering behavior.
6. Define NinjaOne availability as an active tenant RMM integration:
   - `rmm_integrations.provider = 'ninjaone'`
   - `rmm_integrations.is_active = true`
   - `rmm_integrations.connected_at IS NOT NULL`
7. Register a NinjaOne workflow module with the actions listed below.
8. Register these NinjaOne workflow actions:
   - `ninjaone.devices.find` — Find/list devices from local mapping and/or NinjaOne API criteria.
   - `ninjaone.devices.sync` — Sync a single NinjaOne device into Alga assets.
   - `ninjaone.devices.reboot` — Send a reboot command to a NinjaOne device.
   - `ninjaone.alerts.list_active` — List active NinjaOne alerts.
   - `ninjaone.alerts.get` — Get one alert by external alert ID or alert UID.
   - `ninjaone.alerts.reset` — Display as **Acknowledge alert** and call the NinjaOne reset operation.
9. Action outputs should be normalized enough for downstream generic PSA modules.
10. Side-effect actions must use engine-provided idempotency.
11. Runtime handlers must validate tenant context and fail fast if NinjaOne is inactive or missing required credentials.
12. Temporal worker bootstrap must register the same NinjaOne actions used by server-side catalog/publish validation.

### Non-functional Requirements

- Keep integration-specific code coupled to the NinjaOne integration module, not to generic workflow designer components.
- Keep the registry API small and explicit so other integrations can adopt the pattern later.
- Do not silently fall back to showing unavailable integration modules.
- Keep labels and descriptions translatable via existing workflow i18n fallback patterns where practical.

## Data / API / Integrations

### Existing data sources

- `rmm_integrations` determines NinjaOne availability.
- `tenant_external_entity_mappings`, assets, and `rmm_organization_mappings` may support local device lookup and sync context.
- Existing NinjaOne client and sync engine code under `ee/server/src/lib/integrations/ninjaone/` should be reused for external API calls and device sync.
- Existing `rmm_alerts` can support local alert lookup; NinjaOne API calls can support fresh list/get/reset behavior where existing client methods exist.

### Registry/API design

- Add a first-party workflow integration module registry in the workflow runtime layer.
- Add server-side availability resolver loading for catalog records. Resolvers should be keyed, e.g. `rmm:ninjaone`, so module metadata remains declarative.
- Extend `buildWorkflowDesignerActionCatalog` to accept registered module definitions or a parallel module catalog overlay.
- Continue returning catalog records from `/api/workflow/registry/designer-catalog`.

## Security / Permissions

- Any user who can edit/manage workflows may add NinjaOne workflow actions.
- Runtime execution should use existing workflow execution permissions and tenant isolation.
- Handlers must ensure tenant ID is present and use tenant-scoped DB/API helpers.
- Reboot and acknowledge alert are side-effectful and must rely on workflow action idempotency.
- Do not expose NinjaOne secrets in action outputs, examples, logs, or catalog payloads.

## Observability

- Use existing action execution records and workflow step logs.
- Use existing NinjaOne integration logging where handlers delegate to existing services.
- No new dashboards or metrics are required in this first pass.

## Rollout / Migration

- No schema migration is expected for the first pass.
- Existing workflow definitions should continue to validate and run.
- New NinjaOne actions become available only after runtime initialization and tenant availability checks pass.
- If a tenant disconnects NinjaOne after authoring a workflow, publish/runtime validation should not expose new nodes, and execution should fail with a clear inactive-integration error.

## Open Questions

- Should the first implementation render a true NinjaOne SVG/logo asset, or is a `ninjaone` icon token mapped in the palette sufficient for this pass?
- Should `ninjaone.devices.find` read only local synced assets/mappings, call the live NinjaOne API, or support both via an input mode? Recommendation: support local-first lookup with optional live API search only if existing client methods make it low risk.

## Acceptance Criteria (Definition of Done)

- An active NinjaOne tenant sees a NinjaOne module in the Workflow Designer palette.
- A tenant without active NinjaOne does not see the NinjaOne module.
- Adding the NinjaOne module creates an `action.call` step scoped to the NinjaOne action list.
- The action dropdown shows the six approved NinjaOne actions with user-facing labels.
- `ninjaone.alerts.reset` is labeled **Acknowledge alert**.
- NinjaOne alert outputs can be mapped into a generic `tickets.create` step.
- Side-effect actions are idempotent under workflow retries.
- Publish validation and Temporal runtime both recognize the NinjaOne actions.
- Tests cover catalog availability, action registration, side-effect idempotency/config guards, and a representative action happy path.
