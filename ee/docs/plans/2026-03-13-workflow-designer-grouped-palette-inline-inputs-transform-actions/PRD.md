# PRD — Workflow Designer Grouped Palette, Inline Action Inputs, and Transform Actions

- Slug: `workflow-designer-grouped-palette-inline-inputs-transform-actions`
- Date: `2026-03-13`
- Status: Draft

## Summary
Refactor the workflow designer so builders no longer start from a sprawling per-action palette or a mapping-first input editor. Instead, they add a smaller set of grouped business-object or app tiles, choose the specific action inside the step, configure the action through an inline field-by-field editor, and use first-class transform steps for common data shaping rather than expanding expression syntax.

This work keeps workflow runtime execution stable in v1. Action steps still execute as `action.call`, selected actions still persist through `config.actionId` and `config.version`, and action inputs still persist through `config.inputMapping`. The refactor is primarily an authoring and designer-model overhaul, plus additive metadata for grouped catalogs, typed pickers, and transform actions.

## Problem
The current workflow authoring model has three compounding problems:

1. The palette grows linearly with every action. This creates search friction, categorization sprawl, and a poor path for future pluggable units.
2. The current action-input authoring flow is mapping-centric instead of task-centric. Users must understand the previous-output-to-current-schema mapping model before they can simply fill out the current action’s required fields.
3. Expression authoring is too programmer-oriented for common data-shaping tasks. Each new “simple” transformation risks expanding the expression surface and training users on a mini-language instead of providing guided workflow tooling.

These issues make workflows harder to discover, harder to author, and harder to extend safely.

## Goals
- Replace the per-action palette with a grouped object/app palette that scales cleanly as actions increase.
- Make action authoring start from the selected action’s accepted fields, not from an abstract mapping canvas.
- Let users choose the action after dropping a grouped tile, so the step model aligns with business objects and future plugins.
- Provide typed pickers for known fields so users choose valid business records rather than entering raw GUIDs.
- Introduce a `Transform` grouping with first-class transformation actions for common text/value/object shaping.
- Preserve runtime compatibility for existing workflows and existing `action.call` execution.
- Keep advanced expressions available as an escape hatch, but make them secondary to structured authoring.

## Non-goals
- Replacing the runtime `action.call` execution contract in v1.
- Replacing `config.inputMapping` with a new persisted action-input model in v1.
- Introducing a generalized visual transformation chain per field in v1.
- Converting every action in the system to typed pickers in the first pass.
- Creating a new full plugin packaging system in this plan; this plan only prepares the designer catalog and grouping model so plugins can slot in.
- Removing advanced expressions entirely.
- Reworking trigger payload mapping as part of this effort.

## Users and Primary Flows
### Users
- MSP admin building automations in the workflow designer
- Internal Alga PSA engineers extending the workflow action catalog
- Future extension/plugin authors who need grouped entry points in the designer

### Primary flows
1. **Add a business action**
   - User opens the palette.
   - User drags `Ticket` into the workflow.
   - Step appears as a grouped action step with `Ticket` selected as its group.
   - User chooses `Create Ticket`, `Find Ticket`, `Update Ticket`, or another allowed ticket action from the step’s action dropdown.
   - The properties panel shows only the fields accepted by the chosen action.

2. **Configure an action input**
   - User selects a step.
   - User sees each target field directly in the properties panel.
   - For each field, user chooses a source mode:
     - reference workflow data
     - choose a fixed value
     - use advanced expression/secret fallback
   - Required field completion updates live.

3. **Use a business-record picker**
   - User configures a field such as `board_id`, `client_id`, or `priority_id`.
   - Workflow designer presents a domain-specific picker instead of a raw string field.
   - User can either choose a fixed business record or map the field dynamically from prior workflow data.

4. **Shape data without writing expressions**
   - User drags `Transform` into the workflow.
   - User chooses a transform action such as truncate text, concatenate values, pick fields, rename fields, or build object.
   - Step output becomes a named workflow value that later business steps can reference.

5. **Edit an existing workflow created before this refactor**
   - Existing `action.call` steps still load.
   - Designer infers their group from `actionId`.
   - User edits them through the new grouped-step and field-based UI without migration.

