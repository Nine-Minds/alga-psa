# Integration Workflow Modules — Design

- **Date:** 2026-06-12
- **Status:** Approved (brainstorm: Robert + Claude)
- **Branch:** `feature/integration-workflow-modules` (cut from `main`)
- **Predecessor context:** the RMM alert handling feature (`feature/rmm-alerts-sync`, PR #2694) made `RMM_ALERT_TRIGGERED` / `RMM_ALERT_RESOLVED` available as workflow triggers. This project is independent of that branch (all adapters and the module registry are on `main`), but together they complete the "self-healing alert" loop.

## Goal

The workflow designer supports integration-specific "app" modules — palette tiles that expose an integration's operations as workflow actions, shown only when that integration is connected. Today exactly one exists (NinjaOne, 6 actions). This project:

1. Generalizes the module plumbing so each integration is a self-contained, drop-in registration (Approach B from the brainstorm).
2. Adds four new modules — **Tactical RMM, Level, Huntress, Microsoft Teams** — each exposing its ~5 highest-value actions.
3. Expands the existing **NinjaOne** module with script execution (the original motivating example).
4. Adds one core action, **`scheduling.create_entry`**, filling a gap in the `scheduling.*` family (reschedule/cancel exist; create does not).

### Why it matters (market context)

Incumbent PSAs (ConnectWise, Autotask, Halo) have trigger/condition/action rules and hardcoded vendor-pair integrations, but no user-composable canvas with third-party integration actions. The market's answer is a separate orchestration product (Rewst, MSPbots, n8n) at $500–1,500+/mo. All-in-one platforms (Syncro, Atera, SuperOps) can "run script on alert" only inside their own walled garden. PSA-native cross-tool orchestration — alert fires → workflow runs a diagnostic script via the customer's actual RMM → attaches output → resolves alert → ticket closes — is a story none of them tell. Catalog depth is the moat; this project's framework work is what makes integration #6 (QBO et al.) cheap.

Secondary asset: every action registered here is a Zod-schema'd, idempotent, tenant-scoped operation — a tool catalog future AI agents can call safely.

## Scope

**In scope**

- Availability-resolver registry + `registerIntegrationWorkflowModule` helper; NinjaOne migrated onto both (palette parity is the regression to guard).
- Tactical RMM module (6 actions, incl. run script/command/reboot — requires thin client wrappers for endpoints the vendor API already has).
- Level module (8 actions, incl. the automation trio: list / trigger-by-webhook / run status).
- Huntress module (6 actions, incl. `incidents.resolve` via Huntress's new write API).
- Teams module (3 actions: notify user, bot DM, post to channel — channel posting needs new bot-framework `createConversation` support).
- NinjaOne expansion: `devices.run_script` + script/action discovery read.
- Core `scheduling.create_entry` action (shared, CE+EE).
- Designer icon tokens for the four new tiles (reuse existing settings-UI integration logos).

**Deferred (explicit decisions)**

| Item | Reason |
| --- | --- |
| QuickBooks Online, Stripe | External financial integrations held for a dedicated follow-up (Robert wants to think the financial surface through). The framework makes this cheap when it lands. |
| Tanium | Pre-release. |
| Email app module | `email.send` (shared core action) already sends via the tenant's configured M365/Gmail/SMTP provider; a tile would duplicate it. |
| Calendar app module | Calendar connections are per-user; direct external-calendar writes bypass the Alga dispatch board. Decision: `scheduling.create_entry` instead — lands on the board AND syncs outward via existing calendar sync when the user has a connected calendar. |
| Huntress remediation approve/reject | Vendor API supports it, but auto-approving SOC remediations from a workflow is a sharp edge. Revisit on demand. |
| DB-backed module catalog / per-tenant module curation (Approach C) | YAGNI; in-code registry does the job. |
| Recipe gallery (prebuilt workflows) | Launch/marketing concern, separate effort — but it is what sells this; see Open items. |

## Architecture

### Current state (facts, file paths as of `main` @ 2c392acc9e)

- Module type + in-memory registry: `shared/workflow/runtime/registries/integrationModuleRegistry.ts` (`WorkflowIntegrationModuleDefinition`: `groupKey 'app:<x>'`, label, iconToken, `allowedActionIds`, `defaultActionId`, `availabilityKey`).
- Action registry (Zod in/out schemas, `sideEffectful`, idempotency, `ui` metadata, handler): `shared/workflow/runtime/registries/actionRegistry.ts`.
- Palette catalog builder: `shared/workflow/runtime/designer/actionCatalog.ts` (`buildWorkflowDesignerActionCatalog`).
- Availability filtering: `loadAvailableFirstPartyIntegrationAppKeys` in `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts` — currently a hardcoded if-chain keyed on `availabilityKey` (only case: `'rmm:ninjaone'` → `rmm_integrations` row with `is_active` + `connected_at`).
- NinjaOne module: `ee/packages/workflows/src/runtime/actions/registerNinjaOneWorkflowActions.ts` + `ninjaOneWorkflowRuntimeSupport.ts` (self-contained fetch client; `ee/packages/workflows` cannot import from `ee/server` — package/app boundary). Module registered inline in `ee/packages/workflows/src/runtime/core.ts`.
- Execution: Temporal activity `executeWorkflowRuntimeV2ActionStep` → `executeActionInvocation` (`ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts`); engine-provided idempotency, invocation rows in `workflow_action_invocations`, errors normalized to a runtime payload.

### Framework changes (do these first; everything else builds on them)

**1. Availability resolver registry.** New registry in `shared/workflow/runtime/registries/` (sibling of `integrationModuleRegistry`):

```ts
type WorkflowModuleAvailabilityResolver = (knex: Knex, tenantId: string) => Promise<boolean>;
registerWorkflowModuleAvailabilityResolver(availabilityKey: string, resolver: ...): void;
```

`loadAvailableFirstPartyIntegrationAppKeys` drops the if-chain: for each registered module with an `availabilityKey`, look up the resolver and call it. No resolver registered → module not available (fail closed). A parameterized factory `rmmIntegrationAvailability(provider)` covers all four RMMs (`rmm_integrations` row: `provider = X`, `is_active`, `connected_at IS NOT NULL`). Teams gets its own resolver (see below). NinjaOne's hardcoded branch is deleted and replaced by `rmmIntegrationAvailability('ninjaone')`.

**2. One-call module registration.** Helper in `ee/packages/workflows`:

```ts
registerIntegrationWorkflowModule({
  module: WorkflowIntegrationModuleDefinition,
  availability: WorkflowModuleAvailabilityResolver,
  registerActions: (registry: ActionRegistryV2) => void,
});
```

It registers actions, the module tile, and the availability resolver, idempotently (same guard style as today's `core.ts`). Each integration becomes exactly one file under `ee/packages/workflows/src/runtime/actions/` (plus a runtime-support file where a client must be built); `core.ts` becomes one call per integration.

### Modules and actions

Conventions: action IDs are `provider.noun.verb`; every action follows the NinjaOne registration shape (Zod input/output, `ui: { label, description, category, icon }`, `sideEffectful`, `idempotency: { mode: 'engineProvided' }`).

**NinjaOne — `app:ninjaone` (expansion of existing module)**

| Action | Side-effect | Vendor surface |
| --- | --- | --- |
| `ninjaone.devices.run_script` | yes | `POST /v2/device/{id}/script/run` — type `SCRIPT` or built-in `ACTION`, parameters, `runAs` |
| `ninjaone.devices.scripting_options` | no | device script/action discovery (verify exact path, expected `GET /v2/device/{id}/scripting/options`) |

Existing six actions unchanged. `FetchNinjaOneWorkflowClient` gains the two methods.

**Tactical RMM — `app:tacticalrmm`** (availability: `rmmIntegrationAvailability('tacticalrmm')`)

| Action | Side-effect | Vendor surface (verify exact paths against Tactical API during implementation) |
| --- | --- | --- |
| `tacticalrmm.agents.find` | no | `/api/beta/v1/agent/` (already wrapped) |
| `tacticalrmm.agents.get` | no | agent detail |
| `tacticalrmm.scripts.list` | no | `/scripts/` — needed to pick a script ID |
| `tacticalrmm.agents.run_script` | yes | `/agents/{agent_id}/runscript/` — returns output |
| `tacticalrmm.agents.run_command` | yes | `/agents/{agent_id}/cmd/` — raw shell |
| `tacticalrmm.agents.reboot` | yes | `/agents/{agent_id}/reboot/` |

Client: reuse `TacticalRmmClient` (`packages/integrations/src/lib/rmm/tacticalrmm/tacticalApiClient.ts`) — `ee/packages/workflows` may depend on `packages/integrations`. New endpoint wrappers are added to that client (they benefit non-workflow callers too). Credentials: existing tenant secrets (`tacticalrmm_api_key` / Knox trio) + `rmm_integrations.instance_url`.

**Level — `app:levelio`** (availability: `rmmIntegrationAvailability('levelio')`)

| Action | Side-effect | Vendor surface |
| --- | --- | --- |
| `levelio.devices.find` | no | `GET /v2/devices` (group filters) |
| `levelio.devices.get` | no | `GET /v2/devices/{id}` |
| `levelio.alerts.list_active` | no | `GET /v2/alerts` |
| `levelio.alerts.resolve` | yes | `POST /v2/alerts/{id}/resolve` |
| `levelio.updates.list` | no | `GET /v2/updates` (patch posture) |
| `levelio.automations.list` | no | automations + their webhooks (discovery for trigger) |
| `levelio.automations.trigger` | yes | `POST /v2/automations/webhooks/{token}`, optional `device_ids[]` — Level's remote-execution model. Error message must say "automation needs a webhook trigger configured in Level" when applicable |
| `levelio.automations.run_status` | no | show automation run |

Client: thin fetch client in the workflows package (NinjaOne-style; the `ee/server` Level client is not importable). Tenant secret `levelio_api_key`; base URL per existing convention.

**Huntress — `app:huntress`** (availability: `rmmIntegrationAvailability('huntress')`)

| Action | Side-effect | Vendor surface |
| --- | --- | --- |
| `huntress.incidents.find` | no | `GET /v1/incident_reports` (status/severity/org filters) |
| `huntress.incidents.get` | no | incident report by id |
| `huntress.incidents.resolve` | yes | Huntress write API (resolve incident report) — bidirectional close parity |
| `huntress.organizations.list` | no | `GET /v1/organizations` |
| `huntress.agents.get` | no | `GET /v1/agents/{id}` |
| `huntress.account.get` | no | `GET /v1/account` |

Client: thin fetch client in the workflows package. Tenant secrets `huntress_api_key` / `huntress_api_secret` (Basic auth); replicate the 60 req/min throttle + 429 backoff from the `ee/server` client. Primary use is enrichment (ticket workflows pulling incident + agent detail) plus close-the-loop resolve.

**Microsoft Teams — `app:teams`** (availability: own resolver — `teams_integrations.install_status = 'active'` AND Teams add-on active, mirroring the delivery path's checks)

| Action | Side-effect | Mechanism |
| --- | --- | --- |
| `teams.notify_user` | yes | Graph `sendActivityNotification` via existing delivery path (`ee/packages/microsoft-teams`), generic template; target is an Alga user with a linked Microsoft account |
| `teams.send_dm` | yes | proactive Bot Framework message (text + optional card) via stored `teams_conversation_references`; explicit error if the user has never opened the bot |
| `teams.post_to_channel` | yes | **new** bot-framework `createConversation` support in `ee/packages/microsoft-teams`; works in any channel of a team where the Alga Teams app is installed. Graph app-only channel posting is a Microsoft-protected API — the bot route is deliberate |

`ee/packages/workflows` depends on `ee/packages/microsoft-teams` (package→package is fine). `post_to_channel` is the implementation-heavy item of the project.

**Core action — `scheduling.create_entry`** (shared, CE+EE, in the `scheduling.*` business-operations family)

Inputs: assigned user(s), title, start/end, optional ticket/project link, optional status/notes. Creates a dispatch-board schedule entry; the existing calendar sync pushes it to the assignee's connected external calendar. No Calendar app tile.

### Error handling

NinjaOne conventions throughout: handlers throw; the engine normalizes to the runtime error payload and stamps the invocation `FAILED`. Vendor HTTP errors surface status + vendor message, never credentials. The two most common failures get explicit, actionable messages: "integration not connected / inactive" and (Teams) "user has no bot conversation" / "app not installed in that team". Side-effectful actions rely on engine-provided idempotency so Temporal retries are safe.

### Testing

- Handler unit tests per integration with mocked clients, mirroring `ninjaOneWorkflowActions.handlers.test.ts`.
- Availability-resolver tests; the NinjaOne migration's regression bar is palette parity before/after.
- Catalog tests: tiles appear only for connected integrations (extend existing `actionCatalog` tests).
- Manual smoke on the local-test stack: Tactical mock server round-trip for `run_script`/`run_command`; palette gating on connect/disconnect; `scheduling.create_entry` → entry on dispatch board.

## Vendor grounding (verified 2026-06-12)

The action lists were verified against vendor APIs, not just Alga's existing adapter code — which corrected three assumptions:

- NinjaOne run-script: [NinjaOne Public API — runScriptOnDevice](https://app.ninjarmm.com/apidocs-beta/core-resources/operations/runScriptOnDevice)
- Level automation trigger with `device_ids`: [Level API — Trigger webhook](https://levelapi.readme.io/reference/triggerwebhook); [Level public API overview](https://level.io/blog/level-public-api)
- Huntress write APIs (resolve incident reports, remediation responses): [Huntress changelog](https://feedback.huntress.com/changelog/apis-for-escalations-and-incident-report-responses-now-available); [Huntress REST API overview](https://support.huntress.io/hc/en-us/articles/4780697192851-Huntress-REST-API-Overview)

Exact endpoint paths marked "verify" above must be confirmed against vendor docs during implementation.

## Open items / follow-ups (not in this branch)

- **Recipe gallery**: 3–4 prebuilt workflows ("disk-full self-remediation", "Huntress incident enrichment + bidirectional close", "escalation fan-out to Teams channel") — this is what demos and sells the feature.
- **Financial follow-up**: QBO (+ Stripe) module on this framework, pending Robert's call on the financial action surface.
- **Tanium module** when the integration leaves pre-release.
- **Huntress remediation approve/reject** if customer demand materializes.
