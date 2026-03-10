# PRD — Inline "Add New" for Picker Dropdowns

- Slug: `inline-add-new-pickers`
- Date: `2026-03-08`
- Status: Draft

## Summary

Add optional "+ Add new" buttons at the bottom of ContactPicker, ClientPicker, and CategoryPicker dropdowns, allowing users to create new entities inline without navigating away from their current form. This reuses existing QuickAdd dialog components and follows the established pattern from EditableServiceTypeSelect.

## Problem

When creating a ticket, project, contract, or other entity, users frequently need a contact, client, or category that doesn't exist yet. Currently they must:

1. Abandon or save their in-progress form
2. Navigate to the relevant settings/management page
3. Create the entity
4. Navigate back and re-open their form
5. Select the newly created entity

This interrupts workflow and causes data loss (unsaved form state). It's especially painful during ticket creation, which is the highest-frequency operation.

## Goals

1. **Inline creation** — users can create contacts, clients, and categories without leaving their current form
2. **Reuse existing dialogs** — QuickAddContact, QuickAddClient, and the CategoriesSettings add dialog are already built; reuse them
3. **Auto-select** — after creating a new entity, it's automatically selected in the picker
4. **Backward compatible** — the "+ Add new" button only appears when the consumer opts in via `onAddNew` prop
5. **Extract QuickAddCategory** — pull the inline dialog out of CategoriesSettings into a reusable component, then use it in both settings and inline contexts

## Non-goals

- Adding inline creation to UserPicker, BoardPicker, PrioritySelect, or other admin-managed pickers
- Adding inline creation to ServiceCatalogPicker (uses AsyncSearchableSelect — different base component, deferred)
- Building new CRUD dialogs — only reusing/extracting what already exists
- Changing the QuickAdd dialog UIs themselves

## Users and Primary Flows

**Primary user:** MSP technician/admin creating or editing tickets, projects, contracts, invoices, and assets

**Flow 1 — Create contact from ticket form:**
1. User opens QuickAddTicket, selects a company
2. Clicks contact dropdown, sees existing contacts + "+ Add new contact" at bottom
3. Clicks "+ Add new contact" — dropdown closes, QuickAddContact dialog opens (client pre-selected)
4. Creates contact in dialog
5. Dialog closes, new contact appears in dropdown and is auto-selected

**Flow 2 — Create client from project form:**
1. User opens ProjectQuickAdd
2. Clicks client dropdown, sees existing clients + "+ Add new client"
3. Clicks it — QuickAddClient dialog opens
4. Creates client, dialog closes, client auto-selected

**Flow 3 — Create category from ticket form:**
1. User opens QuickAddTicket, selects a board
2. Clicks category dropdown, sees tree of categories + "+ Add new category"
3. Clicks it — QuickAddCategory dialog opens (board pre-selected from context)
4. Enters category name, optionally selects parent
5. Category created, auto-selected in picker

## Technical Design

### Architecture

Pickers are **generic UI components** (in `packages/ui` or `packages/tickets`). They accept an optional `onAddNew?: () => void` callback. When provided, they render a separator + button at the bottom of the dropdown. They do NOT import QuickAdd dialogs.

**Consumers** (in domain packages like `packages/tickets`, `packages/projects`, etc.) are responsible for:
- Passing `onAddNew` to the picker
- Rendering the QuickAdd dialog
- Handling the `onCreated` callback to update local state and auto-select

### Reference Implementation

`EditableServiceTypeSelect` (`packages/ui/src/components/EditableServiceTypeSelect.tsx` lines 253-303) already implements this pattern with a `+ Add new service type` button, separator, and inline input.

### Key Components

| Component | Location | Role |
|-----------|----------|------|
| ContactPicker | `packages/ui/src/components/ContactPicker.tsx` | Add `onAddNew` prop, render button |
| ClientPicker | `packages/ui/src/components/ClientPicker.tsx` | Add `onAddNew` prop, render button |
| CategoryPicker | `packages/tickets/src/components/CategoryPicker.tsx` | Add `onAddNew` prop, pass to TreeSelect |
| TreeSelect | `packages/ui/src/components/TreeSelect.tsx` | Add `onAddNew` prop, render button |
| QuickAddContact | `packages/clients/src/components/contacts/QuickAddContact.tsx` | Existing — no changes |
| QuickAddClient | `packages/clients/src/components/clients/QuickAddClient.tsx` | Existing — no changes |
| QuickAddCategory | `packages/tickets/src/components/QuickAddCategory.tsx` | **NEW** — extracted from CategoriesSettings |

