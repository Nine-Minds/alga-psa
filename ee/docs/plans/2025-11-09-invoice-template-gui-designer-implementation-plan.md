# Invoice Template GUI Designer Implementation Plan

This implementation roadmap operationalizes the strategic design described in [2025-11-09-invoice-template-gui-designer-plan](./2025-11-09-invoice-template-gui-designer-plan.md). Each task references the sections in that plan ("Plan §...") for the authoritative design details.

## Phase 0 – Foundations (Weeks 0-2)

### Objectives
- Establish the core schema, state management, and rendering infrastructure needed for later features (Plan §Phased Approach, Phase 0; Plan §Designer Rendering Strategy; Plan §Data Structures & Intermediate Representation).

### Tasks
1. **IR Schema Finalization**
   - Draft JSON Schema + Zod validators covering `Document`, `Page`, `Section`, `Container`, and `Element` nodes (Plan §Data Structures & Intermediate Representation).
   - Implement schema versioning helpers and migration stubs in the compilation service repo (Plan §Data Structures & Intermediate Representation → Serialization).
   - Review with runtime team to confirm compatibility with existing WASM expectations (Plan §Compilation Pipeline).
2. **State Management & Command Stack**
   - Scaffold Zustand stores for layout tree, selection state, and undo/redo command stack following the structure defined in Plan §Designer Rendering Strategy and Plan §Drag-and-Drop Interaction Model.
   - Implement Immer-based mutation helpers that emit audit metadata required by IR nodes (Plan §Data Structures & Intermediate Representation → Node Schema).
3. **Rendering Shell Prototype**
   - Build React canvas wrapper with virtualized page rendering and SVG overlay per Plan §Designer Rendering Strategy.
   - Integrate placeholder rulers, grid visualization, and snapping guide stubs referencing algorithms in Plan §Layout Constraints, Snapping, and Algorithms.
4. **Technical Spikes & Proofs of Concept**
   - Validate Cassowary constraint solving performance with representative templates (Plan §Drag-and-Drop Interaction Model → Constraint Solver).
   - Prototype compilation pipeline handshake by translating a minimal IR into layout operations consumed by existing WASM runtime (Plan §Compilation Pipeline).

### Exit Criteria
- Signed-off IR schema and validators.
- Demoable rendering shell showing mock component placement and guide overlays.
- Documented findings from constraint and compilation spikes, feeding Phase 1 tasks.

## Phase 1 – MVP Designer (Weeks 2-8)

### Objectives
- Deliver a fully interactive designer with persistence, data binding, and compilation hooks (Plan §Phased Approach, Phase 1).

### Tasks
1. **Drag-and-Drop Workspace** — ✅ _Completed Nov 13, 2025 (drag/drop + snapping live; telemetry deferred)_
   **Scope**
   - Deliver end-to-end drag, drop, move, resize, and rotate interactions for all structural/content elements described in Plan §Drag-and-Drop Interaction Model.
   - Provide grid snapping, rulers, smart guides, and constraint authoring UI described in Plan §Layout Constraints, Snapping, and Algorithms.
   - Ensure the command stack + IR mutations remain deterministic so undo/redo and compilation previews stay in sync (Plan §Designer Rendering Strategy → Layout Surface).

   **Work Breakdown**
   1. *Input & Sensor Layer*: ✅ Configured `@dnd-kit` sensors plus keyboard affordances/focus management tied to the shared command stack.
   2. *Drop Zone Graph & Hit Testing*: ✅ Canvas droppable + metadata for allowed node types implemented; advanced quadtree + async validators remain TODO.
   3. *Visual Affordances*: ✅ Canvas overlays, rulers, snapping grid, and palette toggles merged; design QA scheduled for snap strengths.
   4. *Constraint & Command Integration*: ✅ Drops emit atomic history-aware mutations with undo/redo; Cassowary solver + conflict suggestions still outstanding.
   5. *Validation, QA, and Telemetry*: ❌ Telemetry & ops instrumentation are out of scope for this release; basic logging only (defer structured dashboards/Playwright automation to future infra work). Constraint conflict banner + suggested-fix quick actions remain required for GA.

   **Milestones & Staffing**
   - *Week 2-3*: ✅ Delivered Nov 13, 2025 (FE1) with production-ready sensor layer.
   - *Week 3-4*: ✅ Core drop zone metadata + virtualization hooks finished; enhanced quadtree tracking open.
   - *Week 4-5*: ✅ Visual affordances live; awaiting design sign-off on guide density.
   - *Week 5*: ⏳ Constraint solver ✅; telemetry/ops instrumentation removed from scope (see above).

   **Definition of Done**
   - Dragging from library to canvas always lands in a schema-valid location or provides an actionable error suggestion within 200 ms.
   - Guides + snapping keep pointer drift under 4 px relative error in usability tests.
   - Undo/redo restores selection + layout 100% in automated regression run.
   - Observability dashboards expose DnD metrics and no P0 accessibility issues (keyboard-only path recorded in QA notes).
