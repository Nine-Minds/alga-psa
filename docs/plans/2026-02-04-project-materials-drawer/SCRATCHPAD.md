# Project Materials Drawer - Scratchpad

## Initial Discovery (2026-02-04)

### Related Work
- **Ticket Materials PR #1701** (merged 2026-01-29): `328eff8b0` - "feat: implement ticket materials with multi-currency"
- **Tag Filter Fix**: `6057c5bd0` - "Fix tag filter to preserve colors and clean orphans"

### Architecture Decision: Component Location

**Pattern Discovered:** `TicketMaterialsCard` lives in `@alga-psa/tickets`, NOT in `@alga-psa/billing`.

**Decision:** Keep `ProjectMaterialsDrawer` in `@alga-psa/projects` and add `@alga-psa/billing` as a dependency.

**Rationale:**
- Follows established pattern (TicketMaterialsCard in tickets, imports from billing)
- Feature modules keep their UI components
- Import actions from the domain owner (billing)

### Required Package Change

`packages/projects/package.json` needs:
```json
"dependencies": {
  "@alga-psa/billing": "*",
  // ... existing
}
```

### Existing Infrastructure

#### Server Actions (Already Exist!)
Located in `packages/billing/src/actions/materialActions.ts`:
- `listProjectMaterials(projectId)` - Returns `IProjectMaterial[]` with service_name and sku joined
- `addProjectMaterial(input)` - Creates new material (rate in cents, quantity floored to min 1)
- `deleteProjectMaterial(projectMaterialId)` - Deletes if not billed

All actions are already exported from `@alga-psa/billing/actions`.

#### Data Model
`IProjectMaterial` interface (`packages/types/src/interfaces/material.interfaces.ts`):
- `project_material_id: string` - Primary key
- `project_id: string` - Foreign key to project
- `client_id: string` - Foreign key to client (for billing)
- `service_id: string` - Foreign key to service_catalog (product)
- `service_name?: string` - Denormalized from service_catalog
- `sku?: string | null` - Product SKU
- `quantity: number`
- `rate: number` - Price in cents
- `currency_code: string` - ISO 4217 currency code
- `description?: string | null`
- `is_billed: boolean`

### Key Files

| File | Purpose |
|------|---------|
| `packages/projects/package.json` | Add billing dependency |
| `packages/projects/src/components/ProjectMaterialsDrawer.tsx` | Implement drawer |
| `packages/tickets/src/components/ticket/TicketMaterialsCard.tsx` | Reference impl |
| `packages/billing/src/actions/materialActions.ts` | Actions (complete) |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-04 | Keep component in projects package | Follows TicketMaterialsCard pattern |
| 2026-02-04 | Add @alga-psa/billing dependency | Required for material actions |
| 2026-02-04 | 12 features, 18 tests | Streamlined from initial 41/78 |

---

## Updates

- 2026-02-04: Added `@alga-psa/billing` dependency to `packages/projects/package.json` for project materials drawer actions.
- 2026-02-04: Added drawer header scaffold and set project materials drawer width to 560px via `openDrawer`.
- 2026-02-04: Wired `ProjectMaterialsDrawer` to `listProjectMaterials` with loading and empty states.
- 2026-02-04: Added materials table layout with product, SKU, qty, rate, total, and status badge columns.
- 2026-02-04: Added per-currency unbilled totals summary to support multi-currency projects.
- 2026-02-04: Implemented add-form product picker with searchable catalog lookup.
- 2026-02-04: Added price/currency selector with auto-selected first price and multi-price dropdown.
- 2026-02-04: Added quantity/description inputs and live total display to the add form.
- 2026-02-04: Implemented add-material submission with validation, toast feedback, and list refresh.
- 2026-02-04: Added delete action for unbilled materials with toast feedback and reload.
- 2026-02-04: Allowed materials drawer to open without a client and display a no-client warning while hiding the Add button.
- 2026-02-04: Wrapped drawer content in `ReflectionContainer` and added automation IDs for key elements.
- 2026-02-04: Added T001 test to assert billing dependency in projects package.json.
- 2026-02-04: Added T002 test to assert ProjectInfo opens materials drawer with 560px width.
- 2026-02-04: Added T003 test to verify loading state while materials fetch is pending.
- 2026-02-04: Added T004 test to verify empty state when no materials are returned.
- 2026-02-04: Added T005 test to verify table columns and material row content.
- 2026-02-04: Added T006 test to verify Pending/Billed badge rendering.
- 2026-02-04: Added T007 test to verify currency formatting from minor units.
- 2026-02-04: Added T008 test to verify per-currency unbilled totals summary.
- 2026-02-04: Added T009 test to ensure product picker loads catalog items.
- 2026-02-04: Added T010 test to ensure price selector options appear after product selection.
- 2026-02-04: Added T011 test for quantity default/min validation.
- 2026-02-04: Added T012 test for total recalculation on quantity/currency changes.
- 2026-02-04: Added T013 test to verify add-material submission and list refresh.
- 2026-02-04: Added T014 test to verify validation toasts for missing product/price.