### Button Style

Consistent across all three pickers:
```
w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-gray-100 cursor-pointer
```
With a `border-t` separator div above it. Uses `Plus` icon from lucide-react.

### QuickAddCategory Extraction

Extract the Add/Edit Category dialog from `CategoriesSettings.tsx` (lines 486-620) into a standalone component:

```typescript
interface QuickAddCategoryProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoryCreated: (category: ITicketCategory) => void;
  preselectedBoardId?: string; // hides board selector when provided
  categories?: ITicketCategory[]; // for parent category dropdown
  boards?: IBoard[]; // fetched internally if not provided
}
```

After extraction, `CategoriesSettings` uses `QuickAddCategory` instead of its inline dialog.

## Functional Requirements

### FR-1: ContactPicker onAddNew
- ContactPicker accepts optional `onAddNew?: () => void` prop
- When provided, renders separator + "+ Add new contact" button at bottom of contact list
- Clicking calls `onAddNew()` and closes the dropdown
- When not provided, picker behaves identically to current (backward compatible)

### FR-2: ContactPicker Consumer Wiring (10 files)
- Each consumer adds state for QuickAddContact dialog visibility
- Passes `onAddNew` callback to ContactPicker
- Renders QuickAddContact dialog with appropriate context (selectedClientId, clients list)
- On `onContactAdded`: adds contact to local state, auto-selects it

### FR-3: ClientPicker onAddNew
- Same pattern as FR-1 but for ClientPicker with "+ Add new client" text

### FR-4: ClientPicker Consumer Wiring (5 files)
- Same pattern as FR-2 but using QuickAddClient dialog
- On `onClientAdded`: adds client to local state, auto-selects it

### FR-5: QuickAddCategory Component
- Extracted from CategoriesSettings inline dialog
- Supports `preselectedBoardId` to hide board selector
- Fetches boards internally if not provided via props
- Uses `createCategory` action from ticketCategoryActions
- Shows: category name input, board selector (when no preselectedBoardId), parent category dropdown (optional)
- Auto-calculates display_order via the action

### FR-6: CategoriesSettings Refactor
- Replace inline Add/Edit dialog with QuickAddCategory component
- No user-visible behavior change in settings page

### FR-7: CategoryPicker/TreeSelect onAddNew
- TreeSelect accepts optional `onAddNew?: () => void` and renders button at bottom
- CategoryPicker passes `onAddNew` through to TreeSelect

### FR-8: CategoryPicker Consumer Wiring (2-5 files)
- Each consumer passes `preselectedBoardId` from context
- On `onCategoryCreated`: adds category to local state, auto-selects it

## Acceptance Criteria

1. All three pickers show "+ Add new" button ONLY when `onAddNew` is provided
2. Button styling matches EditableServiceTypeSelect pattern (separator + icon + text)
3. Clicking the button closes the dropdown and opens the appropriate QuickAdd dialog
4. After creating an entity, it appears in the picker and is auto-selected
5. CategoriesSettings continues to work identically after QuickAddCategory extraction
6. No regressions in existing picker behavior when `onAddNew` is not provided
7. Existing tests pass: `npx jest --testPathPattern="QuickAddTicket|ContactPicker|TicketProperties|ClientPicker|CategoryPicker"`

## Risks

- **TreeSelect is Radix-based** — the button must be rendered inside the Radix Select content portal. Need to verify it doesn't interfere with Radix's focus management.
- **QuickAddCategory extraction** — the CategoriesSettings dialog also handles editing (not just creation). The extracted component should handle create-only mode; editing stays in CategoriesSettings.
- **Client list availability** — some ContactPicker consumers may not have a clients list loaded. QuickAddContact needs `clients: IClient[]`. Consumers that don't have this must fetch it.

## Open Questions

None — all resolved during exploration phase.
