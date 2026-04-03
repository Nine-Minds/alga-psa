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
- 2026-03-08 F004: Wired `packages/tickets/src/components/QuickAddTicket.tsx` to pass `onAddNew` into `ContactPicker`, open `QuickAddContact`, and prefill it with the current `clientId`. Also exported `QuickAddContact` from `packages/clients/src/components/index.ts` so consumers can use the package surface instead of a non-exported deep path.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- Test blocker: `packages/tickets` Vitest still resolves deep server/auth imports while loading `QuickAddTicket`, so the new `QuickAddTicketPrefill` assertions for T006-T008 are written but not yet checklisted. I added `vite-tsconfig-paths` plus ticket-package aliases/mocks to reduce the surface, but the suite still bottoms out in unrelated auth/db module resolution.
- 2026-03-08 F005: `QuickAddTicket` now merges the created contact into local picker state, selects its `contact_name_id`, and closes the dialog after creation.
- 2026-03-08 F006: Wired `packages/tickets/src/components/ticket/TicketProperties.tsx` to open `QuickAddContact` from the inline contact editor, prefill it with the ticket/client context, and keep a local picker contact list synchronized so newly created contacts can be chosen immediately.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F007: Wired `packages/clients/src/components/interactions/QuickAddInteraction.tsx` to offer inline contact creation when a client is selected, reuse `QuickAddContact`, append the new contact into local state, and auto-select it for the in-progress interaction.
- Validation: `npx tsc -p packages/clients/tsconfig.json --noEmit`
- 2026-03-08 F008: Wired `packages/clients/src/components/interactions/OverallInteractionsFeed.tsx` to offer `QuickAddContact` from the filter dialog, remove the empty-list disable state so add-new stays reachable, merge created contacts into `allContacts`, and auto-select the new contact in the active filter.
- Validation: `npx tsc -p packages/clients/tsconfig.json --noEmit`
- 2026-03-08 F009: Wired `packages/projects/src/components/ProjectQuickAdd.tsx` to open `QuickAddContact` from the project contact picker once a client is selected, merge the created contact into local state, and auto-select it in the form.
- Validation: `npx tsc -p packages/projects/tsconfig.json --noEmit`
- 2026-03-08 F010: Wired `packages/projects/src/components/Projects.tsx` contact filter to open `QuickAddContact`, append the created contact to the cached filter data, and auto-select that contact in the active filter state.
- Validation: `npx tsc -p packages/projects/tsconfig.json --noEmit`
- 2026-03-08 F011: Wired `packages/clients/src/components/clients/ClientDetails.tsx` default-contact picker to open `QuickAddContact` for the current client, merge the created contact into the local default-contact options, and immediately apply it as the default contact selection.
- Validation: `npx tsc -p packages/clients/tsconfig.json --noEmit`
- 2026-03-08 F012: Wired `packages/clients/src/components/clients/BillingConfigForm.tsx` billing-contact picker to open `QuickAddContact` with the current client preselected, merge the new contact into local picker state, and apply it as the billing contact while clearing the fallback billing email.
- Validation: `npx tsc -p packages/clients/tsconfig.json --noEmit`
- 2026-03-08 F013: Wired `server/src/components/settings/general/UserManagement.tsx` existing-contact picker to open `QuickAddContact`, append the created contact to the invitation picker state, auto-select it, and prefill the new user form from the created contact.
- Validation attempt: `npx tsc -p server/tsconfig.json --noEmit` crashed with `Signal(6)` before reporting file-level diagnostics.
- Validation attempt: `npx esbuild server/src/components/settings/general/UserManagement.tsx --bundle --platform=node --format=esm --tsconfig=server/tsconfig.json --outfile=/tmp/user-management-check.js` reached unrelated asset/font resolution errors outside this change.
- 2026-03-08 F014: Wired `ee/server/src/components/settings/integrations/EntraReconciliationQueue.tsx` to load clients, pass `onAddNew` into each queue row's `ContactPicker`, open a shared `QuickAddContact` with the row's mapped client preselected, append the created contact into `allContacts`, and auto-select it for that queue item.
- Validation: `npx tsc -p ee/server/tsconfig.json --noEmit`
- 2026-03-08 F015: Added optional `onAddNew` support to `packages/ui/src/components/ClientPicker.tsx` and rendered the bottom separator/button using the same utility-class pattern as `ContactPicker`/`EditableServiceTypeSelect`.
- Validation: `npx tsc -p packages/ui/tsconfig.json --noEmit`
- 2026-03-08 F016: `ClientPicker` now resets the search term, closes the dropdown, and only then invokes the consumer's `onAddNew` callback so the QuickAdd dialog can take focus immediately.
- Validation: `npx tsc -p packages/ui/tsconfig.json --noEmit`
- 2026-03-08 F017: Confirmed `ClientPicker` remains backward compatible because the new separator/button are fully gated behind the optional `onAddNew` prop; consumers that omit it still render the original dropdown content only.
- Validation: `npx tsc -p packages/ui/tsconfig.json --noEmit`
- 2026-03-08 F018: Wired `packages/tickets/src/components/QuickAddTicket.tsx` to open `QuickAddClient` from `ClientPicker`, merge new clients into local state, auto-select the created client, and let the existing client-data effect refresh contacts/locations for the new selection.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F019: Wired `packages/projects/src/components/ProjectQuickAdd.tsx` to maintain a local `clientOptions` list, open `QuickAddClient` from the client picker, merge newly created clients into that list, and auto-select the new client while clearing any stale contact selection.
- Validation: `npx tsc -p packages/projects/tsconfig.json --noEmit`
- 2026-03-08 F020: Wired `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx` to open `QuickAddClient` from the contract client picker, merge created clients into the billing client cache, and immediately update wizard state (including default currency) to the new client.
- Validation: `npx tsc -p packages/billing/tsconfig.json --noEmit`
- 2026-03-08 F021: Wired `packages/billing/src/components/billing-dashboard/ManualInvoices.tsx` to keep a local `clientOptions` cache, expose `QuickAddClient` from the invoice client picker, merge created clients, and auto-select the new client for manual invoice creation.
- Validation: `npx tsc -p packages/billing/tsconfig.json --noEmit`
- 2026-03-08 F022: Wired `packages/assets/src/components/QuickAddAsset.tsx` client picker to open `QuickAddClient`, merge newly created clients into local state, and auto-select the client so asset creation can continue without leaving the modal.
- Validation: `npx tsc -p packages/assets/tsconfig.json --noEmit`
- 2026-03-08 F023: Extracted the create-only category dialog into `packages/tickets/src/components/QuickAddCategory.tsx` and exported it from the tickets component surface, preserving the existing create-form structure (name, board/parent selection, footer actions) as reusable UI.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F024: `QuickAddCategory` now accepts `preselectedBoardId`, seeds the create form with that board, and hides the board selector whenever the consumer already knows the board context.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F025: `QuickAddCategory` renders the required category-name input, conditionally shows the board selector, and keeps the optional parent-category dropdown filtered to top-level categories with board-aware labels/inheritance.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F026: `QuickAddCategory` now validates the create request, calls `createCategory` with board/parent inheritance, shows a success toast, and hands the created `ITicketCategory` back through `onCategoryCreated` so consumers can update local picker state.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F027: `QuickAddCategory` loads boards internally via `getAllBoards` when the consumer does not pass a board list, while still honoring injected board data from settings or inline ticket forms.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F028: Refactored `packages/tickets/src/components/settings/CategoriesSettings.tsx` so add-category now uses the extracted `QuickAddCategory` component, while the settings page still owns the edit-only dialog markup and refreshes category data after create.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F029: Preserved CategoriesSettings behavior by keeping the existing edit-category path intact, leaving board-change warnings/display-order editing untouched, and refreshing category data after both create and update flows.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F030: Added generic `onAddNew`/`addNewLabel` support to `packages/ui/src/components/TreeSelect.tsx`, rendering the separator/button inside the Radix portal content and explicitly closing the dropdown before invoking the consumer callback.
- Validation: `npx tsc -p packages/ui/tsconfig.json --noEmit && npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F031: `packages/tickets/src/components/CategoryPicker.tsx` now accepts `onAddNew` and passes it into `TreeSelect` with a category-specific `+ Add new category` label.
- Validation: `npx tsc -p packages/ui/tsconfig.json --noEmit && npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F032: Wired `packages/tickets/src/components/QuickAddTicket.tsx` category picker to open `QuickAddCategory` with `boardId` preselected, merge the created category into local state, and auto-select it immediately in the ticket form.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F033: Wired `packages/tickets/src/components/ticket/TicketInfo.tsx` category editor to open `QuickAddCategory` with the effective board context, merge created categories into either saved or pending category state, and set `category_id`/`subcategory_id` correctly for newly created parent or child categories.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F034: Wired `packages/tickets/src/components/TicketingDashboard.tsx` category filter to open `QuickAddCategory`, merge the created category into local filter options, and immediately select the new category while clearing any exclusion state for it.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 F035: The ticket-details screen now inherits inline category creation through `packages/tickets/src/components/ticket/TicketInfo.tsx`, which `TicketDetails` renders with the current ticket board/category context and updated category state.
- Validation: `npx tsc -p packages/tickets/tsconfig.json --noEmit`
- 2026-03-08 T006: Fixed the `packages/tickets` Vitest aliases/mocks that `QuickAddTicket` needs, then validated that clicking `+ Add new contact` in `QuickAddTicketPrefill.test.tsx` opens the mocked `QuickAddContact` dialog.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddTicketPrefill.test.tsx -t "T00[678]"`
- 2026-03-08 T007: The same focused `QuickAddTicketPrefill` coverage now asserts that `QuickAddContact` receives `client-1` as `selectedClientId` when the add-new contact dialog opens.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddTicketPrefill.test.tsx -t "T00[678]"`
- 2026-03-08 T008: `QuickAddTicketPrefill.test.tsx` now verifies the full happy path: creating a contact through the mocked `QuickAddContact` appends it to local picker state and selects `contact-new` automatically.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddTicketPrefill.test.tsx -t "T00[678]"`
- 2026-03-08 T009: Added `packages/tickets/src/components/ticket/__tests__/TicketPropertiesQuickAddContact.test.tsx` to open the inline contact editor, trigger `+ Add new contact`, and assert the mocked `QuickAddContact` dialog opens with `ticket.client_id` taking precedence over the fallback client context.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/ticket/__tests__/TicketPropertiesQuickAddContact.test.tsx`
- 2026-03-08 T010: Added `packages/clients/src/components/interactions/QuickAddInteraction.quick-add-contact.contract.test.ts` to lock the add-new contact wiring in `QuickAddInteraction`, including the guarded `onAddNew` callback and the forwarded `selectedClientId` into `QuickAddContact`.
- Validation: `cd packages/clients && npx vitest run --config vitest.config.ts src/components/interactions/QuickAddInteraction.quick-add-contact.contract.test.ts`
- 2026-03-08 T011: Added `packages/clients/src/components/interactions/OverallInteractionsFeed.quick-add-contact.contract.test.ts` to pin the filter dialog wiring that opens `QuickAddContact`, forwards the current client context, and auto-selects the created contact in filter state.
- Validation: `cd packages/clients && npx vitest run --config vitest.config.ts src/components/interactions/OverallInteractionsFeed.quick-add-contact.contract.test.ts`
- 2026-03-08 T012: Added `packages/projects/src/components/ProjectQuickAdd.quick-add-contact.contract.test.ts` to lock the `ProjectQuickAdd` contact-picker wiring that gates `onAddNew` on a selected client, opens `QuickAddContact`, and auto-selects the created contact.
- Validation: `cd packages/projects && npx vitest run --config vitest.config.ts src/components/ProjectQuickAdd.quick-add-contact.contract.test.ts`
- 2026-03-08 T013: Added `packages/projects/src/components/Projects.quick-add-contact.contract.test.ts` to preserve the projects filter wiring that opens `QuickAddContact`, forwards the current client filter, and auto-selects the created contact in filter state.
- Validation: `cd packages/projects && npx vitest run --config vitest.config.ts src/components/Projects.quick-add-contact.contract.test.ts`
- 2026-03-08 T014: Added `packages/clients/src/components/clients/ClientDetails.quick-add-contact.contract.test.ts` to lock the default-contact picker wiring that opens `QuickAddContact` for the current client and immediately applies the created contact as the new default.
- Validation: `cd packages/clients && npx vitest run --config vitest.config.ts src/components/clients/ClientDetails.quick-add-contact.contract.test.ts`
- 2026-03-08 T015: Added `packages/clients/src/components/clients/BillingConfigForm.quick-add-contact.contract.test.ts` to preserve the billing-contact picker wiring that opens `QuickAddContact`, passes the current `clientId`, and clears fallback billing email when a new contact is created.
- Validation: `cd packages/clients && npx vitest run --config vitest.config.ts src/components/clients/BillingConfigForm.quick-add-contact.contract.test.ts`
- 2026-03-08 T016: Added `server/src/components/settings/general/UserManagement.quick-add-contact.contract.test.ts` to preserve the invite-contact wiring that opens `QuickAddContact`, forwards `newUser.clientId`, and hydrates the new-user form from the created contact.
- Validation: `cd server && npx vitest run --config vitest.config.ts --coverage.enabled false src/components/settings/general/UserManagement.quick-add-contact.contract.test.ts`
- 2026-03-08 T017: Added `server/src/components/settings/integrations/EntraReconciliationQueue.quick-add-contact.contract.test.ts` to preserve the EE reconciliation queue wiring that opens `QuickAddContact`, forwards the mapped client context, and assigns the created contact back to the queued item.
- Validation: `cd server && npx vitest run --config vitest.config.ts --coverage.enabled false src/components/settings/integrations/EntraReconciliationQueue.quick-add-contact.contract.test.ts`
- 2026-03-08 T018: Added `packages/ui/src/components/ClientPicker.test.tsx` and verified that `ClientPicker` renders the bottom separator plus `+ Add new client` action only when `onAddNew` is supplied.
- Validation: `cd packages/ui && npx vitest run --config vitest.config.ts src/components/ClientPicker.test.tsx -t T018`
- 2026-03-08 T019: Extended `packages/ui/src/components/ClientPicker.test.tsx` to verify backward compatibility — the inline `+ Add new client` action stays hidden when `onAddNew` is omitted.
- Validation: `cd packages/ui && npx vitest run --config vitest.config.ts src/components/ClientPicker.test.tsx -t T019`
- 2026-03-08 T020: Extended `packages/ui/src/components/ClientPicker.test.tsx` to verify that clicking `+ Add new client` calls the consumer callback exactly once and closes the dropdown portal.
- Validation: `cd packages/ui && npx vitest run --config vitest.config.ts src/components/ClientPicker.test.tsx -t T020`
- 2026-03-08 T021: Extended `packages/tickets/src/components/__tests__/QuickAddTicketPrefill.test.tsx` so the mocked `ClientPicker` exposes `+ Add new client` and the mocked `QuickAddClient` dialog, then verified that clicking the picker action opens the client quick-add dialog.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddTicketPrefill.test.tsx -t T021`
- 2026-03-08 T022: Extended `QuickAddTicketPrefill.test.tsx` again so the mocked `QuickAddClient` creates a client and closes via `onOpenChange(false)`, then verified `QuickAddTicket` appends the new client and auto-selects `client-new`.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddTicketPrefill.test.tsx -t T022`
- 2026-03-08 T023: Added `packages/projects/src/components/ProjectQuickAdd.quick-add-client.contract.test.ts` to preserve the `ProjectQuickAdd` client-picker wiring that opens `QuickAddClient`, merges the created client into local options, auto-selects it, and clears any stale contact selection.
- Validation: `cd packages/projects && npx vitest run --config vitest.config.ts src/components/ProjectQuickAdd.quick-add-client.contract.test.ts`
- 2026-03-08 T024: Added `packages/billing/tests/contract-basics-step.quick-add-client.contract.test.ts` to preserve the contract-wizard client picker wiring that opens `QuickAddClient`, merges the created client, auto-selects it, and updates contract currency from the new client defaults.
- Validation: `cd packages/billing && npx vitest run --config vitest.config.ts tests/contract-basics-step.quick-add-client.contract.test.ts`
- 2026-03-08 T025: Added `packages/billing/tests/manual-invoices.quick-add-client.contract.test.ts` to preserve the manual-invoice client picker wiring that opens `QuickAddClient`, merges created clients into local options, and auto-selects the new client.
- Validation: `cd packages/billing && npx vitest run --config vitest.config.ts tests/manual-invoices.quick-add-client.contract.test.ts`
- 2026-03-08 T026: Added `packages/assets/src/components/QuickAddAsset.quick-add-client.contract.test.ts` to preserve the asset quick-add client picker wiring that opens `QuickAddClient`, merges the created client, auto-selects it, and clears validation state.
- Validation: `cd packages/assets && npx vitest run --config vitest.config.ts src/components/QuickAddAsset.quick-add-client.contract.test.ts`
- 2026-03-08 T027: Added `packages/tickets/src/components/__tests__/QuickAddCategory.test.tsx` with a jsdom harness for `QuickAddCategory`, starting by verifying the create dialog renders the required category-name input.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T027`
- 2026-03-08 T028: Extended `QuickAddCategory.test.tsx` to verify the board selector is visible in create mode when no `preselectedBoardId` is supplied.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T028`
- 2026-03-08 T029: Extended `QuickAddCategory.test.tsx` to verify `preselectedBoardId` hides the board selector so inline callers can skip redundant board selection.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T029`
- 2026-03-08 T030: Extended `QuickAddCategory.test.tsx` to verify the parent-category select remains available and is filtered to top-level categories on the active board only.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T030`
- 2026-03-08 T031: Extended `QuickAddCategory.test.tsx` to submit the dialog, assert `createCategory` receives the expected payload, and verify `onCategoryCreated` is called with the returned category.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T031`
- 2026-03-08 T032: Extended `QuickAddCategory.test.tsx` to verify the dialog blocks submission and surfaces `Category name is required` when the name field is left blank.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T032`
- 2026-03-08 T033: Extended `QuickAddCategory.test.tsx` to verify top-level category creation is blocked with `Board is required for top-level categories` when no board is selected.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T033`
- 2026-03-08 T034: Extended `QuickAddCategory.test.tsx` to verify that omitting the `boards` prop triggers an internal `getAllBoards()` fetch and populates the board selector from the fetched data.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddCategory.test.tsx -t T034`
- 2026-03-08 T035: Added `packages/tickets/src/components/settings/__tests__/CategoriesSettings.contract.test.ts` to lock the refactor entry point: `CategoriesSettings` now imports and renders `QuickAddCategory` for the add dialog.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/settings/__tests__/CategoriesSettings.contract.test.ts -t T035`
- 2026-03-08 T036: Extended `CategoriesSettings.contract.test.ts` to preserve create-flow parity by asserting the extracted `QuickAddCategory` still receives boards/categories and triggers `fetchCategories()` after creation.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/settings/__tests__/CategoriesSettings.contract.test.ts -t T036`
- 2026-03-08 T037: Extended `CategoriesSettings.contract.test.ts` to preserve edit-flow parity, asserting the inline edit dialog remains, `updateCategory` is still called for edits, and categories refresh after update.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/settings/__tests__/CategoriesSettings.contract.test.ts -t T037`
- 2026-03-08 T038: Added `packages/ui/src/components/TreeSelect.contract.test.ts` to lock the new add-new UI block in `TreeSelect`, including the separator, `Plus` icon, and configurable label.
- Validation: `cd packages/ui && npx vitest run --config vitest.config.ts src/components/TreeSelect.contract.test.ts -t T038`
- 2026-03-08 T039: Extended `TreeSelect.contract.test.ts` to assert the add-new UI stays fully gated behind the optional `onAddNew` prop and its default `addNewLabel`.
- Validation: `cd packages/ui && npx vitest run --config vitest.config.ts src/components/TreeSelect.contract.test.ts -t T039`
- 2026-03-08 T040: Added `packages/tickets/src/components/CategoryPicker.contract.test.ts` to lock the `CategoryPicker` passthrough wiring into `TreeSelect`, including the category-specific add-new label.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/CategoryPicker.contract.test.ts -t T040`
- 2026-03-08 T041: Extended `QuickAddTicketPrefill.test.tsx` with `CategoryPicker`/`QuickAddCategory` mocks so the ticket form now verifies `+ Add new category` opens the category quick-add dialog with `board-1` preselected.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/__tests__/QuickAddTicketPrefill.test.tsx -t T041`
- 2026-03-08 T042: Added `packages/tickets/src/components/QuickAddTicket.category.contract.test.ts` to lock the post-create category wiring in `QuickAddTicket`: created categories merge into local state, become the selected category, clear submission errors, and close the inline dialog.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/QuickAddTicket.category.contract.test.ts -t T042`
- 2026-03-08 T043: Added `packages/tickets/src/components/ticket/__tests__/TicketCategoryConsumer.contract.test.ts` to preserve `TicketInfo` wiring into `QuickAddCategory`, including the effective board preselection and post-create category selection updates.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/ticket/__tests__/TicketCategoryConsumer.contract.test.ts -t T043`
- 2026-03-08 T044: Added `packages/tickets/src/components/TicketingDashboard.category.contract.test.ts` to preserve dashboard filter wiring into `QuickAddCategory`, including board-context preselection and immediate category filter selection after create.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/TicketingDashboard.category.contract.test.ts -t T044`
- 2026-03-08 T045: Extended `TicketCategoryConsumer.contract.test.ts` to confirm `TicketDetails` inherits inline category creation via `TicketInfo`, passing through the live ticket and initial category context that `TicketInfo` uses for board-aware quick-add.
- Validation: `cd packages/tickets && npx vitest run --config vitest.config.ts src/components/ticket/__tests__/TicketCategoryConsumer.contract.test.ts -t T045`
- 2026-03-08 T046: Added a minimal root `jest.config.cjs` to ignore collision-heavy generated folders (`dist/`, `.ai/`, nested eslint-plugin package copies) and set `passWithNoTests`, then renamed the Vitest-only picker spec filenames so the PRD’s Jest path-pattern command stops picking them up.
- Validation: `npx jest --testPathPattern='QuickAddTicket|ContactPicker|TicketProperties|ClientPicker|CategoryPicker'`