6. **Use future app/plugin actions**
   - User drags an app tile from the palette.
   - Inside the step, user chooses from actions exposed by that app.
   - App actions reuse the same grouped-step and field-editor model.

## UX / UI Notes
### Palette Model
- Replace one-tile-per-action palette items with a smaller grouped palette.
- Keep control blocks as dedicated items.
- Built-in business functionality appears as domain-object tiles such as Ticket, Contact, Client, Communication, Scheduling, Project, Time, CRM, and Transform.
- External/pluggable functionality appears as app tiles.
- Search must continue to match contained action names and relevant field names.

### Step Properties Model
- Action steps are edited inline in the right-side properties panel.
- A grouped action step first shows:
  - the group/app label
  - the action dropdown
  - step naming/output controls
- Once an action is selected, the properties panel shows:
  - action summary
  - required-field completion state
  - inline field editors
  - output/save-as controls
  - advanced sections only where needed

### Field Authoring Model
- The action input editor is field-first, not mapping-first.
- Each top-level action input field appears as a visible row or group.
- Nested object and array inputs appear as expandable field groups.
- Source-mode selection is explicit per field.
- Structured reference selection should be the default path.
- Expression and secret editing should be visually de-emphasized as advanced options.

### Picker UX
- Known entity identifiers should render pickers with readable labels.
- Fixed-value pickers should store only the resolved identifier in the workflow definition.
- Dynamic reference mode must remain available even when a fixed picker exists.
- Dependent pickers should narrow their options when enough upstream fixed values exist.
- When a dependency is dynamic and cannot be statically resolved, the dependent picker should explain why it cannot provide a fixed selection.

### Transform UX
- `Transform` behaves like a first-class grouped action, not like a special-case modal or hidden utility.
- Transform actions should use the same properties-panel affordances as business actions.
- Transform steps should make their output shape clear so downstream reference pickers/autocomplete stay understandable.

## Requirements

### Functional Requirements
#### Grouped Palette and Designer Action Catalog
- Introduce a designer-facing action catalog that groups actions into core business objects, transform actions, and app/plugin tiles.
- Keep runtime action registry intact; grouped catalog is a designer abstraction layered above it.
- Each grouped tile defines:
  - stable group key
  - display label
  - icon
  - tile kind (`core-object`, `transform`, `app`)
  - list of allowed actions
  - optional default action
- Built-in action groups must be inferred from action IDs/modules where possible, with explicit overrides where module naming is insufficient.
- Existing palette search must continue working against grouped tiles, including matches on contained action names.

#### Grouped Action Step Model
- Dropping a grouped tile creates an `action.call` step scoped to that tile’s group/app.
- The selected action is stored through the existing action config fields.
- Group/app metadata may be stored additively for authoring convenience but must not be required for runtime execution.
- Existing workflows without additive group metadata must still hydrate into the correct grouped-step UI.
- Changing the selected action inside a grouped step must refresh:
  - action label/description
  - input schema-driven fields
  - output schema-driven data context
  - required-field completion state
  - picker metadata and dependencies

#### Inline Field-Based Action Input Editor
- Replace the current action-input dialog as the primary authoring surface with an inline field-based editor.
- Render top-level action input fields directly from the chosen action schema.
- Preserve nested object/array editing using expandable nested field groups.
- Provide explicit per-field source modes:
  - reference
  - fixed value
  - advanced
- Continue serializing into the existing `config.inputMapping` contract.

#### Reference Source Model
- Reference mode must allow selecting values from:
  - workflow payload
  - previous step outputs
  - workflow metadata
  - catch-block error context
  - forEach item/index context
- Reference selection should generate the existing expression-backed mapping values under the hood.
- Output schemas from prior steps must continue to drive autocomplete and source browsing.

#### Picker Metadata and Fixed Value Authoring
- Action schemas must support additive designer metadata that marks fields as known picker-backed entities.
- Registry/catalog responses must carry enough metadata for the designer to render these pickers.
- Fixed picker mode must support readable selection and persist the literal identifier value.
- Dynamic reference mode must still be available on picker-backed fields.
- Ticket-core pickers in v1 must cover:
  - client
  - contact
  - board
  - ticket status
  - ticket priority
  - user/team assignee
  - category
  - subcategory
  - location

