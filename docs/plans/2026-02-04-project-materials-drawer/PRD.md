# PRD: Project Materials Drawer

## Problem Statement

Projects currently have a placeholder "Materials" button that opens a drawer displaying only an alert message: "Project materials are now owned by Billing." Users cannot manage materials (products) for projects, even though:

1. The backend infrastructure already exists (`listProjectMaterials`, `addProjectMaterial`, `deleteProjectMaterial`)
2. The data model is complete (`IProjectMaterial` interface, `project_materials` table)
3. Tickets have a fully functional materials card that users expect to work similarly for projects

This creates an inconsistent UX where materials work for tickets but not for projects.

## Goals

1. **Implement fully functional Project Materials Drawer** - Allow users to view, add, and delete materials for projects
2. **Maintain consistency with Ticket Materials** - Same interaction patterns, multi-currency support, and validation rules
3. **Use drawer layout** - As specified, materials management should be in a slide-out drawer (not an inline card like tickets)

## Non-Goals

- Bulk material operations (add multiple at once)
- Material editing (only add/delete, same as tickets)
- Export/import materials
- Material templates or presets
- Project-specific pricing overrides (uses service catalog prices)

## Architecture Compliance

### Package Location
**Keep in `@alga-psa/projects/components`** - Following the established pattern where `TicketMaterialsCard` lives in `@alga-psa/tickets`.

### Required Dependency Addition
Add `@alga-psa/billing` to `packages/projects/package.json`:
```json
"dependencies": {
  "@alga-psa/billing": "*",
  // ... existing deps
}
```

### Import Pattern (Same as TicketMaterialsCard)
```typescript
import {
  listProjectMaterials,
  addProjectMaterial,
  deleteProjectMaterial,
  searchServiceCatalogForPicker,
  getServicePrices,
} from '@alga-psa/billing/actions';
```

## Target Users

- **MSP Administrators** - Managing project-based work for clients
- **Project Managers** - Tracking materials used on projects for billing

## User Flow

### Primary Flow: View Project Materials
1. User navigates to a project detail page
2. User clicks "Materials" button in project header
3. Drawer slides in from right showing materials list or empty state

### Secondary Flow: Add Material
1. User clicks "Add" button
2. Selects product, currency (if multi-currency), quantity
3. Optionally adds description
4. Clicks "Add Material" → material appears in list

### Secondary Flow: Delete Material
1. User clicks delete (trash icon) on unbilled material
2. Material removed, toast shown

## UX/UI Specification

### Drawer Layout
- **Width:** 560px (standard detail drawer width)
- **Position:** Right side slide-in

### Drawer Structure
```
┌─────────────────────────────────────┐
│ Materials                    [Add]  │
├─────────────────────────────────────┤
│ [Add Form - when visible]           │
├─────────────────────────────────────┤
│ Product | Qty | Rate | Total | Stat │
│ ─────────────────────────────────── │
│ Item 1  |  2  | $50  | $100  | Pend │
├─────────────────────────────────────┤
│            Unbilled (USD): $100.00  │
└─────────────────────────────────────┘
```

## Data Model (Existing)

```typescript
interface IProjectMaterial {
  project_material_id: string;
  project_id: string;
  client_id: string;
  service_id: string;
  service_name?: string;
  sku?: string | null;
  quantity: number;
  rate: number;           // In cents
  currency_code: string;  // ISO 4217
  description?: string | null;
  is_billed: boolean;
  // ... timestamps
}
```

## API/Actions (Existing in @alga-psa/billing/actions)

| Action | Purpose |
|--------|---------|
| `listProjectMaterials(projectId)` | Fetch materials with service_name/sku joined |
| `addProjectMaterial({...})` | Create material (rate in cents) |
| `deleteProjectMaterial(id)` | Delete if not billed |
| `searchServiceCatalogForPicker({...})` | Get products for dropdown |
| `getServicePrices(serviceId)` | Get multi-currency prices |

## Acceptance Criteria

- [ ] Drawer opens when "Materials" button clicked
- [ ] Materials displayed in table with all fields
- [ ] Add form with product picker, currency, quantity, description
- [ ] Successfully adds material and refreshes list
- [ ] Delete button removes unbilled materials
- [ ] Unbilled totals grouped by currency
- [ ] Warning when project has no client
- [ ] Error handling with toast notifications

## Files to Modify

1. `packages/projects/package.json` - Add `@alga-psa/billing` dependency
2. `packages/projects/src/components/ProjectMaterialsDrawer.tsx` - Complete implementation

## Reference Implementation

`packages/tickets/src/components/ticket/TicketMaterialsCard.tsx` - Follow this pattern exactly, adapted for drawer layout.
