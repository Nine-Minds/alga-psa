# Scratchpad — Integration Workflow Modules

Working notes for the implementation. Design authority:
`../2026-06-12-integration-workflow-modules-design.md`. PRD + feature/test
tracking live alongside this file.

## Verify-during-implementation list (from design)

- NinjaOne scripting-options discovery endpoint exact path (expected
  `GET /v2/device/{id}/scripting/options`).
- Tactical endpoint paths: `/scripts/`, `/agents/{agent_id}/runscript/`,
  `/agents/{agent_id}/cmd/`, `/agents/{agent_id}/reboot/` (and response
  shapes — run_script output retrieval may be task/poll based).
- Huntress incident-resolve write endpoint + payload (changelog announced;
  confirm at api.huntress.io/docs).
- Level `automations.list` response includes webhook tokens, or whether the
  separate "list automation webhooks" endpoint is needed for discovery.

## Implementation order (suggested)

1. Framework (F001–F005) + parity tests — everything else stacks on it.
2. Tactical (marquee actions; mock server exists for smoke).
3. Level, Huntress (thin clients, mostly reads + one write each).
4. Teams (createConversation is the heavy item — do last among modules).
5. scheduling.create_entry + icons/polish.

## Findings

### 2026-06-12 — implementation complete (F001–F032, automated T001–T013)

**Build-boundary constraint shaped all module clients.** The workflows
package's tsup config externalizes every `@alga-psa/*` import, and both
`@alga-psa/integrations/runtime` and `@alga-psa/ee-microsoft-teams` map
their exports to TS *source* — so the workflows dist (loaded by the
tsc-built Temporal worker) cannot import them at runtime. The Teams package
additionally depends on `@alga-psa/workflows` (circular). Consequence:
Tactical, Level, Huntress, and Teams all got self-contained fetch clients
in `ee/packages/workflows/src/runtime/actions/*RuntimeSupport.ts`,
following the pre-existing NinjaOne precedent (which exists for exactly
this reason). PRD 6.2's "reuse TacticalRmmClient" and 6.5's
"createConversation in ee/packages/microsoft-teams" were adjusted
accordingly (noted in features.json F008/F009/F025/F027).

**Vendor verifications completed:**
- NinjaOne: `POST /v2/device/{id}/script/run` confirmed; discovery is the
  `requestScriptingOptions` operation ("Device scripting options get") —
  implemented as `GET /v2/device/{id}/scripting/options`; confirm payload
  shape during T015-style live smoke.
- Tactical: `POST /agents/{id}/runscript/` payload confirmed against
  docs.tacticalrmm.com (output: 'wait' returns script output); cmd/reboot
  paths follow the same agent-route convention — confirm on the mock
  server during smoke.
- Level: all four automation endpooints confirmed against
  levelapi.readme.io (`GET /v2/automations`, `GET /v2/automations/webhooks`
  with full URL + requires_authorization_header, `POST
  /v2/automations/webhooks/{token}` body `{device_ids}`, `GET
  /v2/automation-runs/{id}?include_steps`). The trigger response body is
  undocumented — surfaced as `vendor_response` passthrough.
- Huntress: full OpenAPI fetched from `api.huntress.io/v1/swagger_doc.json`.
  `POST /v1/incident_reports/{id}/resolution` takes NO body; fails 403 when
  the (default, read-only) account API key is used — needs a user-based
  key with resolve permission; 409/422 unless all remediations approved and
  status is 'sent'. All three mapped to actionable errors.

**Teams notify_user** uses the five manifest-declared activity types via a
`category` input (default escalation) rather than free-form
`systemDefault` (would need a manifest change). Deep link is the generic
entity link to the personal tab. `post_to_channel` resolves the regional
Bot Framework serviceUrl from any stored `teams_conversation_references`
row (or explicit `service_url` input) — a tenant with the app installed
but zero stored references gets an actionable error.

**scheduling.assign_user overlap:** it already creates entries but demands
a work-item link and exactly one user; `scheduling.create_entry` is the
superset (optional link → `work_item_type: 'ad_hoc'`, multi-assignee),
reusing the family's eligibility/conflict/audit helpers.

**Pre-existing test failures (verified identical on origin/main, not
ours):** `Schedules.test.tsx`, `payloadSchemaConventions.test.ts`,
`payloadSchemaExamples.test.ts`, `workflowEventFormModeBuilder.test.ts`
(29 tests, env-related), plus `actionCallSchedulingSaveAsRuntime.test.ts`
in shared (module resolution) and the ee/server designer contract tests
failing to *load* here ("No such built-in module: node:" — they should run
in CI; our icon contract test follows the same pattern).

**Test tallies:** workflows package 128 passed / 29 pre-existing failures;
shared scheduling db suite 12/12 against local-test postgres (DB_HOST=
localhost DB_PORT=5472 + admin password from alga-psa secrets); package
tsc clean throughout.

**Remaining: manual smokes T014–T018** need a dev stack running this
branch (palette gating on connect/disconnect, Tactical mock run_script
round-trip, Teams live tenant, dispatch-board + calendar sync check,
icon render).
