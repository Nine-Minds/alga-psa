# Contact client picker lists only one client (alga0002338)

Card 5c3ce8c1. Customer report: Joymode Business Solutions, ticket alga0002338, 2026-09-03.

## Symptom

Munjal Thakkar added a contact (Brian Linscott) while working a ticket that inbound email had filed under the triage client, the default client in inbound ticket defaults. Later he opened the contact to move it to Life Landscaping. The client picker "would not populate", so he deleted the contact and created it again.

## Root cause

The client page's Contacts tab gives the contact editor a client list containing only the client being viewed.

- `packages/clients/src/components/clients/ClientDetails.tsx:1512-1515` renders `<ClientContactsList clientId={client.client_id} clients={[client]} />`.
- `packages/clients/src/components/contacts/ClientContactsList.tsx` passes that one-element list to both edit routes:
  - Row menu → Edit: `handleEditContact` (`:184-202`) opens `ContactDetailsEdit` with `clients={clients}`.
  - Name click or Quick View: `handleQuickView` (`:107-182`) opens `ContactQuickView` → `ContactBentoLayout`. Its "Edit contact" button (`ContactBentoLayout.tsx:353-368`, `:491`) opens `ContactDetailsEdit` with the same list.
- `ContactDetailsEdit.tsx:406-415` renders `ClientPicker` with that list. For a contact on the triage client, the picker offers one option: the triage client, already selected. Nothing else can be chosen, which is what "the list would not populate" means.

This matches the customer's path. A contact on the triage client is listed under that client's Contacts tab, so that is where he would have opened it. The `[client]` prop dates from f72e3303ba (2025-10-15). It predates the report and was not caused by anything merged after 2026-09-03.

### Ruled out

- **`getAllClients`** (`packages/clients/src/actions/queryActions.ts:244-275`) filters only by tenant and, optionally, `is_inactive`. It never excludes the triage client or any other client. If the permission check fails it throws, and the contact page then shows an error instead of an empty picker (`server/src/app/msp/contacts/[id]/page.tsx:83-86`, `:152-164`).
- **The triage client** is an ordinary `clients` row referenced by `inbound_ticket_defaults.client_id`. There is no system or hidden flag. Inbound email never creates contacts for unknown senders (`shared/services/email/processInboundEmailInApp.ts:1836`, `:1906-1925`, `:2021`). A person adds the contact from the ticket's Quick Add Contact, which preselects the ticket's client.
- **The drawer footer change** (0e65dee1a6, 2026-09-24) came after the 2026-09-03 report.
- **Other surfaces** load the full list and work: the contact page (`/msp/contacts/[id]`), the Contacts list quick view (`Contacts.tsx:223-229`), the command-center and interactions quick view (`useContactQuickViewDrawer.tsx:78-82`), and interaction details (`InteractionDetails.tsx:209`). The ticket's contact drawer has `clientReadOnly` set and offers no client change. `ContactDetails.tsx` is exported but never rendered.
- **`updateContact`** (`contactActions.tsx:806-893`) allows moving a contact to any client in the tenant.

### Second symptom with the same cause

`ContactBentoLayout` looks up the client name in the same list (`:288-291`). If the contact is moved anyway, the quick-view header reads "No client" after the save.

## Fix

The contact editor's client list must contain every client the user can read, whichever page opened it. Drawer content is fixed when the drawer opens (`DrawerContext.openDrawer` stores the element), so the list has to be complete at that moment. A list that fills in later never reaches an open drawer. The fix therefore loads the full list when the drawer opens, not when the page mounts. `useContactQuickViewDrawer` already works this way.

### Changes, in order

