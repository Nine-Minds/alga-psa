# Asset Management UI Remediation Plan
## Phased Structural Overhaul

**Document Version**: 0.2  
**Last Updated**: 2025-01-11

---

## Scope & Assumptions

We are skipping formal user discovery (Phase 0) because enterprise usage is not yet live. Instead, this plan leverages internal expertise, MSP market expectations, and competitive benchmarks to prescribe the UI remediation work. Tasks reference existing components (see `docs/overview.md`) so we extend rather than re-create platform primitives.

---

## Phase 1: Navigation & Utility Framework

Establish predictable wayfinding and shared shell utilities before expanding data surfaces.

**Key Outcomes**
- Hierarchical navigation that keeps asset tooling visible without overwhelming other PSA modules.
- Global utility header exposing tenant context, quick actions, notifications, and background job entry point.
- Accessibility-first structure consistent with `docs/AI_coding_standards.md`.

**To-Do**
- [x] Audit existing nav components under `server/src/components/layout` (or equivalent) and document reusable patterns.
- [x] Design grouped navigation for MSP modules with an asset-specific action rail (imports, automations, policies).
- [x] Implement nav updates using existing UI primitives (`Button`, `DropdownMenu`, `NavLink` variants) ensuring unique `id` attributes on interactive elements.
- [x] Build global utility header shell (tenant selector, quick create, notification badge, job status container) leveraging existing `TopBar` infrastructure if present.
- [x] Wire feature flag + telemetry events (ex: `ui.nav.v2.enabled`) to measure adoption and fallbacks.
- [ ] Run keyboard-only and screen reader smoke tests; record findings and remediation tasks.

**Exit Criteria**
- New navigation and header available behind feature flag; baseline telemetry captured.
- Accessibility checks (focus order, ARIA landmarks) logged with sign-off from design/QA.

---

## Phase 2: Workspace Grid & Data Density

Replace dashboard-first layout with operational data workspace that scales to large fleets.

**Key Outcomes**
- Assets landing page defaults to a configurable grid built on the shared `DataTable`.
- Operators can sort, filter, paginate, multi-select, and perform quick actions without leaving context.
- Visual density aligns with enterprise expectations while staying compliant with component standards.

**To-Do**
- [ ] Inventory existing asset tables (`AssetDashboard`, `ClientAssets`) to identify columns/actions that can move into the grid.
- [ ] Extend `server/src/components/ui/DataTable` to support column chooser, saved column widths, and server-driven filters if capabilities are missing.
- [ ] Implement new grid view with:
  - [ ] Column presets for core attributes (status, client, maintenance countdown, policies).
  - [ ] Inline action menus using `DropdownMenu` with per-item IDs (see AI coding standards).
  - [ ] Row selection model that integrates with bulk executor placeholder.
- [ ] Build filtering panel (drawer or popover) for common facets: status, client, asset type, lifecycle stage.
- [ ] Ensure loading, empty, and error states reuse shared components (`LoadingIndicator`, `EmptyState` if available).
- [ ] Performance test sorting/filtering against datasets ≥10K assets; record API latency and UI response stats.

**Exit Criteria**
- Grid ready for internal use with opt-in toggle; telemetry shows ≥80% of asset sessions use the grid.
- Server calls for sort/filter return in <500ms for 10K asset dataset during benchmarks.

---

## Phase 3: Detail Drawer & Context Panels

Deliver in-context asset insights without forcing page transitions.

**Key Outcomes**
- Right-rail drawer (or split-pane) that presents lifecycle, related tickets, maintenance schedule, configuration, and documents.
- Consistent tabbed layout using `CustomTabs` for extensibility (integrations, policies, automation hooks).
- URL state that deep-links into specific tabs/panels for collaboration.

