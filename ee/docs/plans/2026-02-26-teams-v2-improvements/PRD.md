# PRD — Teams V2 Improvements: Org Chart Redesign, Team Avatars, Picker Enhancements

- Slug: `teams-v2-improvements`
- Date: `2026-02-26`
- Status: Draft
- Parent: `teams-v2` (all 50 original features implemented)

## Summary

Three improvements to the shipped teams-v2 feature:

1. **Org Chart Redesign** — Replace the basic nested-list org chart with a visual ReactFlow-based chart. Merge the stacked ViewSwitchers into one toolbar. Rename "Org Chart" to "Structure". Make nodes clickable to open the UserDetails drawer for editing.
2. **Team Avatar Infrastructure** — Add image/avatar upload capability to teams using the existing `EntityImageService` + `document_associations` pattern. Create `TeamAvatar` component, server actions, SWR hook, and upload UI in team settings.
3. **Team Avatars in Pickers** — Replace the generic gray circle + Users icon in `UserAndTeamPicker` with the new `TeamAvatar` component. Extract team logic from `MultiUserPicker` into a new `MultiUserAndTeamPicker` component (matching the `UserPicker` → `UserAndTeamPicker` pattern). Call sites swap via `teams-v2` feature flag.

All changes remain behind the `teams-v2` PostHog feature flag. All migrations are Citus-compliant.

## Problem

1. **Org chart is ugly and non-functional** — The current implementation is a plain nested `<ul>` list with CSS indentation. It only displays structure — clicking does nothing. The page has two stacked ViewSwitchers (portal type + list/org toggle) which looks cluttered. The "Org Chart" label is clunky.

2. **Teams have no visual identity** — Teams cannot have an avatar or image. In pickers, every team looks identical (gray circle with generic icon). This makes it hard to quickly identify teams in a list, especially when there are many.

3. **Pickers don't leverage team identity** — Even without uploaded images, teams could show colored initials (like users do) instead of a generic icon, providing better visual distinction.

## Goals

1. Render the org hierarchy as a proper visual chart with ReactFlow, showing user avatars and roles
2. Make org chart nodes clickable to open the UserDetails drawer for editing
3. Consolidate the two ViewSwitchers into one clean toolbar row
4. Rename the "Org Chart" tab to "Structure"
5. Enable image upload for teams using the existing avatar infrastructure
6. Display team avatars (or colored initials fallback) in `UserAndTeamPicker` and new `MultiUserAndTeamPicker`
7. Extract team logic from `MultiUserPicker` into a dedicated `MultiUserAndTeamPicker` component
8. Add team avatar upload UI to team management settings

## Non-goals

- Team avatar in the org chart nodes (only user avatars shown there)
- Drag-and-drop rearranging of org chart hierarchy
- Exporting org chart as image/PDF
- Team avatar in ticket list columns or other non-picker contexts
- Bulk team avatar upload

## Users and Primary Flows

### Personas

- **MSP Admin** — Manages org structure and teams. Uploads team avatars. Views org chart.
- **Technician / Agent** — Assigns teams to tickets via pickers. Benefits from team visual identity.

### Primary Flows

**Flow 1: Admin views org structure**
1. Opens Settings → Users
2. Clicks "Structure" toggle in the header toolbar
3. Sees a visual ReactFlow chart with cards for each user (avatar, name, role)
4. Zoom/pan to explore large hierarchies
5. Clicks a person node → UserDetails drawer opens for editing

**Flow 2: Admin uploads team avatar**
1. Opens Settings → Teams
2. Selects a team
3. Clicks the avatar upload area in TeamDetails
4. Selects an image file
5. Avatar appears on the team and in all pickers

**Flow 3: Agent sees team identity in picker**
1. Opens a ticket
2. Clicks the "Assigned To" picker
3. Teams section shows each team with colored initials (or uploaded avatar) instead of a generic icon
4. Easier to visually identify the right team