1. **Add `useContactEditDrawer`** in `packages/clients/src/components/contacts/bento/useContactEditDrawer.tsx`, a sibling of `useContactQuickViewDrawer.tsx`. Signature: `(contactId, { onSaved?: (contact: IContact) => void }) => Promise<void>`. Steps:
   - `openDrawer(<loading/>)`
   - `Promise.all([getContactByContactNameId(contactId), getAllClients(true)])`
   - On success, `replaceDrawer(<ContactDetailsEdit id="client-contact-edit" initialContact={contact} clients={clients} isInDrawer onSave={(u) => { onSaved?.(u); closeDrawer(); }} onCancel={closeDrawer} />)`.
   - If the contact is missing, show "Contact not found". If a load fails, show the error message in the drawer, as the quick-view hook does.
   - Load the contact fresh rather than editing the row object, so the form never starts from a stale row.
   - Never fall back to `[client]`. The coding standards say to fail fast, and a shortened list is the bug being fixed.
   - Reuse the quick-view hook's loading, not-found and error strings, or add parallel `contacts.editDrawer.*` keys in `server/public/locales/en/msp/clients.json`. If new keys are added, run the repo's locale key checks.
   - Put `// LEVERAGE: pattern contact-drawer-loader — open loading drawer → load contact + getAllClients(true) → replaceDrawer` at both hooks.
2. **Rewrite how `ClientContactsList` opens contacts** (`packages/clients/src/components/contacts/ClientContactsList.tsx`):
   - Quick view: `handleQuickView` / `handleContactClick` call `useContactQuickViewDrawer()(contact.contact_name_id, { onChangesSaved: refreshContacts })`. The hook's own comment (`useContactQuickViewDrawer.tsx:61-62`) already names this component as one that should move onto it.
   - Edit: `handleEditContact` calls `useContactEditDrawer()(contact.contact_name_id, { onSaved: refreshContacts })`. `refreshContacts` re-runs `getContactsByClient(clientId, statusFilter)`, so a contact moved to another client drops out of this list straight away.
   - Delete the state the hook now covers: `documents`, `documentLoading`, `currentUser`/`fetchUser`, `changesSavedInDrawer`, `handleDrawerClose`, and the `useDocumentsCrossFeature` use. Keep any of them that row rendering still needs; grep before deleting. As a side effect this removes a stale closure: `handleDrawerClose` read `changesSavedInDrawer` as of when the drawer opened, so the list never refreshed after a save.
   - Props: replace `clients: IClient[]` with `client: IClient`, the client being viewed. Keep `clientId` or derive it from `client.client_id`. The country-code lookup at `:271` becomes `client.location_country_code`, since every row belongs to this client. That field is declared on `IClientWithLocation` (`packages/types/src/interfaces/client.interfaces.ts:125-129`), not on `IClient`. Type the prop so the field resolves without `as any`, and run the clients package typecheck. The value is unchanged from today's `[client].find(...)` result. `QuickAddContact` (`:427-437`) gets `clients={[client]}`. This is deliberate: adding a contact from a client's Contacts tab creates it under that client. `ClientDetailsTabContent.tsx:328` limits its add-contact dialog the same way, and neither of these is a change-client surface.
3. **Update `ClientDetails.tsx:1512-1515`** to `<ClientContactsList clientId={client.client_id} client={client} />`.
4. **Add `// LEVERAGE: friction client-picker-option-threading`** at `ClientContactsList`, with a note along these lines: "ClientPicker's options are threaded from every caller (about 51 files call getAllClients). A caller that passes a list scoped to its page quietly shrinks the picker, as alga0002338 showed. A ClientPicker that loads its own tenant list would remove this class of bug."

No server action, schema or migration changes.

## Tests

1. **Unit test with jsdom, the main regression test.** File: `packages/clients/src/components/contacts/ClientContactsList.clientOptions.test.tsx`.
   - Mock `getContactsByClient`, `getContactByContactNameId`, `getAllClients` and `getCurrentUserAsync`.
   - Mock `useDrawer` so it captures what `openDrawer` and `replaceDrawer` receive.
   - Render with `client = Triage` and a contact on Triage. `getAllClients(true)` returns `[Triage, Life Landscaping, an inactive client]`.
   - Assert:
     - Row Edit puts `ContactDetailsEdit` in the drawer with all three clients, and `getAllClients` was called with `true`.
     - Opening the quick view goes through `getAllClients(true)`, and the quick-view element receives all three clients.
     - If `getAllClients` rejects, the drawer shows the error and no `ContactDetailsEdit` element is created.
     - After `onSaved`, `getContactsByClient` is called again.
