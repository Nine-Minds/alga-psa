# Invoice Template GUI Designer Plan

## Executive Summary
- Introduce a drag-and-drop invoice template designer that produces a structured intermediate representation (IR) before compiling into the existing WebAssembly-driven rendering pipeline.
- Deliver an intuitive editing experience with real-time preview, component library, layout controls, and support for tenant-specific branding rules.
- Build a deterministic compilation process from IR to WASM layout definitions to preserve backwards compatibility with existing invoice rendering.

## Current State Assessment
- Invoice templates are currently authored through code-like configurations executed via WASM, which limits accessibility to developers.
- No visual tooling exists; layout changes require code deployments and deep knowledge of the rendering runtime.
- Template data models vary between legacy JSON schemas and ad-hoc script-defined structures, making reuse and versioning difficult.

## Target State
- Product teams and advanced CS agents can compose invoice layouts visually using reusable content blocks, data bindings, and styling controls.
- Templates persist as versioned IR documents stored per tenant, with audit history and preview snapshots.
- Compilation service reliably translates IR into WASM-compatible layout code, with automated validation for data bindings and styling constraints.

## Phased Approach
1. **Phase 0 – Foundations (2 weeks)**
   - Align on IR schema, component catalog, and compilation contracts.
   - Deliver design prototypes and technical spikes for rendering via React + Canvas/SVG.
   - **Status (Nov 13, 2025):** _Complete._ Core designer shell and Zustand store are live, hierarchical IR fields (`parentId`, `childIds`, `allowedChildren`) implemented, and the remaining work has rolled into Phase 1 compilation tasks.
2. **Phase 1 – MVP Designer (6 weeks)**
   - Implement drag-and-drop surface, component sidebar, property inspector, and undo/redo state manager.
   - Persist IR to backend, enable real-time preview and compile-to-WASM API.
   - **Status (Nov 13, 2025):** _In progress._ Base drag/drop, palette, rulers, grid, undo/redo, and the hierarchical IR with nested drop targets are live; composite presets now land inside sections/columns and drag as a unit. Remaining scope covers persistence, inspector polish, and serialization/export work.
3. **Phase 2 – Advanced Capabilities (4 weeks)**
   - Add responsive breakpoints, enhanced theming constraints, and validation workflows.
   - Harden compilation pipeline with snapshot testing and performance tuning.
   - **Status (Nov 13, 2025):** _Not started._ No longer blocked by hierarchy work; will begin once Phase 1 persistence/binding tasks wrap.

## Designer Rendering Strategy
- **Rendering Stack**: Build the designer as a React 18 application with TypeScript, leveraging a virtual canvas rendered via absolutely positioned HTML elements orchestrated by `react-virtualized` for viewport efficiency. Overlay snapping guides, handles, and spacing indicators using an SVG layer managed by `d3-selection` for low-cost redraws. Mount the designer inside the existing Next.js invoice templates screen via dynamic import.
- **Layout Surface**: Represent each page as a configurable artboard using CSS Grid to host drop zones, while individual components opt into either grid- or flex-based layout modes. Maintain a layout tree in Zustand for deterministic updates.
- **Preview Modes**: Support design-time rendering (with placeholder data) and live preview (actual data via sandboxed fetch). Use React context to switch between mock data providers, and wrap live preview rendering in a Web Worker to isolate slow data fetching.
- **Performance Considerations**: Implement viewport virtualization for large documents, and use memoized component renderers to minimize re-layout. Employ `requestIdleCallback` batching for expensive re-computations (e.g., constraint resolution).
- **Styling System**: Adopt CSS variables and theme tokens matching existing invoice renderer; provide design tokens for fonts, spacing, colors, enabling tenant overrides while enforcing constraints. Enforce typography and color palettes through locked token pickers connected to tenant branding policies.