## UX / UI Notes

### Org Chart
- ReactFlow canvas with custom card-style nodes
- Each node: UserAvatar (sm) + name + role text + inactive badge if applicable
- Edges: smoothstep connectors from parent (bottom) → child (top)
- FitView on mount, zoom/pan enabled, nodes not draggable
- Click node → open UserDetails drawer (same as clicking user in list view)
- Empty state: text message when no users have `reports_to` set

### Toolbar Consolidation
**Before (two stacked rows):**
```
[User Management title]           [MSP | Client Portal]
[Search] [Status Filter]    [List | Org Chart] [Create User]
```
**After (one row in header):**
```
[User Management title]     [List | Structure] [MSP | Client Portal]
```
- Structure toggle only visible when `teams-v2` enabled AND portal type is MSP
- Search/status filter toolbar stays as-is in the content area (list view only)

### Team Avatar Upload
- Shown in TeamDetails component, above team name field
- Uses `EntityImageUpload` component (same as user avatar upload)
- Circular avatar with upload overlay on hover

### Team Avatars in Pickers
- Replace hardcoded `<div className="h-7 w-7 rounded-full bg-gray-200 ..."><TeamIcon /></div>` with `<TeamAvatar>`
- When no image uploaded: shows colored initials generated from team name (EntityAvatar behavior)
- When image uploaded: shows the team image
- `UserAndTeamPicker` updated in-place (already a team-aware wrapper)
- `MultiUserPicker` cleaned up: team logic extracted into a new `MultiUserAndTeamPicker` component
  - Follows the same pattern as `UserPicker` → `UserAndTeamPicker`
  - `MultiUserPicker` stays team-free (no team props, no team filtering/rendering)
  - Call sites swap between the two via `teams-v2` feature flag

## Requirements

### Functional Requirements

#### Phase 3A: Team Avatar Infrastructure

- FR-3A.1: Migration: Update `document_associations` entity_type CHECK constraint to include `'team'`
- FR-3A.2: Add `'team'` to `EntityType` union in all 4 definitions across the codebase
- FR-3A.3: Add `getTeamAvatarUrl()` helper function in media package avatarUtils
- FR-3A.4: Create `TeamAvatar` UI component (wrapper around `EntityAvatar`)
- FR-3A.5: Create `uploadTeamAvatar` server action in teams package
- FR-3A.6: Create `deleteTeamAvatar` server action in teams package
- FR-3A.7: Create `getTeamAvatarUrlAction` server action in teams package
- FR-3A.8: Create `getTeamAvatarUrlsBatchAction` server action in teams package
- FR-3A.9: Create `useTeamAvatar` SWR hook in teams package
- FR-3A.10: Add team avatar upload/delete UI to TeamDetails component
- FR-3A.11: Team avatar upload requires team edit permission

#### Phase 3B: Org Chart Redesign

- FR-3B.1: Create custom ReactFlow node component (`OrgChartNode`) showing user avatar, name, role
- FR-3B.2: Create `OrgChart` container component with ReactFlow canvas, tree layout, and node click handling
- FR-3B.3: OrgChart computes hierarchical layout from `reports_to` data (top-down tree with centered subtrees)
- FR-3B.4: OrgChart uses `fitView` on mount and supports zoom/pan
- FR-3B.5: Clicking a node opens UserDetails drawer (reuses existing useDrawer + UserDetails pattern)
- FR-3B.6: OrgChart batch-fetches user avatar URLs for all nodes
- FR-3B.7: Merge the two ViewSwitchers into one row in CardHeader
- FR-3B.8: Remove duplicate list/org ViewSwitcher from list view toolbar and org view header
- FR-3B.9: Rename "Org Chart" label to "Structure"
- FR-3B.10: Replace inline nested-list rendering with new OrgChart component
- FR-3B.11: All org chart features remain behind `teams-v2` feature flag

#### Phase 3C: Team Avatars in Pickers