2. **Component test of the edit form with the real `ClientPicker`, starting from the triage client.** File: `packages/clients/src/components/contacts/ContactDetailsEdit.clientChange.test.tsx`.
   - Render `ContactDetailsEdit` with a contact whose `client_id` is Triage and `clients=[Triage, Life Landscaping]`.
   - Open `#contact-edit-client-picker-trigger`.
   - Assert that the option `#contact-edit-client-picker-option-<lifeId>` is listed. Assert that the inactive client is listed too, because the filter is "all".
   - Click it, then Save. Assert that `updateContact` was called with `client_id: lifeId`.
   - Mock the side-loads the form makes on mount: tags, avatar, inbound destinations, countries and phone types.
3. **End-to-end Playwright test.** File: `ee/server/src/__tests__/integration/contact-client-change.playwright.test.ts`. Use the same pattern as `client-default-contact.playwright.test.ts`.
   - Seed a tenant with clients "Unmatched Email" and "Life Landscaping".
   - Add an `inbound_ticket_defaults` row whose `client_id` is the Unmatched Email client.
   - Insert contact "Brian Linscott" on the Unmatched Email client. Inserting it directly gives the same data the ticket's Quick Add Contact would create.
   - Run three cases. Each one changes the client to Life Landscaping, saves, and checks `contacts.client_id` in the database:
     - (a) `/msp/clients/<triage>` → Contacts tab → row menu → Edit.
     - (b) Contacts tab → click the name → quick view → "Edit contact".
     - (c) `/msp/contacts/<id>` → "Edit contact" (`#contact-bento-edit-contact`).
   - Run with `EE_BASE_URL=http://localhost:3164`.

## Manual check on the dev stack

Dev stack: `alga-psa-local-test`, port 3164. In tenant "Oz", the inbound default client is "Wonderland".

1. Add a contact to a Wonderland ticket with Quick Add Contact.
2. Before the fix, confirm the bug: Wonderland → Contacts → Edit should list one client.
3. After the fix, change the contact's client from all three places in test 3 and confirm each one saves.
4. Confirm that the quick-view header shows the new client name after the save.

## Not doing

- **Making `ClientPicker` load its own options.** That is an engine-level change across about 51 callers. It gets a LEVERAGE marker for a later pass instead.
- **Changing `getAllClients`, the contact page, `ContactDetailsView`, or the ticket contact drawer** (`clientReadOnly`). These already work or are read-only on purpose.
- **Changing `allClients` in `ClientDetails`.** It loads active clients only (`getAllClients(false)`, `:780-784`) and feeds the parent-client and merge pickers, which are out of scope.
- **Deleting the unused `ContactDetails.tsx`.**
- **Contacts belonging to more than one client** (the customer's other question). Out of scope per the card.
- **Allowing a contact's client to be cleared.** `updateContact` maps `client_id: ''` to `undefined` (`contactActions.tsx:887`). That is a separate behaviour.
- **Changing `QuickAddContact` on the Contacts tab.** Creating the contact under the viewed client is the intended behaviour there.

## Risks

- **Open speed.** Both Edit and quick view on the Contacts tab now show a brief loading state while the contact and full client list load. This is the same flow the command-center quick view already uses.
- **Fresher data.** The quick view now loads the contact fresh instead of reusing the row object. This is harmless and means the drawer can't show stale data.
- **List refresh.** A contact moved to another client disappears from the current client's Contacts tab when it refreshes after the save. That is correct, but it is new: before, the list refreshed only on close, and that was broken.
- **Tenants with many clients.** `getAllClients(true)` runs each time the drawer opens, logo batch included. Other surfaces already accept this cost.
- **Translations.** If new locale keys are added, every locale needs them, or the default value shows. Run the locale checks.
