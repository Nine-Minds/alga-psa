# Scratchpad — Appliance Operator TUI

- Plan slug: `appliance-operator-tui`
- Created: `2026-03-25`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-25) First version is terminal-first, not a browser-based operator console. Reason: it matches the current appliance operator workflow, works over SSH, and avoids building a second management surface before the appliance lifecycle is stable.
- (2026-03-25) The new tool should live under `ee/appliance`, not inside the existing Nushell developer CLI. Reason: the current CLI is developer-oriented and appliance operations need a clearer product boundary.
- (2026-03-25) The tool should be structured for both repo-based use and future standalone packaging. Reason: v1 can ship from the repo, but packaging constraints should not be baked into the lifecycle logic.
- (2026-03-25) The TUI should wrap the current appliance shell scripts and release manifests instead of replacing bootstrap, upgrade, or reset logic.
- (2026-03-25) Implemented operator as Node ESM modules under `ee/appliance/operator` with a thin shell wrapper `ee/appliance/appliance`. Reason: no existing appliance package/workspace existed and ESM keeps packaging and standalone embedding simple.
- (2026-03-25) Added runtime path abstraction with repo auto-discovery and `ALGA_APPLIANCE_ASSET_ROOT` override. Reason: required for future standalone packaging while preserving repo-hosted workflow.
- (2026-03-25) Implemented one normalized status model (`collectStatus`) used by both TUI and non-interactive commands. Reason: avoids divergent status logic and supports consistent blocker guidance across command surfaces.
- (2026-03-25) Kept lifecycle actions script-driven (`bootstrap-appliance.sh`, `upgrade-appliance.sh`, `reset-appliance-data.sh`, `collect-support-bundle.sh`) with phase-aware progress wrappers. Reason: minimizes operational drift and honors existing script contracts.
- (2026-03-25) The current `readline` shell is not the accepted final UX. Reason: it is operationally useful, but it does not meet the product bar for a real operator TUI.
- (2026-03-25) Ink is the intended runtime for the interactive layer. Reason: it supports the full-screen, persistent-layout, keyboard-driven interface we actually want while allowing the existing Node operator core to remain intact.
- (2026-03-25) Replaced the interactive `readline/promises` loop with a stateful Ink app while keeping lifecycle/status modules untouched. Reason: satisfies the UX acceptance bar (`F026`-`F031`) without destabilizing non-interactive commands.
- (2026-03-25) Added Vim-style `j/k/h/l` bindings alongside arrows in the Ink shell. Reason: improves SSH/operator ergonomics and made headless TUI tests deterministic.
- (2026-03-25) Appliance pod inspection belongs inside the same Ink operator rather than a separate CLI/tool. Reason: operators should stay in one surface for lifecycle, status, and debugging.
- (2026-03-25) Workload scope should default to appliance-relevant namespaces only (`msp`, `alga-system`, `flux-system`). Reason: operators asked for appliance-focused visibility, not a generic cluster browser.
- (2026-03-25) Pod logs should use a full-screen viewer with bounded scrollback and Escape-to-return behavior. Reason: this matches operator expectations better than a cramped split view and avoids unbounded memory growth.
- (2026-03-25) Implemented `F032` by adding `Workloads` as a first-class Ink action and dedicated main-pane route. Reason: keeps pod inspection in the same operator surface as lifecycle and status actions.
- (2026-03-25) Implemented `F033` with a default namespace allowlist (`msp`, `alga-system`, `flux-system`) inside the workload adapter. Reason: appliance operators need focused inventory, not cluster-wide noise.
- (2026-03-25) Implemented `F034` with a refreshable pod table showing pod, namespace, status, ready, restarts, and age. Reason: aligns the workload pane with PRD operator-at-a-glance requirements.
- (2026-03-25) Implemented `F035` using timed workload polling with selection preservation by stable pod key. Reason: refreshing state must not disrupt active operator focus.
- (2026-03-25) Implemented `F036` by adding a full-screen log view opened from the workload list and closed with `Esc` back to workloads. Reason: this mirrors required drill-down behavior without layout loss.
- (2026-03-25) Implemented `F037` by using chunked tail expansion plus fixed-cap line windows. Reason: `kubectl logs` is append-oriented, so chunked reload with a cap is the practical bounded-memory strategy.
- (2026-03-25) Implemented `F038` with follow-mode tied to bottom position and automatic pause when scrolling upward. Reason: operators need live tail only when intentionally at stream bottom.
- (2026-03-25) Implemented `F039` with keyboard controls for workloads/logs (`j/k`, arrows, `Enter`, `Esc`, page scroll). Reason: parity with SSH-friendly keyboard workflows.
- (2026-03-25) Implemented `F040` via new `lib/workloads.mjs` adapter that encapsulates `kubectl get pods` and `kubectl logs` calls behind normalized APIs. Reason: keeps raw command details out of TUI view logic.

## Discoveries / Constraints

