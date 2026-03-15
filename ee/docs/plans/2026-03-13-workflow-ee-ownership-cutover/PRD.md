# PRD — Workflow EE Ownership Cutover

- Slug: `workflow-ee-ownership-cutover`
- Date: `2026-03-13`
- Status: Draft

## Summary

Move workflow implementation ownership out of the global `shared/workflow/*` tree and into the EE workflows package at `@alga-psa/workflows/*`. This is a hard-cut refactor, not a shimmed migration: application code, worker code, EE server code, tests, and dependent packages should stop importing `@shared/workflow*` and `@alga-psa/shared/workflow*` and instead consume the EE package surface.

The cutover includes runtime, workers, persistence models, bundle helpers, streams and domain-event builders, workflow-specific secrets and services, expression-authoring helpers, types, and the new AI workflow step support. The goal is to align code ownership with product ownership so workflow is clearly EE-only and no longer leaks across the shared/core boundary.

## Problem

Workflow is an EE feature, but the codebase still treats workflow as globally shared infrastructure. That has created two classes of problems:

1. Ownership confusion
- Engineers cannot tell whether workflow code is meant to be CE-safe or EE-only.
- Shared modules now contain EE-specific behavior, such as AI workflow registration.
- Product boundaries and package boundaries disagree, which makes architectural review and future refactors harder.

2. Concrete technical regressions
- EE-only dependencies can leak into shared runtime code.
- Workers, server actions, UI, and unrelated packages all import workflow from mixed namespaces.
- Workflow event-builder helpers and persistence surfaces are treated as globally shared, even though they are part of the workflow feature area.

The AI step work surfaced the problem sharply: shared workflow runtime code started importing EE AI services directly. That is a symptom of the larger issue, not an isolated mistake.

## Goals

- Make `@alga-psa/workflows/*` the canonical import surface for workflow-owned code.
- Remove workflow implementation ownership from `shared/workflow/*`.
- Eliminate non-doc imports of `@shared/workflow*` and `@alga-psa/shared/workflow*` from application code and tests.
- Keep workflow behavior unchanged while moving ownership.
- Move AI-specific workflow behavior fully under the EE workflows package so shared/core no longer knows about it.
- Update dependent packages that use workflow-owned domain-event helpers to import them from the EE workflows package.
- Keep the worker, workflow runtime, designer, bundle import/export, task inbox, and workflow streams functioning after the cutover.

## Non-goals

- Redesigning Workflow V2 behavior, schemas, node semantics, or persistence contracts.
- Introducing compatibility shims or a phased dual-namespace migration.
- Splitting workflow stream and event-builder helpers into a separate non-workflow package in this change.
- Redesigning workflow event publishing or domain event shapes.
- Changing workflow permissions, rollout strategy, feature flags, or observability platforms.
- Refactoring unrelated package boundaries outside the imports required for this workflow ownership cutover.

## Users and Primary Flows

1. Workflow runtime owner updates imports
- Engineer works on runtime, worker, or workflow server code.
- Engineer imports workflow APIs from `@alga-psa/workflows/*`.
- Engineer no longer needs to reason about whether a workflow change is allowed under shared/core.

2. Dependent package emits workflow-owned domain events
- A package such as billing, scheduling, clients, documents, or notifications imports a workflow-owned event builder.
- The package imports the helper from `@alga-psa/workflows/streams/...`.
- Event payload behavior remains unchanged.

3. Workflow worker and server continue to operate
- Worker boots through the EE workflows runtime entrypoints.
- EE workflow server actions validate, publish, and execute definitions using the EE package surface.
- Bundle import/export and task inbox behavior continue to work without behavioral changes.

4. AI workflow step remains intact after the ownership move
- Workflow designer and runtime continue to expose AI-specific behavior through the EE workflows package.
- Shared/core surfaces no longer reference AI-specific workflow logic.

## UX / UI Notes

- There is no intended end-user UX change from this refactor.
- Workflow designer behavior, grouped palette behavior, AI step authoring, expression authoring, schema preview, and downstream reference browsing should all remain behaviorally unchanged.
- Any UI changes are limited to import-path and module-ownership rewiring behind existing interfaces.

## Requirements

### Functional Requirements

