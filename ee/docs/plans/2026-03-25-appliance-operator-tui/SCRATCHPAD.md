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

## Discoveries / Constraints

- (2026-03-25) The repo already has operator-facing appliance scripts: `bootstrap-appliance.sh`, `upgrade-appliance.sh`, `reset-appliance-data.sh`, and `collect-support-bundle.sh`.
- (2026-03-25) The current bootstrap and upgrade flows are already release-manifest driven under `ee/appliance/releases/<version>/release.json`.
- (2026-03-25) The operator problem is not missing capability; it is poor usability and path/command discoverability.
- (2026-03-25) The existing shell scripts already own sensitive logic like Talos config generation, Flux install, release value rendering, and destructive reset semantics. Reimplementing them in v1 would create drift risk.
- (2026-03-25) The existing developer CLI is Nushell-based and heavily focused on dev/build/test workflows, which makes it a poor default home for a customer-facing appliance operator surface.
- (2026-03-25) `ee/appliance` had no existing app package or command framework, so the operator needed to bootstrap its own CLI/TUI modules and tests from scratch.
- (2026-03-25) Bootstrap stderr/stdout can contain multiple layers in one run; classifier precedence must favor explicit Kubernetes timeout strings when Talos logs are also present.

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
- `ee/docs/premise/README.md`
- `ee/docs/premise/talos-gitops-bootstrap.md`
- `docs/plans/2026-03-10-talos-appliance-gitops-alga-deployment-design.md`
- `docs/plans/2026-03-10-talos-image-factory-scaffolding-design.md`

## Open Questions

- (Resolved 2026-03-25) TUI runtime/library: use built-in Node `readline/promises` for v1 to avoid extra dependency/packaging drag; can be swapped later for richer full-screen TUI.
- (Resolved 2026-03-25) v1 status scope: summary-first (Talos/Kubernetes/Flux/Helm/workloads + release/config paths) without embedded log/event drill-down.
- (Resolved 2026-03-25) Ship TUI and mirrored non-interactive command surface together in v1.