**To-Do**
- [ ] Review existing drawer implementation (`server/src/components/ui/Drawer`) and reuse styles/behaviour.
- [ ] Map data requirements: lifecycle events (from audit logs), maintenance schedules (`getClientMaintenanceSummary`), related tickets/projects/documents.
- [ ] Define tab structure (Overview, Maintenance, Tickets, Configuration, Documents) with future placeholders for integrations.
- [ ] Implement drawer invocation from grid row click (without breaking keyboard navigation); ensure `preventDefault` handling for inline action menus.
- [ ] Sync URL state with drawer (e.g., `/msp/assets?assetId=123&panel=maintenance`) using Next.js router.
- [ ] Add contextual quick actions (assign policy, create ticket) with optimistic UI and rollback hooks.
- [ ] Record observability events (drawer open, tab viewed) for telemetry.

**Exit Criteria**
- Drawer replaces standalone asset detail page for pilot cohort with positive QA feedback.
- URL deep links load correct asset + tab; manual QA validates shareable links.

---

## Phase 4: Operational Command Layer

Surface power tools for search, saved views, and bulk execution to match enterprise workflows.

**Key Outcomes**
- Command/search bar accessible via keyboard (e.g., `⌘/Ctrl + K`) with typeahead across assets, clients, tickets.
- Saved views infrastructure with sharing and KPI overlays.
- Bulk executor orchestrating mass updates with progress surfaced in the job center.
- Job history modal exposing results and linking to audit logs/affected assets.

**To-Do**
- [ ] Prototype command palette using existing `Dialog` or `Command` components; ensure alignment with reflection ID guidelines.
- [ ] Implement API endpoint for cross-entity search leveraging existing `listAssets`, `listClients`, `listTickets`.
- [ ] Persist saved views in backend (new table or reuse preference store) including columns, filters, sort order, KPI thresholds.
- [ ] Build shared context for current selection/bulk operations; integrate with grid selection model.
- [ ] Create bulk executor queue UI with progress bars, error reporting, rollback triggers; reuse job infrastructure under `server/src/components/jobs` where possible.
- [ ] Implement job history modal accessible from header; link entries to audit events and detail drawer.
- [ ] Instrument performance metrics (search latency <200ms, executor throughput) and set SLO dashboards.

**Exit Criteria**
- Command bar live for internal power users with latency under 200ms median.
- Saved views available to pilot tenants; telemetry shows repeat usage.
- Bulk executor flows audited end-to-end including rollback and notification hooks.

---

## Phase 5: Rollout & Continuous Improvement

Transition from pilot to full release while institutionalising feedback and quality loops.

**Key Outcomes**
- Controlled tenant rollout with feature flags, documentation, and support readiness.
- KPI monitoring that validates usability gains (reduced navigation clicks, faster triage).
- Feedback backlog prioritised with joint design/engineering cadence.

**To-Do**
- [ ] Define rollout schedule (internal → design partners → general availability) with flag strategy per tenant.
- [ ] Update product docs and release notes highlighting navigation changes, keyboard shortcuts, and new workflows.
- [ ] Train support/success teams with demo environments and troubleshooting guides.
- [ ] Monitor key metrics (task completion time, ticket volume, command bar usage) using Product Analytics or warehouse.
- [ ] Conduct scheduled feedback sessions with enterprise design partners; capture action items.
- [ ] Create continuous improvement backlog with quarterly grooming rituals.

**Exit Criteria**
- New UI enabled for target enterprise tenants with ≤5% opt-out requests.
- Support tickets referencing navigation/workspace drop by agreed target (e.g., -30%).
- Quarterly improvement backlog curated and prioritised.

---

## Dependencies & Alignment

- Coordinate closely with backend teams delivering import pipeline, audit events, and automation frameworks outlined in the enterprise roadmap.
- Ensure new UI components comply with `docs/AI_coding_standards.md` (Radix-based primitives, unique IDs, shared loading/empty states).
- Reuse existing modules noted in `docs/overview.md` (e.g., job management components, document viewers) to avoid duplicate implementations.
- Collaborate with platform theming team so navigation/header updates propagate consistently across MSP and client portals.

---
