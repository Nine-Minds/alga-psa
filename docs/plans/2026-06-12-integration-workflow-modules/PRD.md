# PRD: Integration Workflow Modules

- **Status:** Draft
- **Owner:** Robert Isaacs
- **Created:** 2026-06-12
- **Design:** `../2026-06-12-integration-workflow-modules-design.md` (architecture authority)
- **Branch:** `feature/integration-workflow-modules` off `main`

## 1. Problem statement & user value

The workflow designer can host integration-specific "app" modules — palette
tiles exposing an integration's operations as typed workflow actions, shown
only when that integration is connected — but exactly one exists (NinjaOne,
6 actions), its availability check is a hardcoded if-chain, and its module
wiring is inlined in `core.ts`. Meanwhile the operations MSPs actually
orchestrate across tools (run a script on an endpoint, trigger an RMM
automation, resolve a security incident, post to a Teams channel, put a
technician on the schedule) are absent from the palette, so the
"self-healing alert" loop the RMM alert events enable cannot be finished
inside Alga.

This project generalizes the module plumbing so each integration is one
self-contained registration, then ships four new modules (Tactical RMM,
Level, Huntress, Microsoft Teams), expands NinjaOne with script execution,
and adds a core `scheduling.create_entry` action. Incumbent PSAs offer no
user-composable canvas over third-party tools; the market's answer is a
separate $500–1,500/mo orchestration product. This puts it in the PSA.

## 2. Goals

- Adding integration #6 requires one file plus one `core.ts` line — no
  framework edits, no availability if-chain.
- A connected Tactical RMM tenant can run a stored script or raw command on
  an agent from a workflow and use its output in later steps.
- A connected Level tenant can trigger a Level automation (optionally scoped
  to specific devices) and check its run status.
- A connected Huntress tenant can enrich tickets from incident/agent/org
  data and resolve the Huntress incident when work completes.
- A tenant with the Teams app active can notify a user's activity feed, DM a
  user via the bot, and post to a channel where the app is installed.
- Workflows can create dispatch-board schedule entries that ride the
  existing calendar sync to a technician's connected external calendar.
- Palette tiles appear if and only if the integration is available for the
  tenant; NinjaOne behavior is unchanged (parity regression).

## 3. Non-goals

- QuickBooks Online / Stripe modules (financial follow-up, deliberately
  deferred), Tanium (pre-release).
- Email app tile (`email.send` already covers tenant-provider send) and a
  direct Calendar app tile (schedule-entry approach chosen instead).
- Huntress remediation approve/reject (sharp edge; revisit on demand).
- DB-backed module catalog or per-tenant module curation.
- Prebuilt workflow recipe gallery (launch follow-up, separate effort).
- New vendor capabilities beyond those listed (e.g. Tactical service
  control, NinjaOne patch apply).

## 4. Personas & primary flows

- **Automation-minded MSP engineer:** builds "disk-full self-remediation":
  RMM alert trigger → `tacticalrmm.agents.run_script` (cleanup script) →
  ticket note with output → `levelio.alerts.resolve` / alert reset → ticket
  closes. Builds "Huntress enrichment": ticket-created trigger →
  `huntress.incidents.get` + `huntress.agents.get` → ticket fields/note →
  on close, `huntress.incidents.resolve`.
- **Dispatcher:** escalation workflow posts to the service-desk Teams
  channel and creates a schedule entry for the on-call technician.
- **Tenant admin:** connects/disconnects integrations and sees palette
  tiles appear/disappear accordingly; no configuration beyond the
  integration itself.

## 5. Framework changes (build first)

### 5.1 Availability resolver registry

New registry in `shared/workflow/runtime/registries/` (sibling of
`integrationModuleRegistry.ts`): resolver type
`(knex, tenantId) => Promise<boolean>` registered under a module's
`availabilityKey`. `loadAvailableFirstPartyIntegrationAppKeys`
(`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`)
replaces its if-chain with registry lookups; a module whose key has no
registered resolver is **not** available (fail closed). Resolver errors are
caught and treated as unavailable (palette listing must not 500 because one
vendor table is missing).

### 5.2 RMM availability factory

`rmmIntegrationAvailability(provider)` returns a resolver checking
`rmm_integrations` for `(tenant, provider)` with `is_active = true` and
`connected_at IS NOT NULL` — used by all four RMM modules.

### 5.3 One-call module registration + NinjaOne migration

`registerIntegrationWorkflowModule({ module, availability, registerActions })`
in `ee/packages/workflows`: registers actions, the module tile, and the
availability resolver, idempotently. `core.ts` becomes one call per
integration. NinjaOne migrates onto the helper and the RMM factory; the
hardcoded `'rmm:ninjaone'` branch is deleted. Regression bar: identical
palette/catalog output for connected and disconnected NinjaOne tenants.

## 6. Modules

Conventions for every action: `provider.noun.verb` ID, Zod input/output
schemas, `ui: { label, description, category, icon }`, correct
`sideEffectful`, `idempotency: { mode: 'engineProvided' }`, handler errors
thrown (engine normalizes). Vendor endpoint paths marked *verify* must be
confirmed against vendor docs during implementation.

