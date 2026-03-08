# Scratchpad — Inline Add New Pickers

## Key File Paths

### Picker Components (to modify)
- `packages/ui/src/components/ContactPicker.tsx` — add `onAddNew` prop, render button after scrollable list (~line 361)
- `packages/ui/src/components/ClientPicker.tsx` — add `onAddNew` prop, render button after client list (~line 341)
- `packages/tickets/src/components/CategoryPicker.tsx` — add `onAddNew` prop, pass to TreeSelect
- `packages/ui/src/components/TreeSelect.tsx` — add `onAddNew` prop, render button at bottom of Radix content

### Existing QuickAdd Dialogs (to reuse as-is)
- `packages/clients/src/components/contacts/QuickAddContact.tsx` — Props: `isOpen, onClose, onContactAdded(IContact), clients: IClient[], selectedClientId?: string`
- `packages/clients/src/components/clients/QuickAddClient.tsx` — Props: `open, onOpenChange(boolean), onClientAdded(IClient), trigger?: ReactNode`

### QuickAddCategory (to extract)
- Source: `packages/tickets/src/components/settings/CategoriesSettings.tsx` lines 486-620 (inline dialog JSX)
- Target: `packages/tickets/src/components/QuickAddCategory.tsx` (new file)
- Action: `packages/tickets/src/actions/ticketCategoryActions.ts` → `createCategory` (line 269)
- Also uses: `getAllBoards` from `packages/tickets/src/actions/board-actions/boardActions.ts`

### Reference Implementation
- `packages/ui/src/components/EditableServiceTypeSelect.tsx` lines 253-303 — the "+ Add new" button pattern

## ContactPicker Consumers (10 files)

| # | File | clientId source | contacts source | clients list |
|---|------|----------------|-----------------|--------------|
| 1 | `packages/tickets/src/components/QuickAddTicket.tsx` | `clientId` state | `contacts` state (via getContactsByClient) | `filteredClients` |
| 2 | `packages/tickets/src/components/ticket/TicketProperties.tsx` | `ticket.company_id` prop | `contacts` prop from parent | Need to pass or fetch |
| 3 | `packages/clients/src/components/interactions/QuickAddInteraction.tsx` | `selectedClientId` state | `contacts` state (via getAllContacts) | `clients` available |
| 4 | `packages/clients/src/components/interactions/OverallInteractionsFeed.tsx` | `selectedClient` state | `contacts` state (via getAllContacts) | `clients` available |
| 5 | `packages/projects/src/components/ProjectQuickAdd.tsx` | `selectedClientId` state | `contacts` state | `clients` available |
| 6 | `packages/projects/src/components/Projects.tsx` | filter state | `allContacts` state | `allClients` available |
| 7 | `packages/clients/src/components/clients/ClientDetails.tsx` | `clientId` prop | `clientActiveContacts` prop | current client context |
| 8 | `packages/clients/src/components/clients/BillingConfigForm.tsx` | billing context | `contacts` prop | may need clients prop |
| 9 | `server/src/components/settings/general/UserManagement.tsx` | `selectedClientId` state | `contacts` state | `clients` available |
| 10 | `ee/server/src/components/settings/integrations/EntraReconciliationQueue.tsx` | per-item clientId | `allContacts` state | `clients` available |

## ClientPicker Consumers (5 key files)

| # | File | Notes |
|---|------|-------|
| 1 | `packages/tickets/src/components/QuickAddTicket.tsx` | Ticket creation — highest impact |
| 2 | `packages/projects/src/components/ProjectQuickAdd.tsx` | Project creation |
| 3 | `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx` | Contract creation |
| 4 | `packages/billing/src/components/billing-dashboard/ManualInvoices.tsx` | Invoice creation |
| 5 | `packages/assets/src/components/QuickAddAsset.tsx` | Asset creation |

## CategoryPicker Consumers (4 key files)