#### Transform Actions
- Add a `Transform` grouped tile with first-class actions for common data shaping.
- Transform actions must execute through the same `action.call` mechanism as other actions.
- Transform actions must expose explicit input and output schemas so downstream steps can reference their results.
- Initial transform library must cover:
  - string truncation
  - string concatenation
  - string replacement
  - string split/join
  - string case conversion
  - trim/coalesce/defaulting
  - field picking
  - field renaming
  - object construction from named inputs
- Transform outputs must be referenceable via normal workflow output/save-as behavior.

#### Advanced Expressions
- Existing expression support remains available as an advanced fallback.
- The new authoring model must not require users to learn expressions for common shaping use cases covered by transform actions.
- New common transformations should prefer first-class transform actions over expanding the expression grammar.

#### Plugin/App Support
- Designer action catalog must support app/plugin tiles alongside built-in object tiles.
- App tiles must be able to expose a filtered action dropdown inside the grouped step.
- App actions should be able to participate in the same field-editor and picker-metadata model if they provide the necessary schema annotations.

#### Compatibility, Save/Load, and Validation
- Existing workflows must load, save, publish, and execute without runtime migration.
- Existing `action.call` steps must render in the grouped-step UI even if they were created before grouped tiles existed.
- Required-field and type-compatibility validation must continue working after the editor refactor.
- Changing an action inside an existing grouped step must handle stale input mappings safely and predictably.
- Designer save/reload must preserve selected group, selected action, input values, and save-as outputs.

### Non-functional Requirements
- Grouped palette search and grouped-step rendering should remain responsive even as the action catalog grows.
- The designer model should reduce, not increase, the amount of custom one-off UI needed for each action.
- Additive schema metadata must not break runtime consumers that only care about JSON schema semantics.
- Transform actions should be deterministic and schema-driven so they remain inspectable and debuggable.

## Data / API / Integrations
### Designer Catalog Data
- Add a designer-facing catalog or equivalent registry projection for grouped tiles and contained actions.
- The catalog may be derived server-side from the action registry and additive group metadata.

### Action Schema Metadata
- Extend action schema export or metadata projection so input fields can carry:
  - picker kind
  - optional dependency information
  - optional fixed-value UI hints

### Runtime Compatibility
- Keep runtime step execution on `action.call`.
- Keep action input persistence on `config.inputMapping`.
- Keep existing output schema inference driven by the chosen action’s output schema.

## Security / Permissions
- Existing workflow permissions remain the authority for editing grouped steps and action inputs.
- Read-only users may inspect grouped steps but may not alter selected action or field values.
- Picker-backed fixed selections must only expose data the current workflow authoring user is allowed to see through existing server actions/endpoints.
- Plugin/app tiles must not bypass normal workflow authoring permissions.

## Observability
- No new observability scope is required for v1 beyond preserving current save/publish/run debugging behavior.
- Validation messages in the designer should clearly indicate:
  - missing selected action
  - missing required field values
  - invalid advanced expression/secret usage
  - stale or incompatible mappings after action changes

## Rollout / Migration
- No runtime migration is required for existing workflow definitions.
- Existing workflows continue to persist the same execution contract.
- Group metadata and picker metadata are additive.
- Designer hydration must infer grouped presentation for legacy `action.call` steps using the existing `actionId`.
- Import/export behavior should remain compatible as long as runtime step definitions remain unchanged.

## Open Questions
- Whether app tiles will eventually need a second-level object chooser inside the step. Default for this plan: no second chooser unless a specific app cannot be represented by a single filtered action dropdown.
- Whether some transform actions should later collapse into inline per-field helpers. Default for this plan: no inline transformation chains in v1.
- Whether more built-in pickers beyond ticket-core fields should follow in later phases. Default for this plan: no, keep first pass to ticket-core only.

## Acceptance Criteria (Definition of Done)
- The workflow palette no longer renders one tile per action for built-in business actions.
- Builders can add a grouped business-object tile, choose its action inside the step, and configure its fields inline.
- Action inputs are authored primarily through field rows/groups, not through a mapping dialog.
- Ticket-core identifier fields support fixed pickers and dynamic references.
- Builders can use `Transform` steps for common text/value/object shaping without writing expressions.
- Existing `action.call` workflows created before the refactor still load, save, publish, and execute correctly.
- Advanced expressions remain available for unsupported edge cases but are not required for common authoring flows.