- FR-3C.1: `UserAndTeamPicker`: replace hardcoded TeamIcon with `TeamAvatar` component
- FR-3C.2: `UserAndTeamPicker`: add optional `getTeamAvatarUrlsBatch` prop for fetching team avatar URLs
- FR-3C.3: `UserAndTeamPicker`: batch-fetch team avatar URLs when dropdown opens

#### Phase 3D: MultiUserAndTeamPicker Extraction

- FR-3D.1: Create `MultiUserAndTeamPicker` component (copy of `MultiUserPicker` with team logic + `TeamAvatar`)
- FR-3D.2: `MultiUserAndTeamPicker`: replace all hardcoded TeamIcon instances with `TeamAvatar` component
- FR-3D.3: `MultiUserAndTeamPicker`: add `getTeamAvatarUrlsBatch` prop and batch-fetch team avatar URLs
- FR-3D.4: Remove team props and team logic from original `MultiUserPicker` (teams, teamFilterFn, team rendering, stale team cleanup)
- FR-3D.5: Call sites swap `MultiUserPicker` → `MultiUserAndTeamPicker` when `teams-v2` flag is enabled
- FR-3D.6: Thread `getTeamAvatarUrlsBatchAction` through `MultiUserAndTeamPicker` call sites
- FR-3D.7: Pickers gracefully fall back to colored initials when no avatar URL is available (no gray circle)

### Non-functional Requirements

- NFR-3.1: All new UI gated behind `teams-v2` feature flag
- NFR-3.2: Migration is Citus-compliant (`exports.config = { transaction: false }`, `NOT VALID` constraint)
- NFR-3.3: No new npm dependencies — ReactFlow, SWR already available
- NFR-3.4: Team avatar actions follow established `withAuth` + permission check pattern
- NFR-3.5: ReactFlow import must be SSR-safe (dynamic import with `{ ssr: false }`)

## Data / API / Integrations

### Schema Changes

```sql
-- Update CHECK constraint on document_associations to add 'team'
ALTER TABLE document_associations
DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;

ALTER TABLE document_associations
ADD CONSTRAINT document_associations_entity_type_check
CHECK (entity_type IN ('asset','client','contact','contract','project_task','team','tenant','ticket','user'))
NOT VALID;
```

### New Server Actions (teams package)

- `uploadTeamAvatar(teamId, formData)` → calls `uploadEntityImage('team', ...)`
- `deleteTeamAvatar(teamId)` → calls `deleteEntityImage('team', ...)`
- `getTeamAvatarUrlAction(teamId)` → returns URL string
- `getTeamAvatarUrlsBatchAction(teamIds)` → returns `Map<string, string | null>`

### Package Dependency Changes

`packages/teams/package.json` — add: `@alga-psa/media`, `@alga-psa/auth`, `swr`

## Security / Permissions

- Team avatar upload/delete: requires team edit permission (same as `updateTeam`)
- Org chart node click opens UserDetails drawer: respects existing user edit permission checks
- All queries remain tenant-scoped

## Rollout / Migration

- Single additive migration (CHECK constraint update) — no data changes
- All UI behind existing `teams-v2` feature flag — no new flag needed
- No breaking changes to existing functionality

## Acceptance Criteria

1. Org chart renders as a visual ReactFlow chart with user avatar cards and connecting edges
2. Clicking a person node opens UserDetails drawer for editing
3. ViewSwitchers consolidated into one header row — no more stacked toggles
4. Tab is labeled "Structure" instead of "Org Chart"
5. Teams can have an uploaded avatar image visible in team settings
6. Team avatars (or colored initials) appear in `UserAndTeamPicker` and `MultiUserAndTeamPicker` instead of gray circles
7. `MultiUserPicker` is team-free; `MultiUserAndTeamPicker` handles team logic; call sites swap via feature flag
8. All features are invisible when `teams-v2` flag is off
9. Migration runs successfully on Citus