## Drag-and-Drop Interaction Model
- **Component Library**: Categorize elements (Structure: page, section, column; Content: text, table, totals; Media: logo, QR code; Dynamic: itemized table, tax summary) with metadata about allowed nesting and minimum/maximum multiplicity. Component metadata also describes available bindings and formatting presets.
  | Component | Allowed Parents | Default Auto-Layout & Constraints | Purpose |
  |-----------|----------------|-----------------------------------|---------|
  | **Page**  | Document root   | Locks to 8.5×11in canvas, clamps children to margins, inserts 32px vertical gutters between Sections. | Represents printable canvas; only Sections allowed as direct children. |
  | **Section** | Page           | Creates flex-row container with padding tokens; auto-adds `align-top`, `match-height`, and spacing constraints for child Columns; optional `repeat` behavior (`header`, `body`, `footer`). | Logical grouping (header, line items, totals). |
  | **Column** | Section        | Applies preset width ratios (50/50, 33/67, etc.), enforces min/max widths, keeps siblings balanced via `match-width`. | Provides vertical stacking context for content blocks. |
  | **Content Blocks** (text, tables, totals, line items) | Column | Snaps to column grid. Text blocks span full width; totals blocks auto-dock bottom-right via `align-right` + `align-bottom`; tables reserve min-height and expose row templates. | Primary editable elements. |
  | **Media** (logo, QR, image) | Column, Section (header-only) | Drops with `aspect-ratio` lock + size tokens; logos anchor left, QR codes anchor right; users can override via inspector toggles. | Branding/supporting visuals. |
  | **Composite Templates** | Palette root | Insert pre-wired tree (e.g., "Header with Logo + Address", "2 Column Totals") plus associated constraint bundle + layout preset ID. | Accelerates common invoice structures. |
- **Known Component Gaps (Nov 13, 2025)**:
  - No dedicated field/label components; implementers must model addresses, invoice dates, PO numbers, etc., with generic text blocks. Add `field` + `label` primitives with structured bindings to reduce manual formatting.
  - Line-item `table` lacks column/row configuration UI in the designer; edits still require manual IR/code tweaks. Need schema-driven column editor with sample data preview.
  - Totals area exposes only the aggregate `totals` block; missing granular subtotal/discount/tax widgets or the ability to add custom computed rows.
  - No signature/action widgets (e.g., sign-off block, “Pay Now” button, attachment list), limiting parity with common invoice templates. Track these as future component additions tied to workflow/billing requirements.
- **DnD Engine**: Use `@dnd-kit` sensors for mouse/touch/keyboard. During drag, project the dragged node through a constraint-aware placement algorithm that calculates the nearest valid drop target via quadtree spatial indexing of drop zones. Implement snap-to-grid positioning with configurable 4/8 pt grids, adjustable per section, and expose rulers with tick marks.
- **Constraint Solver**: Apply a linear constraint solver (Cassowary via `kiwi.js`) to maintain relationships such as equal widths, alignment, and anchored positions. Constraints are stored on the IR node and re-solved after each drag or property change.
- **Error Handling & Suggested Fixes**: Unsatisfiable constraint sets roll back the drop and surface (a) blocking constraints, (b) suggested remedies (downgrade strength, wrap in new column, detach from preset), and (c) quick actions to apply them. Solver timings/failures feed telemetry for tuning.
- **Drop Validation**: Validate placements against parent constraints and schema; provide inline feedback (red outlines, tooltips) when invalid. Offer fix suggestions (e.g., auto-wrap into a section) when conflicts arise.
- **Selection & Editing**: Multi-select with shift-click, marquee selection, alignment/distribution commands, and context menu shortcuts. Grouped selections can be converted into named groups, capturing relative positions and shared constraints.
- **Undo/Redo**: Central command stack capturing mutations on IR nodes, persisted in local storage for crash recovery, backed by Immer patches for efficient diffing.

## Phase 1 Section 1 – Drag-and-Drop Workspace

### Goals & Outcomes
- Provide an intuitive canvas where product teams can place, move, and resize components with parity to modern design tools while honoring IR constraints described in Plan §Data Structures & Intermediate Representation.
- Guarantee deterministic layout updates so the compiled WASM output matches the design-time preview (Plan §Compilation Pipeline).
- Surface immediate feedback (guides, snapping, validation toasts) that prevents invalid states, reducing downstream schema or compilation errors by 90%+ in pilot usage.