- `@alga-psa/workflows/*` must become the canonical module path for workflow-owned code.
- The EE workflows package must expose the workflow surfaces currently used by callers, including:
  - runtime APIs
  - client/types surfaces
  - workers
  - persistence models and interfaces
  - bundle helpers and types
  - streams and domain-event builders
  - expression-authoring helpers
  - workflow-specific secrets and services
- Workflow runtime bootstrap must execute through the EE workflows package.
- Workflow worker entrypoints must import workflow runtime and workers from the EE workflows package.
- EE workflow server actions must import workflow runtime, validation, persistence, bundle, and catalog helpers from the EE workflows package.
- Workflow designer and related EE UI code must import workflow client, catalog, expression, and AI helpers from the EE workflows package.
- AI workflow step support must live entirely under the EE workflows package, including:
  - AI schema helpers
  - AI action registration
  - AI-aware output-schema resolution
  - AI-aware publish validation
- Shared/core workflow runtime files must no longer import EE-only AI services.
- Non-workflow packages that depend on workflow-owned stream or domain-event helpers must import them from the EE workflows package after the cutover.
- Server code outside the EE package that still invokes workflow-owned runtime or persistence helpers must import them from the EE workflows package.
- Package manifests, TypeScript path aliases, and build/export configuration must support the new canonical workflow namespace.
- The hard cut must remove non-doc imports of `@shared/workflow*` and `@alga-psa/shared/workflow*` from repo code and tests.

### Behavioral Compatibility Requirements

- Workflow runtime execution semantics must not change.
- Workflow bundle import/export behavior must not change.
- Workflow worker startup, event ingestion, and run processing behavior must not change.
- Workflow designer behavior and data-contract expectations must not change.
- Workflow task inbox and persistence behavior must not change.
- Workflow event-builder helper signatures and payload output must not change.
- AI workflow step behavior must not change beyond moving ownership into the EE package.

## Data / API / Integrations

- Canonical package surface:
  - `@alga-psa/workflows`
  - `@alga-psa/workflows/runtime/*`
  - `@alga-psa/workflows/workers/*`
  - `@alga-psa/workflows/persistence/*`
  - `@alga-psa/workflows/bundle/*`
  - `@alga-psa/workflows/streams/*`
  - `@alga-psa/workflows/expression-authoring/*`
  - `@alga-psa/workflows/secrets/*`
  - `@alga-psa/workflows/services/*`
  - `@alga-psa/workflows/types/*`
- Build/export updates must happen in the EE workflows package so these deep imports resolve for server, worker, and package callers.
- TypeScript path alias updates must cover the root tsconfig plus server, EE server, and workflow worker tsconfigs.
- Workflow-owned code currently under `shared/workflow/*` becomes EE package code.

## Security / Permissions

- No permission model changes are intended.
- Existing workflow read/write/publish/execute permissions remain unchanged.
- This refactor changes ownership and packaging only; it should not broaden access to workflow capabilities.

## Rollout / Migration

- This is a single hard-cut migration within the branch.
- No compatibility shims should be left behind for old workflow import paths in application code.
- The package/build changes must land in the same change as the import rewrites so the repo builds consistently.
- Docs can be updated opportunistically, but code and test surfaces must be fully cut over in the same implementation effort.

## Risks

- The import graph is wide: runtime, worker, EE server, regular server code, tests, and many packages use workflow-owned helpers.
- The EE workflows package currently exports only a narrow surface, so export-map and build config changes are required before the import rewrite will compile.
- Some current consumers of workflow-owned streams and domain-event helpers are not obviously “workflow features,” so the cutover will introduce explicit dependencies on the EE workflows package there.
- Wiring tests that assert import strings will fail until updated.
- The worker and server bootstrap paths are sensitive to runtime initialization order; the ownership move must preserve initialization behavior exactly.

## Open Questions

- None for this cutover. The plan assumes workflow and workflow-owned helper surfaces are EE-only and should move together.

## Acceptance Criteria (Definition of Done)

- All workflow-owned code is canonically consumed through `@alga-psa/workflows/*`.
- No non-doc imports remain from `@shared/workflow*` or `@alga-psa/shared/workflow*`.
- The EE workflows package exports the workflow surfaces currently needed by runtime, worker, server, UI, and dependent packages.
- Workflow worker, workflow runtime, workflow designer, bundle import/export, task inbox, and workflow stream/event publishing behavior continue to work.
- AI workflow step behavior remains intact and is owned entirely by the EE workflows package.
- The codebase no longer places workflow implementation ownership under the global shared namespace.
