# Code Context — MSP Contact Portal Tab: Visibility Groups

## Files Retrieved

1. `packages/clients/src/components/contacts/ContactPortalTab.tsx` (full file, ~860 lines) — Main MSP-side component; renders the "Portal" tab on the contact detail page. Contains visibility group assignment dropdown, group CRUD form, and existing-group list.
2. `packages/clients/src/components/contacts/ContactPortalTab.visibilityGroups.test.tsx` (full file, ~275 lines) — Vitest unit tests covering T029 (assign/replace group) and T030 (create & edit group).
3. `packages/clients/src/actions/contact-actions/contactActions.tsx` (lines 1235–1570) — Server actions: `getClientPortalVisibilityGroupsForContact`, `getClientPortalVisibilityBoardsByClient`, `getClientPortalVisibilityGroupById`, `createClientPortalVisibilityGroupForContact`, `updateClientPortalVisibilityGroupForContact`, `deleteClientPortalVisibilityGroupForContact`, `assignClientPortalVisibilityGroupToContact`, plus helpers `resolveContactAndVerifyPermission` and `ensureContactPortalGroupsScope`.
4. `packages/clients/src/actions/contact-actions/visibilityGroupActions.integration.test.ts` (full file) — Test T031: assignment replacement is immediately reflected in portal visibility resolution.
5. `packages/clients/src/actions/contact-actions/visibilityGroupActions.permission.test.ts` (full file) — Tests T026 (cross-client assignment blocked), T033 (delete-assigned-group blocked), T034 (delete unassigned group succeeds).
6. `packages/clients/src/components/contacts/ContactDetails.tsx` (lines 896–965) — Tab definition; Portal tab is `id: 'portal'`, `label: "Portal"`, rendered via `<ContactPortalTab>`.

---

## 1. Route / Entry Point

**Navigation path:** MSP sidebar → Contacts → click a contact → "Portal" tab

- Contact list navigates to `/msp/contacts/{contact_name_id}` (`Contacts.tsx` line 271).
- `ContactDetailsView` renders `ContactDetails`, which defines a tabbed layout.
- The tab array (line 672+) includes `{ id: 'portal', label: "Portal", content: <ContactPortalTab .../> }`.
- Tab is selectable via URL param: `?tab=portal` (`defaultTab={searchParams?.get('tab')?.toLowerCase() || 'details'}`).

**Direct URL:** `/msp/contacts/{contact_name_id}?tab=portal`

---

## 2. Visible Labels, Buttons, Dialog Titles, Field Labels

### Section: "Client Portal Access" (Card)

| Element | Type | Text / Purpose |
|---|---|---|
| Card title | Heading with 🛡 icon | **Client Portal Access** |
| Card description | Subtext | "Manage client portal access and permissions for this contact" |

### Sub-section: Ticket Visibility Group Assignment

| Element | Type | Label / Text |
|---|---|---|
| Label | Static | **Ticket visibility group** |
| Description | Static | "Assign a visibility group for this contact, or keep full access." |
| `<CustomSelect>` | Dropdown (`id="visibility-group-assignment"`) | Options: `"Full access"` (value `__full_access__`) + each group as `"GroupName (N boards)"`. Placeholder: "Select visibility assignment". Disabled when `!canUpdateRoles` or `isUpdating`. |

### Sub-section: Visibility Groups for Client (CRUD)

| Element | Type | Label / Text |
|---|---|---|
| Label | Static | **Visibility groups for client** |
| Description | Static | "Create or edit groups of boards and use them for contact assignments." |
| `<Input>` | Text field (`id="visibility-group-name"`) | Label: **Group name**, placeholder: "Group name" |
| `<TextArea>` | Textarea (`id="visibility-group-description"`) | Label: **Description**, placeholder: "Optional description", 3 rows |
| Board checkboxes | `<Checkbox>` list | Label: **Boards**. Each board listed with checkbox inside a bordered scrollable div (max-h-56). |
| **Create group** / **Update group** | `<Button>` | Button text switches: "Create group" (new) or "Update group" (editing). Disabled when name is empty or `isUpdating`. |
| **Cancel** | `<Button variant="outline">` | Shown only when editing; resets form. |

### Existing Groups List