### Functional Scope
- **Interaction Sensors**: Mouse, touch, and keyboard sensors from `@dnd-kit` with inertia disabled for precision. Keyboard drag uses arrow keys with grid-quantized deltas (1 grid unit default, `Shift` for ×4).
- **Drop Zone Graph**: Maintain a spatial index (quadtree) of all eligible targets, refreshed incrementally as nodes move. The index exposes APIs for hit testing, nearest-neighbor lookup, and constraint metadata, feeding both snapping and validation routines.
- **Placement Pipeline**: Drag events flow through a deterministic pipeline: sensor → constraint pre-check → grid quantization → collision resolution → final IR write. Each stage emits trace events for debugging.
- **Smart Guides & Rulers**: Render vertical/horizontal rulers tied to page units, showing tick labels derived from document DPI. Guides appear when edges/centers are within 4 px (configurable) and display lock icons when constraints (equal width, align center) will be created automatically on drop.
- **Resize & Rotate Handles**: Provide eight resize handles plus optional rotation handle for eligible elements (images, shapes). Resize respects min/max and preserves aspect ratio when `Shift` pressed. Rotation snap every 15°.
- **Constraint Authoring**: Context menu offers “Align Left/Right/Center”, “Distribute”, and “Match Size” commands that create Cassowary constraints with defined strengths (required, strong, weak). Constraint badges are drawn near selected elements for quick inspection.
- **Accessibility**: Tab-navigable layer list, keyboard shortcuts for move/duplicate/delete, and live region announcements describing drop validity states.
- **Telemetry & Limits**: Capture interaction duration, failed drops, and guide usage to tune defaults. Set soft cap of 500 nodes per document for Phase 1 with graceful degradation messaging beyond 300 nodes.

### Architecture & Data Flow
- **State Layers**: Use Zustand slices for `dragState`, `selectionState`, and `layoutTree`. Drag transactions clone affected nodes into a transient buffer to keep frame updates under 8 ms, committing via Immer patches only on drop.
- **Rendering Path**: Draggable shadows render in a lightweight canvas overlay to avoid reflowing the DOM. Droppable hotspots are highlighted via SVG mask referencing quadtree bounds. Hit testing runs off the virtualized layout tree so virtualization does not break DnD.
- **Command Stack Integration**: Every drag mutates IR through a structured `moveNode` command that records before/after layout values plus any constraints created/destroyed, supporting undo/redo and audit logging.
- **Error Handling**: If constraint solver detects an unsatisfiable system, the drop rolls back and surfaces the conflicting constraints; designers can apply suggested fixes (e.g., relax `EqualWidth` to `Weak`).

### Acceptance Criteria & Definition of Done
- Users can drag from the component library, drop into valid sections, and immediately see the element rendered with correct bindings placeholder data.
- Snapping, guides, and constraint overlays operate within 16 ms of pointer movement for documents up to 200 nodes on a mid-tier laptop (M1 Air baseline).
- Invalid drops are blocked with inline messaging and optional auto-remediation (wrap in section, convert to stack container).
- Undo/redo restores layout and constraint state exactly, including cursor focus and selection ribbons.
- Telemetry dashboard (Amplitude/Grafana) displays DnD KPIs: drag count, drop failure rate, average drag duration, and top constraint errors.

### Dependencies & Risks
- Requires Phase 0 command stack and rendering shell to be feature-complete (Plan §Phased Approach → Phase 0 – Foundations).
- Constraint solver performance may degrade with >1k constraints; mitigation includes batching re-solves per animation frame and providing a “simplify constraints” utility.
- Browser differences (Firefox vs. Chromium) in pointer-lock APIs must be abstracted to keep ruler measurements accurate.
- Security review for pasted content to ensure no executable payload injected while enabling copy/paste between sections.