### 6.1 NinjaOne expansion (`app:ninjaone`)

`FetchNinjaOneWorkflowClient` gains `runScript` (`POST
/v2/device/{id}/script/run`; type SCRIPT|ACTION, parameters, runAs) and a
scripting-options discovery call (*verify*, expected `GET
/v2/device/{id}/scripting/options`). New actions
`ninjaone.devices.run_script` (side-effectful) and
`ninjaone.devices.scripting_options` (read) join the existing six in
`allowedActionIds`.

### 6.2 Tactical RMM (`app:tacticalrmm`)

Client: extend `TacticalRmmClient`
(`packages/integrations/src/lib/rmm/tacticalrmm/tacticalApiClient.ts`) with
agent-detail, script-list, run-script, run-command, reboot wrappers
(*verify* paths: `/scripts/`, `/agents/{agent_id}/runscript/`,
`/agents/{agent_id}/cmd/`, `/agents/{agent_id}/reboot/`). The workflows
package takes a dependency on `packages/integrations`; runtime support
resolves the integration row + tenant secrets (`tacticalrmm_api_key` or
Knox trio) exactly as the existing sync path does.

Actions: `agents.find`, `agents.get`, `scripts.list`,
`agents.run_script` (returns output), `agents.run_command`,
`agents.reboot` (last three side-effectful).

### 6.3 Level (`app:levelio`)

Client: thin fetch client inside the workflows package (NinjaOne pattern —
`ee/server` client not importable). Tenant secret `levelio_api_key`;
cursor pagination as in the existing client.

Actions: `devices.find`, `devices.get`, `alerts.list_active`,
`alerts.resolve` (side-effectful, `POST /v2/alerts/{id}/resolve`),
`updates.list`, `automations.list` (automations + their webhook tokens),
`automations.trigger` (side-effectful, `POST
/v2/automations/webhooks/{token}` with optional `device_ids[]`; actionable
error when the automation has no webhook trigger configured in Level),
`automations.run_status`.

### 6.4 Huntress (`app:huntress`)

Client: thin fetch client in the workflows package; Basic auth from tenant
secrets `huntress_api_key`/`huntress_api_secret`; replicate the 60 req/min
throttle and 429 backoff of the `ee/server` client.

Actions: `incidents.find`, `incidents.get`, `incidents.resolve`
(side-effectful; Huntress write API, *verify* exact endpoint),
`organizations.list`, `agents.get`, `account.get`.

### 6.5 Microsoft Teams (`app:teams`)

Availability: own resolver — `teams_integrations.install_status = 'active'`
AND the Teams add-on active for the tenant (mirror the delivery path's
checks). The workflows package depends on `ee/packages/microsoft-teams`.

Actions (all side-effectful):

- `teams.notify_user` — Graph `sendActivityNotification` through the
  existing delivery path with a generic template; target is an Alga user
  with a linked Microsoft account; actionable error otherwise.
- `teams.send_dm` — proactive Bot Framework message (text + optional card)
  via stored `teams_conversation_references`; actionable error if the user
  has never opened the bot.
- `teams.post_to_channel` — requires **new** `createConversation` support
  in `ee/packages/microsoft-teams` (proactive channel conversation via Bot
  Framework; Graph app-only channel posting is Microsoft-protected, the bot
  route is deliberate). Works in any channel of a team where the Alga
  Teams app is installed; actionable error otherwise.

## 7. Core action: `scheduling.create_entry`

Shared (CE+EE) action in the `scheduling.*` business-operations family.
Inputs: assigned user(s), title, start/end, optional ticket/project link,
optional status/notes. Creates a dispatch-board schedule entry through the
same model layer the UI uses; the existing calendar sync pushes it outward
to a connected user calendar. Validation errors (unknown user, end before
start) are explicit.

## 8. Designer surface

Icon tokens for `tacticalrmm`, `levelio`, `huntress`, `teams` added to the
designer icon set, reusing the integration logos already shipped in the
settings UI. Palette grouping/ordering verified for the new `app:*` groups
(extend `PALETTE_CATEGORY_ORDER` handling only if required).

## 9. Error handling conventions

Handlers throw; the Temporal activity layer normalizes to the runtime error
payload and stamps `workflow_action_invocations` FAILED. Vendor HTTP errors
surface status + vendor message, never credentials. Most-common failures
get explicit messages: integration not connected/inactive; Level automation
lacks webhook trigger; Teams user unlinked / no bot conversation / app not
in team. Side-effectful actions rely on engine-provided idempotency so
retries are safe.

## 10. Testing & rollout

Unit: handler tests per integration with mocked clients (NinjaOne handler
test pattern); availability-registry and resolver tests; helper idempotency;
catalog gating matrix. Regression: NinjaOne palette parity. Manual smoke on
the local-test stack: palette gating on connect/disconnect, Tactical mock
run-script round-trip, Teams notify/DM/channel in a test tenant,
schedule entry on the dispatch board. No migrations and no new tables; all
gating is read-path, so rollout is inert until an integration is connected.