2. **Component Library & Inspector**
   - Build catalog UI backed by component metadata (Plan §Drag-and-Drop Interaction Model → Component Library).
   - Implement property inspector panels for layout, bindings, and styling referencing Plan §Data Binding & Formatting Model and Plan §Styling System.
3. **Auto-Layout Templates & Hierarchy Rules**
   - Implement palette presets that drop multi-node snippets (Header, Totals, Line Item Stack) and register corresponding `layoutPresetId` + constraint bundles in the IR.
   - Enforce parent/child compatibility matrix (Page→Section→Column→Block) at drop time with actionable errors.
   - Capture preset metadata (node tree, constraint bundle, inspector overrides) in a centralized catalog to keep designer, compiler, and runtime aligned.
   - Inspector surfaces preset metadata (`layoutPresetId`, constraints list) plus controls to reapply/clear presets.
4. **Undo/Redo & Grouping**
   - Finalize command stack persistence, multi-select, grouping, and alignment tooling (Plan §Drag-and-Drop Interaction Model → Selection & Editing; Plan §Sections, Grouping, and Page Management).
5. **Persistence & API Integration**
   - Implement GraphQL/REST endpoints for IR CRUD with optimistic concurrency and revision history (Plan §Persistence & Collaboration → Storage & API Layer).
   - Connect frontend save/load flows including autosave intervals and crash recovery.
6. **Compilation Integration**
   - Expose "Compile" action that runs validation, transformation, and code generation stages defined in Plan §Compilation Pipeline.
   - Store compiled artifacts alongside IR versions and surface errors/warnings in UI (Plan §Compilation Pipeline → Testing & QA).
7. **Data Binding Workflow**
   - Implement searchable data dictionary, binding editor UI, and formatting controls (Plan §Data Binding & Formatting Model).
   - Ensure bindings annotate IR nodes with transformation metadata for compiler consumption.
8. **Page & Section Management**
   - Enable creation and configuration of sections, headers/footers, and page break hints (Plan §Sections, Grouping, and Page Management).

- End-to-end flow from drag-and-drop design to compiled WASM artifact for a baseline template.
- Component hierarchy enforcement (Sections/Columns/Blocks) + auto-layout presets available for at least the predefined invoice templates (Header, Line Items, Totals).
- Persistence with revision history and conflict detection (optimistic alerts) so editors avoid silent overwrites.
- Positive feedback from internal pilot on usability of MVP features.

## Phase 2 – Advanced Capabilities (Weeks 8-12)

### Objectives
- Layer on responsive behaviors, advanced pagination, and performance hardening (Plan §Phased Approach, Phase 2).

### Tasks
1. **Responsive & Variant Support**
   - Implement breakpoint-aware artboards and variant overrides per Plan §Data Structures & Intermediate Representation → Variants and Plan §Designer Rendering Strategy → Preview Modes.