## Data Structures & Intermediate Representation
- **Document Structure**: Hierarchical tree of IR nodes (`Document -> Page -> Section -> Container -> Element`). Each level conveys layout semantics:
  - `Document`: metadata (tenant, version, locale support), default styles, page settings.
  - `Page`: page size, margins, header/footer regions, breakpoint rules.
  - `Section`: logical grouping (e.g., billing summary) with repeat options (`repeat: none|forEach(items)|conditional`). Supports flow direction (`vertical`/`horizontal`) and overflow handling policy.
  - `Container`: layout primitives (`stack`, `grid`, `absolute`) with child positioning rules, padding, background, border.
  - `Element`: leaf nodes (text, image, table, line, spacer, field value).
- **Node Schema**: Each node contains:
  - `id` (UUID), `type`, `name`, `children[]`, `order`.
  - `layout`: `{x, y, width, height, gridArea, min/max constraints, alignment, zIndex}`.
  - `constraints`: array of constraint records `{type, targetNodeId, axis, relation, value, strength}` referencing Cassowary equations.
  - `props`: type-specific properties (text styles, image source, table columns, conditionals).
  - `bindings`: see below.
  - `behaviors`: rules like `groupId`, `reflowPolicy`, `pageBreakPreference`.
  - `metadata`: audit info, author, timestamps, comments.
- **Bindings**: Declarative expressions referencing invoice data context via JSONPath-like selectors with formatting directives. Structure: `{path: '$.invoice.total', fallback: '0.00', format: {type: 'currency', currency: 'USD', locale: 'en-US', precision: 2}, transforms: ['abs', 'round:2']}`. Bindings reference a central data dictionary that maps invoice domain objects to display names and validation rules.
- **Layout Presets**: Define reusable `layoutPreset` descriptors that bundle constraint graphs (e.g., `twoColumnEqual`, `headerLogoAddress`, `totalsRightDocked`). Nodes declare `layoutPresetId` + overrides so compiler/runtime can rehydrate preset intent, audit deviations, and offer "reset to preset" in the UI.
- **Variants**: Support optional variant groups (e.g., multi-language, branding) encoded via conditional nodes referencing tenant flags or binding predicates. Variants include `visibilityConditions` and `styleOverrides` arrays for dynamic adjustments.
- **Serialization**: IR stored as JSON with strict schema managed via `zod` and formalized in JSON Schema for backend validation; versioned to enable migrations. Schema evolves via `schemaVersion` + migration scripts executed in compilation service.
- **Intermediate Layout Ops**: Prior to compilation, IR is translated into a list of layout operations (`BeginPage`, `PlaceElement`, `SetConstraint`, `EmitBinding`) to feed the WASM runtime, maintaining stable IDs for diffing and caching.

## Persistence & Collaboration
- **Storage**: Save IR documents in Postgres JSONB with revision table capturing `template_id`, `version`, `author`, `created_at`, `changeset` diff.
- **API Layer**: GraphQL/REST endpoints for CRUD operations with optimistic concurrency; integrate with existing template management services.
- **Collaboration**: For Phase 2, add presence and conflict resolution using CRDT-based diffing (Y.js) layered over IR nodes.

## Sections, Grouping, and Page Management
- **Sections**: Designers create named sections (e.g., "Header", "Line Items", "Totals") with explicit entry/exit rules. Sections can be nested and inherit layout constraints. Section templates define defaults for padding, background, and repeat behavior.
- **Grouping**: Elements can be ad-hoc grouped into `Group` nodes, which wrap a `Container` with `groupId`. Groups support collective transformations (resize, alignment) and share constraints. Groups can be saved to the component library as reusable snippets.
- **Page Break Strategy**: Page nodes support `autoBreak` configuration. During compilation, a two-pass layout estimator simulates flow using element heights and binding data to predict overflow. Intelligent avoidance uses `keepWithNext` flags, `minimumWidowLines`, and `orphans` thresholds. Compilation inserts `PageBreak` operations where overflow is detected; designers can set manual breakpoints via handles.
- **Avoiding Cropping**: Constraint solver enforces that elements flagged `preventCrop` shrink or wrap when encountering page bounds. Tables use `repeatHeader` for multi-page continuity.
- **Headers & Footers**: Dedicated regions for repeating content with separate constraint sets and data bindings. Footers can access aggregate values calculated during compilation (e.g., total pages).