| Element | Type | Text |
|---|---|---|
| Group card | Bordered div | Shows **{name}**, "{N} board(s)", and optional description |
| **Edit** | `<Button variant="outline" size="sm">` | Loads group into form above |
| **Delete** | `<Button variant="outline" size="sm">` | Red text; triggers `confirm('Delete this visibility group?')` |
| Empty state | Static text | "No visibility groups yet" |

---

## 3. Guardrails & Immediate-Effect Behaviors (for smoke tests)

### Assignment (dropdown change)

- **Immediate effect**: Selecting a group in the "Ticket visibility group" dropdown calls `assignClientPortalVisibilityGroupToContact` immediately (no Save button). On success, toast "Contact visibility assignment updated". On failure, reverts to previous value and shows error toast.
- **"Full access"** = sets `portal_visibility_group_id` to `null`.
- **Cross-client guardrail** (`ensureContactPortalGroupsScope`): Server validates the group belongs to the same `client_id` as the contact. Throws "Assigned visibility group is invalid for this contact".
- **Permission gate**: Dropdown disabled when `currentUserPermissions.canUpdateRoles === false`.

### Create Group

- **Validation**: Group name is required (empty name shows toast "Visibility group name is required"; button also disabled).
- **Board validation**: Server checks each `boardId` belongs to the contact's client. Throws "One or more boards are invalid for this tenant".
- **Deduplication**: Server deduplicates `boardIds` via `Array.from(new Set(...))`.
- **Immediate effect**: After creation, group list refreshes and new group appears. Form resets.

### Edit Group

- **Flow**: Click "Edit" → loads group data (name, description, board_ids) into form → button text changes to "Update group" + Cancel appears.
- **Immediate effect**: After save, group list refreshes. Server replaces all board associations (delete-then-insert).

### Delete Group

- **Confirmation**: Browser `confirm('Delete this visibility group?')` dialog.
- **Assigned-contacts guardrail**: Server checks if any contacts reference this group. If yes, throws "Cannot delete visibility group while it is assigned to contacts". The group is **not** deleted.
- **Cascade**: On success, deletes from `client_portal_visibility_group_boards` first, then `client_portal_visibility_groups`.
- **UI cleanup**: If the deleted group was the currently assigned group for this contact, `selectedVisibilityGroupId` resets to `null` (Full access).

### Permission Model

- All server actions call `resolveContactAndVerifyPermission` which requires `contact:update` permission.
- Contact is resolved to a `client_id`; all group/board operations are scoped to that `(tenant, client_id)`.

### Immediate Portal Visibility (tested in T031)

- Assignment changes are written directly to `contacts.portal_visibility_group_id`.
- The portal-side visibility resolver (`getClientContactVisibilityContext`) reads this column, so changes take effect immediately for subsequent ticket listing API calls—no cache invalidation step needed.

---

## Architecture

```
ContactDetails.tsx (tab "Portal")
  └─ ContactPortalTab.tsx
       ├─ State: selectedVisibilityGroupId, visibilityGroups[], visibilityBoards[]
       │         editingVisibilityGroupId, form fields (name/desc/boardIds)
       ├─ On mount: loads groups for the contact's client + active boards for the tenant
       ├─ Assignment dropdown → assignClientPortalVisibilityGroupToContact (immediate)
       ├─ CRUD form → create/updateClientPortalVisibilityGroupForContact
       └─ Group list → edit (loads into form) / delete (with guardrails)

Server actions (contactActions.tsx):
  ├─ resolveContactAndVerifyPermission → contact:update permission + resolves client_id
  ├─ ensureContactPortalGroupsScope → group belongs to same client
  ├─ Group ownership and assignment checks scoped to (tenant, client_id)
  └─ Board pickers/validation scoped to tenant board IDs, excluding inactive boards

DB tables:
  ├─ client_portal_visibility_groups (tenant, client_id, group_id, name, description)
  ├─ client_portal_visibility_group_boards (tenant, group_id, board_id)
  └─ contacts.portal_visibility_group_id (FK → group assignment)
```

## Start Here

Read `ContactPortalTab.tsx` first — it contains the entire MSP-facing UI and state machine. Then `contactActions.tsx` lines 1235–1570 for server-side validation logic. The test files provide concrete behavioral contracts (T026, T029, T030, T031, T033, T034).