2. **Pagination Intelligence**
   - Implement two-pass layout estimator and dynamic programming algorithm for page break planning (Plan §Sections & Page Break Compilation Enhancements → Pagination Algorithm).
   - Surface pagination warnings and manual override controls in the UI.
3. **Performance Hardening**
   - Profile drag interactions and compilation pipeline, applying virtualization and batching optimizations (Plan §Designer Rendering Strategy → Performance Considerations).
   - Establish performance budgets and monitoring hooks.
4. **Theming & Constraint Governance**
   - Enforce tenant-specific token policies and validation rules during editing (Plan §Designer Rendering Strategy → Styling System; Plan §Data Binding & Formatting Model → Validation).
5. **Rollout & Enablement**
   - Prepare documentation, tutorials, and analytics instrumentation to monitor adoption (Plan §Deliverables; Plan §Success Metrics).

### Exit Criteria
- Pagination intelligence prevents orphan/crop issues for pilot datasets.
- Performance metrics stay within agreed budgets on large templates.
- Theming/validation guardrails enforce tenant constraints without designer overrides.

## Quality & Testing Strategy

### Unit Tests
- **IR Validators**: Schema versioning, node property defaults, constraint serialization (Plan §Data Structures & Intermediate Representation).
- **State Utilities**: Command stack reducers, selection/grouping helpers, binding formatters (Plan §Drag-and-Drop Interaction Model; Plan §Data Binding & Formatting Model).
- **Compilation Pipeline**: Individual validation and transformation steps, ensuring deterministic outputs (Plan §Compilation Pipeline → Validation & Transformation Stages).

### Integration Tests
- **Drag-and-Drop Flows**: Simulate placing components, snapping, constraint resolution across nested containers (Plan §Drag-and-Drop Interaction Model; Plan §Layout Constraints, Snapping, and Algorithms).
- **Persistence Roundtrip**: Save/load IR documents, verify revision diffs, and compile outputs remain stable (Plan §Persistence & Collaboration; Plan §Compilation Pipeline).
- **Data Binding & Formatting**: Ensure bindings resolve with mock data sources and formatting adheres to locale rules (Plan §Data Binding & Formatting Model).
- **Pagination & Sections**: Validate keep-with-next, repeating headers, and page break hints using sample data (Plan §Sections, Grouping, and Page Management; Plan §Sections & Page Break Compilation Enhancements).

### End-to-End / Playwright Tests
- **Template Authoring Journey**: From opening designer to publishing compiled artifact, including undo/redo and preview (Plan §Phased Approach Phases 1-2).
- **Collaboration Session**: Two-browser scenario editing the same template, verifying presence indicators and conflict resolution (Plan §Persistence & Collaboration → Collaboration).
- **Localization & Theming**: Switch locales/themes ensuring styling constraints and token enforcement behave correctly (Plan §Designer Rendering Strategy → Styling System; Plan §Data Binding & Formatting Model).
- **Large Template Stress Test**: Load template with many sections to confirm virtualization, performance, and pagination warnings (Plan §Designer Rendering Strategy → Performance Considerations; Plan §Sections & Page Break Compilation Enhancements).

## Deliverables & Dependencies
- Phase-by-phase release notes tying completed tasks back to Plan deliverables (Plan §Deliverables).
- Coordination checkpoints with WASM runtime and backend teams to align on schema and compilation interfaces (Plan §Compilation Pipeline).
- QA sign-off anchored by the testing suite above, enabling confident releases without manual regression sweeps.

## Timeline Overview
- **Weeks 0-2**: Complete Phase 0 foundations.
- **Weeks 2-8**: Ship MVP designer and initiate pilot.
- **Weeks 8-12**: Deliver advanced capabilities and prepare GA rollout.
- **Week 12**: Go/No-Go review referencing Plan §Exit Criteria and Plan §Success Metrics.