## Data Binding & Formatting Model
- **Data Dictionary**: Maintain a curated catalog of data fields derived from invoice schema (`Invoice`, `Customer`, `LineItem`, `Payments`). Each field entry specifies path, type, description, allowed formats, and availability (e.g., header vs. line items).
- **Binding Workflow**: Property inspector exposes searchable dictionary; selecting a field creates a binding record. Expressions support light transformation DSL: `{{ path | formatCurrency('USD') | default('0.00') }}` compiled into structured binding objects.
- **Formatting Engines**: Use Intl APIs (`Intl.NumberFormat`, `Intl.DateTimeFormat`) for currency/date/time. Provide custom formatters for percentages, units, text casing. Formatting metadata stored in `bindings.format` and re-used by runtime.
- **Validation**: Real-time validation ensures bindings resolve to allowed types. Display warnings if required fields are missing or formatting conflicts with data type.
- **Sample Data**: Designers can upload or select sample datasets; data binding preview uses sandboxed evaluation with fallback to placeholders.

## Layout Constraints, Snapping, and Algorithms
- **Grid System**: Base grid increments defined at document level; sections can override with nested grids (e.g., 12-column). Snap calculations performed using quantization on pointer coordinates aligned to grid spacing.
- **Smart Guides**: Compute proximity-based guides by comparing the active element's bounds against siblings using R-Tree indexing for O(log n) proximity queries. Guides appear when edges or centers align within threshold.
- **Auto Layout**: Containers support auto layout modes: `stack` (vertical/horizontal with spacing), `grid` (rows/columns with gaps), `absolute` (freeform). For stack mode, use flexbox algorithm simulation to preview overflow; for grid, compute track sizing using CSS Grid track sizing algorithm ported to JS for compile-time results.
- **Constraints Enforcement**: Cassowary solver resolves constraint set after each edit; conflicting constraints are reported with resolution suggestions (e.g., lower strength). Solver runs incrementally to avoid recomputing full solution.
- **Reflow & Pagination**: After layout updates, run a reflow pass to calculate expected heights. For repeating sections (e.g., tables), use sample data to compute min/max heights; store heuristics for pagination planner.

## Sections & Page Break Compilation Enhancements
- **Pre-Compilation Analysis**: Execute a measurement pass using browser rendering in an offscreen iframe or `jsdom` to capture actual element dimensions with fonts applied. Measurements feed into pagination algorithm.
- **Pagination Algorithm**: Implement dynamic programming to partition section content into pages minimizing penalties for breaking constraints (`keepTogether`, `keepWithNext`). Algorithm returns breakpoints inserted as `PageBreak` nodes in intermediate operations.
- **Fallback Handling**: If runtime data exceeds predicted sizes, WASM renderer receives metadata (`allowOverflow`, `truncateWithEllipsis`) to decide real-time adjustments.

## Compilation Pipeline
1. **Validation Stage**: Run schema validation, binding resolution checks, and layout constraint analysis.
2. **Transformation Stage**: Translate IR nodes into intermediate layout instructions (e.g., flex/grid operations) normalized to renderer expectations.
3. **Code Generation Stage**: Emit deterministic WASM-compatible AST or high-level DSL consumed by existing compiler; ensure stable ordering of nodes for diffing.
4. **Packaging Stage**: Bundle generated code with assets (images, fonts) and produce versioned artifact stored alongside IR.
5. **Testing & QA**: Snapshot tests comparing designer preview output to compiled WASM render; automated PDF/HTML render diffs via headless browser.

## Deliverables
- React-based designer application integrated into the invoice templates screen.
- IR schema documentation, migration tooling, and sample templates.
- Compilation service extensions, validation suite, and CI automation for template diffs.
- UX guidelines and training materials for internal teams.