- (2026-03-25) The repo already has operator-facing appliance scripts: `bootstrap-appliance.sh`, `upgrade-appliance.sh`, `reset-appliance-data.sh`, and `collect-support-bundle.sh`.
- (2026-03-25) The current bootstrap and upgrade flows are already release-manifest driven under `ee/appliance/releases/<version>/release.json`.
- (2026-03-25) The operator problem is not missing capability; it is poor usability and path/command discoverability.
- (2026-03-25) The existing shell scripts already own sensitive logic like Talos config generation, Flux install, release value rendering, and destructive reset semantics. Reimplementing them in v1 would create drift risk.
- (2026-03-25) The existing developer CLI is Nushell-based and heavily focused on dev/build/test workflows, which makes it a poor default home for a customer-facing appliance operator surface.
- (2026-03-25) `ee/appliance` had no existing app package or command framework, so the operator needed to bootstrap its own CLI/TUI modules and tests from scratch.
- (2026-03-25) Bootstrap stderr/stdout can contain multiple layers in one run; classifier precedence must favor explicit Kubernetes timeout strings when Talos logs are also present.
- (2026-03-25) The current operator core and non-interactive commands are still the right foundation; the main change is swapping the interactive shell, not rewriting lifecycle or status logic.
- (2026-03-25) `ink@5.x` was incompatible with this repo's React 19 runtime (`ReactCurrentOwner` crash during module load). `ink@6.8.0` resolves the compatibility issue.
- (2026-03-25) The new UI keeps a persistent layout with dedicated header, action navigator, status dashboard panel, main content pane, progress panel, and contextual help strip.
- (2026-03-25) `kubectl logs` is not a true random-access log API, so "scrollback pagination" must be approximated by chunked reloads and bounded windows rather than arbitrary seek.
- (2026-03-25) Auto-refreshing workload state must preserve selection and avoid clobbering active log-view state during operator inspection.
- (2026-03-25) Ink page-up/page-down availability depends on terminal input; tests are more deterministic using `j/k` and `Enter` paths.
- (2026-03-25) `kubectl logs --since-time` can be used for live append polling once the latest seen timestamp is tracked in viewer state.

## Commands / Runbooks

- (2026-03-25) Plan scaffold command:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Appliance Operator TUI"`
- (2026-03-25) Existing appliance script entrypoints:
  - `ee/appliance/scripts/bootstrap-appliance.sh`
  - `ee/appliance/scripts/upgrade-appliance.sh`
  - `ee/appliance/scripts/reset-appliance-data.sh`
  - `ee/appliance/scripts/collect-support-bundle.sh`
- (2026-03-25) New operator entrypoints:
  - `ee/appliance/appliance --help`
  - `ee/appliance/appliance tui`
  - `ee/appliance/appliance status`
- (2026-03-25) New test runbook:
  - `node --test ee/appliance/operator/tests/*.test.mjs`
- (2026-03-25) Future workload/log implementation will likely need dedicated adapter tests separate from the existing lifecycle/status tests.
- (2026-03-25) Workload/log implementation test run:
  - `node --test ee/appliance/operator/tests/*.test.mjs`
- (2026-03-25) Ink dependency updates:
  - `npm install ink@^6.8.0`
  - `npm install --save-dev ink-testing-library@^4.0.0`

## Links / References

- `ee/appliance/README.md`
- `ee/appliance/scripts/bootstrap-appliance.sh`
- `ee/appliance/scripts/upgrade-appliance.sh`
- `ee/appliance/appliance`
- `ee/appliance/operator/appliance.mjs`
- `ee/appliance/operator/lib/cli.mjs`
- `ee/appliance/operator/lib/tui.mjs`
- `ee/appliance/operator/lib/status.mjs`
- `ee/appliance/operator/lib/lifecycle.mjs`
- `ee/appliance/operator/tests/lifecycle-cli.test.mjs`
- `ee/appliance/operator/tests/status.test.mjs`
- `ee/appliance/operator/tests/runtime-paths.test.mjs`
- `ee/appliance/operator/tests/tui-ink.test.mjs`
- `ee/appliance/operator/lib/workloads.mjs`
- `ee/appliance/operator/tests/workloads.test.mjs`
- `ee/docs/premise/README.md`
- `ee/docs/premise/talos-gitops-bootstrap.md`
- `docs/plans/2026-03-10-talos-appliance-gitops-alga-deployment-design.md`
- `docs/plans/2026-03-10-talos-image-factory-scaffolding-design.md`

## Open Questions

- (Resolved 2026-03-25) TUI runtime/library: use Ink for the real interactive shell. The existing `readline/promises` shell is interim scaffolding, not the accepted end state.
- (Resolved 2026-03-25) v1 status scope: summary-first (Talos/Kubernetes/Flux/Helm/workloads + release/config paths) without embedded log/event drill-down.
- (Resolved 2026-03-25) Ship TUI and mirrored non-interactive command surface together in v1.
- (Resolved 2026-03-25) Expanded v1 operator scope now includes appliance-relevant workload inventory and full-screen pod log viewing inside the Ink UI.
- (Resolved 2026-03-25) `T010` completed: workload console now validates appliance-only pod inventory, required columns, and selection preservation across refresh.
- (Resolved 2026-03-25) `T011` completed: selecting a pod opens full-screen logs and `Esc` restores workload layout/selection.
- (Resolved 2026-03-25) `T012` completed: log viewer validates chunked older-load behavior, follow/pause transitions, and bounded in-memory line caps.