| # | File | boardId source | categories source |
|---|------|---------------|-------------------|
| 1 | `packages/tickets/src/components/QuickAddTicket.tsx` | `boardId` state | `categories` state |
| 2 | `packages/tickets/src/components/ticket/TicketInfo.tsx` | `ticket.board_id` via props | `effectiveCategories` from props |
| 3 | `packages/tickets/src/components/TicketingDashboard.tsx` | board filter | categories loaded |
| 4 | `packages/tickets/src/components/ticket/TicketDetails.tsx` | ticket context | categories from props |

## Consumer Wiring Pattern (copy-paste template)

```tsx
// 1. Add state
const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);

// 2. Pass to picker
<ContactPicker
  onAddNew={() => setIsQuickAddContactOpen(true)}
  // ... existing props
/>

// 3. Render dialog
<QuickAddContact
  isOpen={isQuickAddContactOpen}
  onClose={() => setIsQuickAddContactOpen(false)}
  onContactAdded={(newContact) => {
    setContacts(prev => [...prev, newContact]);
    setSelectedContactId(newContact.contact_name_id);
    setIsQuickAddContactOpen(false);
  }}
  clients={clients}
  selectedClientId={selectedClientId}
/>
```

## Decisions

- **Pickers stay generic** — no QuickAdd imports in picker components. Consumer wires the dialog.
- **QuickAddCategory is create-only** — editing stays inline in CategoriesSettings. The extracted component handles only creation.
- **CategoriesSettings still handles edit mode** — it passes `editingCategory` and different save logic for edits. QuickAddCategory only handles the create path.
- **preselectedBoardId simplifies inline UX** — when board is known from context (ticket creation), skip the board dropdown entirely.
- **TreeSelect gets onAddNew** — since CategoryPicker is a thin wrapper around TreeSelect, the button rendering logic goes in TreeSelect.

## Gotchas

- **QuickAddContact needs `clients: IClient[]`** — some consumers may not have this loaded. They'll need to fetch it or pass an empty array (QuickAddContact shows a client dropdown).
- **TreeSelect uses Radix Select** — the add button must be inside the Radix portal content. Verify focus management doesn't break.
- **CategoriesSettings edit dialog has more fields** — the extracted QuickAddCategory handles create-only (name, board, parent, display_order). Editing (which also changes board for parent categories + shows warnings) may stay as inline JSX in CategoriesSettings OR QuickAddCategory can accept an `editingCategory` prop for dual-mode. TBD during implementation — start with create-only.
- **QuickAddTicket gets THREE new dialogs** — ContactPicker, ClientPicker, AND CategoryPicker all wired. This file will have the most changes.

## Implementation Order

1. **Part 1** — ContactPicker core (onAddNew prop + button)
2. **Part 2** — ContactPicker consumers (10 files, mechanical)
3. **Part 3** — ClientPicker core (onAddNew prop + button)
4. **Part 4** — ClientPicker consumers (5 files, mechanical)
5. **Part 5a** — Extract QuickAddCategory from CategoriesSettings
6. **Part 5b** — Refactor CategoriesSettings to use QuickAddCategory
7. **Part 5c** — TreeSelect + CategoryPicker onAddNew
8. **Part 5d** — CategoryPicker consumers (4 files)
9. **Verify** — run existing tests, manual smoke test

## Progress Log
- 2026-03-08 F001: Added optional `onAddNew` support to `packages/ui/src/components/ContactPicker.tsx` and rendered the bottom separator/button using the PRD styling pattern. Included the dropdown height estimate update so the portal positions correctly when the new action is present.
- Validation: `cd packages/ui && npx vitest run --config vitest.config.ts src/components/ContactPicker.test.tsx`
- 2026-03-08 F002/F003: The new `handleAddNew` path now closes the dropdown before invoking the consumer callback, and the add-new UI is fully gated behind the optional prop so existing picker rendering remains unchanged when omitted.
- 2026-03-08 T001: Verified the add button and separator render when `onAddNew` is present.
- 2026-03-08 T002: Verified the add button stays hidden when `onAddNew` is omitted.
- 2026-03-08 T003: Verified the add button keeps the requested utility classes and renders a `Plus` icon.
- 2026-03-08 T004: Verified clicking the add button calls the consumer callback exactly once.
- 2026-03-08 T005: Verified clicking the add button closes the dropdown portal.