## Success Metrics
- 80% of template adjustments performed without engineering intervention within 3 months.
- <5% compilation failures from IR due to validation gaps after launch.
- Average time to create a new template reduced from days to <4 hours.

## Resource Requirements
- **Engineering**: 2 front-end, 1 full-stack, 1 platform engineer (compilation/runtime), shared QA.
- **Design**: 0.5 FTE product designer for UX flows, component library definitions.
- **Product/Support**: 0.25 FTE product manager, 0.25 FTE CS enablement for rollout.
- **Infrastructure**: Sandbox environment for WASM compilation, feature flag rollout tooling.

## Risk Management
- **Schema Drift**: Risk of IR mismatches with WASM runtime. Mitigation: versioned schema, automated regression suite.
- **Performance**: Drag-and-drop may lag on large templates. Mitigation: virtualization, performance budgets, profiling.
- **Adoption Resistance**: Users may prefer legacy code flow. Mitigation: training, gradual rollout, ability to import/export code.
- **Security**: Ensure sandboxed preview to prevent execution of arbitrary scripts. Mitigation: compile in isolated service, sanitize bindings.

## Timeline & Milestones
- Week 0: Finalize requirements, design review, IR schema sign-off.
- Week 2: Complete rendering shell, component library scaffolding.
- Week 4: Drag-and-drop interactions, undo/redo, property inspector MVP.
- Week 6: Backend persistence, compile API, initial tenant pilot.
- Week 8: Advanced features (responsive layouts, theming/validation), performance hardening.
- Week 10: GA launch with documentation and enablement.

## Exit Criteria
- Designer shipped to production behind feature flag with >3 pilot tenants actively using it.
- IR schema version 1.0 published with migration tooling and validation suite in CI.
- Compilation pipeline integrated with release process, generating WASM artifacts automatically from IR.
- Feedback loop established (analytics + support channels) to drive future iterations.
- **Preset Catalog (MVP)**: Ship the following pre-built layouts in Phase 1; each preset inserts a full tree + constraint bundle + inspector toggles:
  1. **Header: Logo + Address**
     - _Tree_: Section(header) → Columns[Logo, AddressText].
     - _Constraints_: Column widths 1:2, Logo block `aspect-ratio` lock + left padding, Address column `align-top` + `match-height`, section padding token `headerPadding`.
     - _Inspector Toggles_: Swap column order, right-align address text, show/hide accent background.
  2. **Line Items Table**
     - _Tree_: Section(body) containing Table element bound to `lineItems` dictionary.
     - _Constraints_: Table width pinned to section width, header row repeat flag, min-height 320px, row height tokens, pagination hint `repeatHeader`.
     - _Inspector Toggles_: Show tax column, enable zebra striping, clamp columns to equal width.
  3. **Totals Stack**
     - _Tree_: Section(footer) → Column → [Totals block, Note text].
     - _Constraints_: Totals block `align-right` + `align-bottom`, Note block `align-left`, optional background stripe, spacing token 12px.
     - _Inspector Toggles_: Include “Balance Due” row, format currency variant, collapse note.
  4. **Two-Column Summary** (Body)
     - _Tree_: Section(body) → Columns[Summary list, Contact info].
     - _Constraints_: Equal column widths, gap 24px, summary list auto-layout stack with icon + text rows, contact column `align-top`.
     - _Inspector Toggles_: Convert to 3-column layout, switch icon theme.
  5. **Split Header w/ Payment QR**
     - _Tree_: Section(header) → Columns[Logo+Address stack, Spacer, QR code block].
     - _Constraints_: Column ratios 2:1:1, QR block `aspect-ratio` + right alignment, spacer auto-expands, address text wraps with defined line height.
     - _Inspector Toggles_: Hide QR, change QR data binding, adjust stripe color.
  Presets share JSON definitions (`layoutPresetId`, allowed overrides, constraint graph) so the designer, compiler, and runtime stay in sync.
