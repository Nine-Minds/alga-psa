# Emulator Suite — Design

- **Date:** 2026-07-26
- **Status:** Approved (brainstorm: Robert + Claude)
- **Branch:** `feature/emulator-suite` (cut from `main` @ `5238788c40`)
- **Audience:** internal developers and CI only. Not an operator/customer-facing tool; no published-image or appliance packaging requirements.

## Goal

One standard way to build, run, and drive vendor-service emulators for integration testing. Today the repo has four unrelated approaches (standalone Graph emulator, in-process QBO simulator, WireMock fixture directories, ad hoc smoke servers). Each new integration re-decides how to fake its vendor, and nothing shares a control story. This project introduces a single framework such that every emulator:

1. Works headless in the test harness (unit tests inject the core in-process; E2E talks HTTP).
2. Is 100% controllable from a CLI, suitable for running as containerized test infrastructure.
3. Can be spun up by any developer for manual smoke testing with one command.
4. Gets a human-friendly web console with zero per-emulator UI work.
5. Runs alongside other emulators in a single process, driven from a single UI.
6. Exposes runtime behavior modification (fault injection, emulator-specific actions) through an extensible registry pattern, so new behaviors are added as data, not as new endpoints/CLI/UI code.

## The organizing rule

Every emulator has exactly two surfaces:

- **Vendor surface** — a faithful imitation of the real service's wire protocol (QBO v3 REST, Microsoft Graph + login, SMTP…). This is what Alga talks to, redirected via env overrides (the existing pattern: `MICROSOFT_LOGIN_BASE_URL` / `MICROSOFT_GRAPH_BASE_URL`, centralized in `shared/services/email/microsoftGraphEndpoints.ts`). Necessarily bespoke per emulator.
- **Control surface** — a uniform API (the generalization of the Graph emulator's `/__control/*` routes) for reset, seed, snapshot, inspect, fault injection, and emulator-specific actions.

The CLI, the web console, and E2E test helpers are all thin clients of the control surface. Building an emulator never involves building CLI or UI support; registering its controls is enough.

## Architecture

### Core + shells

Each emulator is written as three layers. The QBO simulator (`packages/billing/src/services/accountingSync/testing/qboSimulator.ts`) already demonstrates the innermost one.

- **Core** — a pure in-process TypeScript state machine owning all domain semantics (SyncTokens, credits, subscriptions, token lifecycles). No I/O, no HTTP. Time comes from an injected clock (`core.now()` — the QBO sim already has this seam), randomness from a seeded RNG. Unit tests import the core directly and inject it at the service seam via Vitest, exactly as `qboSimulator.test.ts` does today; that path stays fast and container-free.
- **Wire shell** — an HTTP adapter mapping the vendor's real routes, auth handshakes, and error shapes onto core calls.
- **Control shell** — registrations that map the uniform control API onto core calls (see the registry below).

The Graph emulator (`test-harness/graph-emulator/server.mjs`) currently fuses all three into one file; it gets refactored into this shape. The QBO simulator keeps its core untouched and gains wire + control shells.

### Host topology: one pluggable process

A single **emulator host** (LocalStack model) loads emulator packages through a registry interface, routes vendor traffic to each (distinct port per emulator by default, so base-URL env overrides stay simple), and serves one control API plus one web console on a dedicated control port.

- `algasim serve` — everything enabled: one command, one process, all emulators, one console.
- `algasim serve --only qbo,msgraph` — minimal footprint for a focused E2E job.
- One container image for CI (built from the host package), one Compose service instead of N.

Because emulators are plain packages implementing the host interface, running one standalone is the `--only` degenerate case; there is no separate standalone code path to maintain.

### The registry: self-describing controls

Emulator packages implement one entry point:

```ts
export interface EmulatorPackage {
  id: string;                    // 'qbo', 'msgraph', 'smtp-sink', …
  displayName: string;
  createCore(env: HostEnv): EmulatorCore;        // HostEnv: clock, rng, logger
  wire(router: WireRouter, core: EmulatorCore): void;   // vendor routes
  register(reg: ControlRegistry, core: EmulatorCore): void;  // controls
}
```

`register` declares every runtime control as data:

```ts
reg.action({
  name: 'expire-oauth-token',
  description: 'Invalidate the current access token so the next call 401s',
  params: z.object({ realmId: z.string().optional() }),
  run: (params) => core.expireToken(params),
});
reg.fault({ name: 'stale-sync-token', description: '…', params: …, arm/disarm … });
reg.stateView({ name: 'invoices', list: () => core.entities('Invoice') });
reg.seeder({ name: 'customer', params: …, run: … });
```

Everything downstream is generated from these declarations:

- **Control API:** `POST /control/:emulator/actions/:name`, `GET /control/:emulator/state/:view`, plus host-level `POST /control/:emulator/reset`, snapshot save/restore, and `GET /control/catalog` (the full machine-readable catalog of emulators, actions, faults, views, and their param schemas).
- **CLI:** `algasim qbo expire-oauth-token --realm-id=…` with `--help` and `--json` rendered from the catalog.
- **UI:** one form per action/fault generated from the param schema; one table per state view. No per-emulator frontend code, ever.
- **Tests:** a typed client helper wraps the same endpoints for E2E suites.

Adding a failure mode next year is one `reg.fault(...)` call inside the emulator package. Zero framework, CLI, or UI changes. This is the extensibility answer to requirement 6.

### Fault taxonomy: three tiers, most faults free

- **Transport faults** — latency, connection reset, 429 + Retry-After, 5xx, flapping. Implemented once as host middleware in front of every vendor surface (Toxiproxy's model), armed per-emulator or per-route via the same control API. New emulators get all of these on day one with no code. This tier absorbs most of what `test-config/wiremock-oauth/mappings/oauth-errors.json` does today.
- **Protocol faults** — expired/revoked tokens, malformed payloads. Shared helpers, since OAuth misbehavior looks alike across vendors.
- **Domain faults** — stale SyncToken, Graph subscription expiry, duplicate-name rejection. Per-emulator `reg.fault` registrations.

### Scenarios and virtual time (first-class primitives)

- **Scenario files** — declarative YAML seeding entities, setting config, and arming faults by registry name. `algasim scenario run delinquent-customer.yaml` behaves identically in CI setup, a developer terminal, and as a one-click button in the console. Scenarios live next to the emulator packages and are the unit of "smoke test setup".
- **Virtual clock** — a host-level clock all cores read. `algasim clock advance 32d` drives token expiry, billing periods, and subscription renewals deterministically; combined with seeded RNG it makes E2E failures reproducible. For a PSA, time-driven behavior is the interesting behavior; it must not depend on wall time.

### Web console

A small self-contained React app served by the host on the control port (dev-tool chrome; not part of the product UI and not bound by product theming). Screens: emulator list with health/enabled state, per-emulator dashboard (state views, request/event log, action and fault forms generated from the catalog, seed/scenario buttons), host-level clock and snapshot controls. Built last — the CLI proves the control API first, and the console is a generic renderer over `GET /control/catalog`.

## Repo layout

```
packages/emulators/
  host/        # framework: host server, control plane, transport-fault middleware,
               # registry types, virtual clock, scenario runner, CLI (`algasim`), console UI
  qbo/         # wire + control shells over the existing QBO core
  msgraph/     # ported Graph emulator
  smtp-sink/   # SMTP capture (Mailpit-alike; eventual MailHog replacement)
  webhook-sink/# generic webhook receiver/recorder (replaces webhook-mock mappings)
```

One `workspaces` addition in the root `package.json`: `packages/emulators/*`. Emulator packages are owned by the feature teams that own the integration (billing owns `qbo`), the same ownership story as today's feature-local simulator; the host is shared infrastructure.

The QBO **core** stays in `packages/billing` (it is billing's domain model and its unit tests inject it directly); `packages/emulators/qbo` depends on billing for the core and adds the shells. If that dependency direction proves awkward in practice, the core moves to the emulator package and billing imports it back — decide when wiring it up, not now.

## Migration path (ordered by leverage)

1. **Host + registry + CLI, with Graph as the first ported emulator.** Its `/__control` endpoints (reset, seed clients/messages, expire/revoke tokens, faults, config, subscriptions view) map one-to-one onto registry concepts, and it already has the richest behavior (OAuth, webhook validation/delivery). `test-harness/graph-emulator/` is retired when parity is proven by its existing smoke test.
2. **QBO wire + control shells** over the untouched core. Existing Vitest suites don't change.
3. **Webhook sink + SMTP sink.** Retire `test-config/wiremock/mappings/` and MailHog from the E2E Compose stacks. Fold any remaining WireMock OAuth mappings into the transport/protocol fault tiers and retire `test-config/wiremock-oauth/` too; if a genuinely dumb canned response is ever needed, a trivial `static-fixtures` emulator package covers it.
4. **Console UI.**

Later emulators (Gmail, RMM vendors, Stripe, OpenAI-compatible gateway — subsuming `tools/smoke-sim/openai-sim.mjs`) follow as integration work demands; each is one package implementing `EmulatorPackage`.

## Out of scope (explicit decisions)

| Item | Reason |
| --- | --- |
| Operator/customer-facing packaging | Internal-only per Robert; no published image contract, no appliance workload. |
| Record/replay proxy mode | Useful someday for bootstrapping wire fidelity against real vendors; not needed for the first four emulators. |
| Per-emulator standalone servers | The `--only` flag covers isolation; a second serving path would just bit-rot. |
| Product workflow simulator (`shared/workflow/runtime/simulation/`) | Different concept — production feature, not a vendor emulator. Untouched. |
| Contract testing against real vendor APIs | Valuable, orthogonal. Emulator fidelity is maintained by hand + the vendors' documented behavior, as the QBO sim does today. |

## Testing

- Host framework: unit tests for registry, control API, transport-fault middleware, clock, scenario runner.
- Each emulator: semantic tests against the core (the `qboSimulator.test.ts` pattern) plus a wire-shell smoke test hitting real HTTP (the `graph-emulator/smoke.test.mjs` pattern, generalized into a host test helper).
- Parity gates for ports: Graph emulator's existing smoke test must pass against the ported package before the old one is deleted; E2E suites currently pointing at `webhook-mock`/MailHog switch over one suite at a time.

## Open items

- Working name is `algasim` (CLI binary and host image name); rename freely before first merge.
- Port allocation convention for vendor surfaces (fixed defaults per emulator vs. host-assigned with `GET /control/catalog` discovery) — decide during host implementation; fixed defaults are simpler for Compose env wiring.
- Whether scenario YAML supports composition (include/extend) — start flat, add only when a real scenario needs it.
