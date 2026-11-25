# Alga PSA Permission Reference

Which permissions each screen and task in Alga PSA checks, and what the user sees without them. Use it to answer "my tech has the permission but still can't do X" questions, and update it when a change adds a permission check or moves one.

It covers PSA tenants. AlgaDesk and co-managed tenants start with different roles and fewer screens. For how permissions are stored, provisioned and checked, and the full default grants per product, see [Permissions System](permissions-system.md).

The customer-facing summary is in the website docs: [Configure Roles, Permissions (RBAC), and API Keys](https://www.nineminds.com/documentation/security-settings).

## How permissions work

A user can do something in Alga PSA only when one of their roles grants the matching permission. Each permission pairs a resource with an action, such as Ticket and Update. This reference writes that pair as `ticket:update`.

**Where you manage them.** Go to **Settings > Security**.

- **Roles** creates and renames roles.
- **Permissions** shows one row per resource. Tick Create, Read, Update or Delete for the selected role. Other actions, such as Approve or Finalize, sit in the **Special Actions** column.
- **User Roles** assigns roles to people.

**Rules that explain most surprises.**

- **Permissions add up.** A user with two roles gets everything either role grants. There is no way to subtract.
- **Admin is fixed.** The Admin role holds every MSP permission. The Permissions tab does not let anyone edit it.
- **MSP and Client Portal are separate.** The Permissions tab has an MSP view and a Client Portal view. A permission ticked in one view does nothing for users of the other portal.
- **A resource name is not always a screen name.** Quotes, contracts and contract lines all run on the `billing` resource. Each section below names the resource a screen really checks.
- **Most screens need more than one resource.** A screen that shows a client picker needs `client:read`. A screen that shows a contact picker needs `contact:read`. The tables call these out.
- **Seeing a menu entry does not mean you have access.** Most sidebar entries are shown to every user. The permission check happens when the screen loads its data.
- **Changes apply right away.** Alga PSA reads a user's permissions on every request, so a change takes effect on the user's next click. Menu entries that depend on a permission appear after the user reloads the page.

**How to read the tables.** Each row is one task. A user needs every permission listed in the row. "or" means either one is enough.

## Quick answers

These are the most common cases where a user holds the obvious permission and still cannot do the task.

| The user cannot... | Add this to their role |
| --- | --- |
| Create or edit quotes | `billing:read`, `billing:create`, `billing:update`. The Quotes permission only approves. |
| Create, edit, move or assign project tasks | `project:update`. The Project Task permissions cover only comments and tags. |
| Pick a user in an assignee or manager picker (the list is empty) | `user:read` |
| Pick a team (the list is empty) | `user_settings:read` |
| Pick a client | `client:read` |
| Open a client | `contact:read` as well as `client:read` |
| Log time on a ticket or project task ("Failed to initialize time entries") | `client:read` |
| Delete their own time entry | `time_entry:delete` |
| Open Time Management > Approvals | Make them manager of a team, and add `time_sheet:approve` and `user_settings:read` |
| See technicians on the dispatch board | `user:read` |
| Drag tickets onto other technicians | `user_schedule:update` as well as `technician_dispatch:update` |
| Open contracts or Billing Cycles | `client:read` as well as `billing:read` |
| Activate, terminate or change a contract's client assignment | `client:update` |
| Finalize an invoice | `invoice:update`. The Invoice Finalize permission applies only to the REST API. |
| Email an invoice | `billing:create`. The Invoice Send permission applies only to the REST API. |
| Apply credit to an invoice | `credit:update` |
| Void an invoice with QuickBooks Online connected | `accounting_integrations:remote_mutate` |
| Use Service Periods | `billing.recurring_service_periods:view` |
| Pick materials from stock on a ticket or project | `inventory:read` |
| Save email settings | `ticket_settings:update` |
| Reset another user's password, or manage API keys and webhooks | The role named Admin |
| Manage client portal users from the portal | The portal role named Admin |

## Default roles at a glance

A PSA tenant starts with five MSP roles: Admin, Technician, Dispatcher, Project Manager and Finance. Admin holds every MSP permission. The full grants for each role are in [Default grants](permissions-system.md#default-grants), generated from `catalog.cjs`. A tenant's admin can change any role except Admin, so check the tenant's **Settings > Security > Permissions** for its current state.

Three defaults catch people out:

- **Technician has no billing access at all.** That includes quotes.
- **Technician cannot see the user list.** The role has no `user:read`.
- **Only Admin can edit the service catalog, approve quotes, use inventory and opportunities, or change settings.** Grant those to another role yourself if you need them.

## Tickets

Opening and working a ticket needs only the `ticket` permissions. The pickers around it do not: assigning a user needs `user:read`, picking a team needs `user_settings:read`, and picking a client needs `client:read`. The default Technician role has `client:read` but neither of the other two.

**Ticket list**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See the ticket list | `ticket:read` | The whole page shows an error |
| Filter by client or location | `client:read` | The filter is empty |
| Filter by contact | `contact:read` | The filter is empty |
| Filter by team | `user_settings:read` | No teams are listed |
| Save a view as the board or tenant default | `ticket_settings:update` | The option is hidden |
| Bulk move, assign, change status, priority or due date | `ticket:update` | The change is refused |
| Bulk assign: pick the user | `user:read` | The picker is empty |
| Bulk add tags | `ticket:update` and `tag:create`, even for existing tags | The whole action is refused |
| Bulk delete | `ticket:delete` | Each ticket fails |
| Export to CSV | `ticket:read` | The export is refused |
| Import from CSV | `ticket:create`. New clients, contacts or priorities in the file also need `client:create`, `contact:create` or `priority:create`. New statuses or categories need `ticket_settings:update`. | The whole import is refused |

**Creating a ticket**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Create a ticket | `ticket:create` | The save is refused |
| Pick the client | `client:read` | The picker is empty, so no client can be chosen |
| Pick the contact | `contact:read` | The picker is empty |
| Pick the assigned user | `user:read` | The picker is empty |
| Pick a team | `user_settings:read` | The picker is empty |
| Start from a template | `ticket_template:read` | No template picker |
| Attach files | `document:create` | The ticket is created without the files |
| Link assets | `asset:update` | The save is refused |

**Ticket detail**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open a ticket | `ticket:read` | The whole page shows an error |
| Edit fields, status, assignee, board, priority or category | `ticket:update` | The save is refused |
| Change the client | `client:read` and `contact:read` | The picker is empty |
| Pick a team | `user_settings:read` | No teams are listed |
| Add or remove watchers and additional agents | `ticket:update` | The change is refused |
| Add a comment or internal note | `ticket:update` | The comment is refused |
| Email a comment to contacts or staff | `contact:read` for contacts, `user:read` for staff | That part of the recipient list is empty |
| Insert a canned response | `canned_response:read` | Not available |
| Close a ticket | `ticket:update` | The change is refused |
| Close a ticket that fails its close rules | `ticket:close_override` | The change is refused |
| See time entries | `time_entry:read` | The section is empty |
| Log time | `time_entry:create` and `client:read` | See [Time entry](#time-entry-approvals-schedule-and-dispatch) |
| See documents | `document:read` | The section is empty |
| Upload a document | `document:create` | The upload is refused |
| See linked assets | `asset:read` | The section is empty |
| Link an asset | `asset:update` | The change is refused |
| Unlink an asset | `asset:delete` | The change is refused |
| Add or remove materials | `ticket:update` | The change is refused |
| Pick a product or service for materials | `service:read` and `inventory:read` | The picker is empty |
| See linked project tasks | `project:read` | The badge is empty |
| Add a new tag | `ticket:update` and `tag:create` | The tag is refused |
| Duplicate a ticket | `ticket:create` | The action is refused |
| Save as a ticket template | `ticket_template:create` | The action is refused |
| Delete a ticket | `ticket:delete` | The delete is refused |

**Other ticket screens**

| Screen | To view | To change | Also needed |
| --- | --- | --- | --- |
| Recurring Tickets | `recurring_ticket:read` | `recurring_ticket:create`, `update`, `delete` | `ticket_template:read` to pick a template; `client:read`, `user:read`, `user_settings:read` for the pickers |
| Ticket Templates | `ticket_template:read` | `ticket_template:create`, `update`, `delete` | `client:read`, `user:read`, `user_settings:read` for the pickers |
| Canned Responses | `canned_response:read` | `canned_response:create`, `update`, `delete` | `user_settings:read` to scope a response to a team |
| Service Requests | `service:read` | `service:create`, `update`, `delete` | `client:read`, `contact:read` and `contact:update` for the audience editor |

The Recurring Tickets, Ticket Templates and Canned Responses menu entries are hidden from users who lack the matching read permission.

Three defaults catch people out:

- **The default Technician cannot assign tickets to other users from Quick Add or bulk assign.** The role has no `user:read`. The assignee dropdown on an open ticket still works.
- **Only Admin can pick materials from stock or unlink assets by default.** Those need `inventory:read` and `asset:delete`.
- **Service Requests run on the service catalog permissions.** Only Admin can create or edit them by default.

## Clients, contacts, interactions and opportunities

Opening a client needs both `client:read` and `contact:read`. A client's billing settings, contracts and tax assignment are saved with `client:update`, not with the `billing` permissions.

**Clients list**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See the clients list | `client:read` | The list is empty, with no error |
| See open ticket counts | `ticket:read` | The counts are missing |
| Add a client | `client:create` | The save is refused |
| Add a location while creating a client | `client:update` | The client is saved without the location |
| Add a contact while creating a client | `contact:create` | The client is saved without the contact |
| Pick an account manager | `user:read` | The picker is empty |
| Tag a client | `client:update`. A new tag also needs `tag:create`. | The tag is refused |
| Import clients from CSV | `client:read` and `client:create`. Updating existing clients also needs `client:update`. | Every row fails |
| Export clients | `client:read` | The export is refused |
| Deactivate or reactivate a client | `client:update`. Including its contacts also needs `contact:update`. | The action is refused |
| Delete a client | `client:delete` | The delete is refused |

**Client detail**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open a client | `client:read` and `contact:read` | The whole page shows an error |
| Edit details, status, logo, locations, notes and email domains | `client:update` | The save is refused |
| Merge two clients | `client:update` and `client:delete` | The merge is refused |
| Pick an SLA policy | `sla_policy:read` | The list is empty |
| Tickets tab | `ticket:read` | The tab stays on "Loading ticket filters" |
| Assets and Software tabs | `asset:read` | The tab shows an error |
| Equipment tab | `inventory:read` | The tab is hidden |
| Opportunities tab | `opportunities:read` | The tab shows an error |
| Contacts tab: add a contact | `contact:create` | The save is refused |
| Documents tab | `document:read` | The list is empty |
| Interactions tab | `interaction:read` | "Could not be loaded" |
| See the billing fields | `billing:read` | The billing fields are hidden |
| Save billing settings, billing profiles, contracts, contract lines and tax rate | `client:update`. Assigning a contract needs `client:create`. | The save is refused |
| Turn autopay on or off | `billing:update` | The change is refused |
| Change zero-dollar, credit and default time entry service settings | `billing_settings:update` | The change is refused |
| Change prepaid balance alerts | `billing_settings:update` | The change is refused |

**Contacts**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open the contacts list | `contact:read` | The whole page shows an error |
| Add a contact | `contact:create`. The client picker needs `client:read`. | The save is refused |
| Edit a contact, notes or avatar | `contact:update` | The save is refused |
| Deactivate a contact | `contact:update` | The action is refused |
| Delete a contact | `contact:delete` | The delete is refused |
| Import contacts | `contact:read`, `client:read` and `contact:create` | The import is refused |
| See the client portal section on a contact | `client:read` | The section is hidden |
| See the contact's portal user and invitation history | `user:read` | They do not show |
| See or change the contact's visibility groups | `contact:update` | Errors when the portal dialog opens |
| Send, resend or revoke a portal invitation | `user:invite` | The button is disabled |
| Invite several contacts at once from the client's contacts list (selection column, **Invite to portal (N)**, **Invite all eligible**) | `user:invite` | The selection column and buttons are hidden |
| Make a portal user an admin, or activate or deactivate them | `user:update` | The change is refused |
| Assign a portal role | `user:update` or `client:update` | The change is refused |

**Interactions**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open the Interactions page | `contact:read` | The whole page shows an error |
| See interactions | `interaction:read` | The list shows an error |
| Log an interaction | `interaction:create` and `interaction:read`. The pickers need `user:read`, `contact:read` and `client:read`. | The dialog fails to load |
| Schedule the interaction for someone else | `user_schedule:update` | The change is refused |
| Edit or delete an interaction | `interaction:update` or `interaction:delete` | The change is refused |
| Manage interaction types | `settings:update` | The change is refused |

**Opportunities**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See opportunities | `opportunities:read` | The page is empty, with no error |
| Create an opportunity | `opportunities:create` and `client:read` | The save is refused |
| Edit, move stage, add steps, link quotes, mark lost | `opportunities:update` | The change is refused |
| Mark won and create a project from a template | `opportunities:update`, `project:read` and `project:create` | The project is not created |
| Delete an opportunity | `opportunities:delete` | The delete is refused |

Three defaults catch people out:

- **Only Admin has the `opportunities` permissions by default.** Every other role sees an error on a client's Opportunities tab.
- **Technician can delete clients and contacts but cannot deactivate them.** The role holds the delete permissions but not `client:update` or `contact:update`.
- **Logging an interaction needs `interaction:read` as well as `interaction:create`.** The dialog loads interaction types and statuses before you can save.

## Billing: contracts

Contracts, contract templates, contract line presets, billing cycles, usage and contract reports all run on the `billing` resource. Several contract actions check client permissions instead.

**Getting into Billing.** The Billing page opens for anyone with `service:read` or `billing:read`. Every contract tab also needs `billing:read`, so a user with only `service:read` sees the tabs but each one shows an error.

**Client Contracts**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See the contracts list and upcoming renewals | `billing:read` | The tab shows an error |
| Open a contract | `billing:read` and `client:read` | The contract shows an error |
| Create a contract with the wizard | `billing:create` and `billing:update` | The save is refused |
| Create a contract with the quick-add dialog | `billing:create`, plus `client:create` to assign it to the client | Without `client:create`, the contract is saved but not assigned to the client |
| Pick a client | `client:read` | The client list does not load |
| Edit contract details | `billing:update` | The save is refused |
| Edit the client assignment: dates, PO number, renewal settings, billing profile | `client:update` | The save is refused |
| Set to Active, Terminate or Restore | `client:update` | The action is refused |
| Mark a renewal as renewing or non-renewing | `billing:update` | The action is refused |
| Delete a contract | `billing:delete` | The delete is refused |

**Contract lines, pricing and discounts** (inside a contract)

| Task | Permissions required | Without it |
| --- | --- | --- |
| See lines, pricing schedules and discounts | `billing:read` | The tab shows an error |
| Add a line from a preset or a custom line | `billing:create` | The add is refused |
| Edit a line, buckets, prepaid blocks or rates | `billing:update` | The save is refused |
| Remove a line, or remove services from it | `billing:delete` | The change is refused |
| Pick a client location on a line | `client:read` | The picker is empty |
| Pick a unit of measure | `service:read` | The unit list does not load |
| Add a custom unit of measure | `service:create` | The new unit is refused |
| See product cost | `service:update` | The cost is hidden |
| Preview the invoice impact of a unit price change | `billing:update`, plus `invoice:create` or `invoice:generate` | The preview shows an error |
| See contract documents | `billing:read` and `document:read` | The list is empty |
| Upload a contract document | `document:create` | The upload is refused |
| See the contract's invoices | `billing:read` | The tab shows an error |

**Other contract tabs**

| Tab | To view | To change |
| --- | --- | --- |
| Contract Templates | `billing:read` | `billing:create` and `billing:update` to create; `billing:update` to edit; `billing:delete` to delete |
| Contract Line Presets | `billing:read` | `billing:create`, `billing:update`, `billing:delete` |
| Billing Cycles | `billing:read` and `client:read` | Cycles are changed on the client's Billing tab |
| Usage Tracking | `billing:read`. The client filter needs `client:read`. | `billing:create`, `billing:update`, `billing:delete` |
| Reports (revenue, expiration, bucket hours, profitability) | `billing:read` | - |
| Service Periods | `billing.recurring_service_periods:view` | `billing.recurring_service_periods:regenerate` to preview or repair periods |
| Accounting Exports | `accounting_integrations:exports_execute`. The tab is hidden without it. | Mapping unmapped QuickBooks items also needs `accounting_integrations:mappings_manage` |

Two defaults catch people out:

- **Only Admin can use Service Periods by default.** Grant Finance the `billing.recurring_service_periods` permissions if they manage service periods.
- **Billing staff need client permissions too.** A role with `billing` permissions but no `client:read` cannot open contracts or the Billing Cycles tab. Without `client:update`, it cannot activate, terminate or change a contract's assignment.

## Billing: invoicing and credits

Invoicing uses a mix of the `invoice`, `billing` and `credit` permissions. Several `invoice` permissions are not what the Billing screens check. The table names the permission each task actually needs.

**Invoicing**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See invoices ready to generate, drafts and finalized invoices | `billing:read` | The tab shows an error |
| Preview or generate invoices | `invoice:create` or `invoice:generate` | The action is refused |
| Create a manual invoice | `billing:create`. The client picker needs `client:read`. | "Billing create required" |
| Create a prepayment invoice | `credit:create` | The action is refused |
| Invoice a sales order | `sales_order:update` and `billing:create` | The action is refused |
| Edit a draft or its line items | `invoice:update` | The change is refused |
| Finalize an invoice | `billing:read` and `invoice:update` | The action is refused |
| Unfinalize an invoice | `invoice:update` | The action is refused |
| Delete a draft | `invoice:delete` | The delete is refused |
| Download a single invoice PDF | `invoice:read` | The download is refused |
| Download several PDFs as a zip | `billing:read` | The download is refused |
| Email an invoice | `billing:create` | "Billing create required" |
| Record a payment | `invoice:payment` | The action is refused |
| Apply credit to an invoice | `credit:read` and `credit:update` | The action is refused |
| Void an invoice | `invoice:void`. If QuickBooks Online is connected, also `accounting_integrations:remote_mutate`. | The void is refused |
| Reverse a recurring invoice | `billing:delete` | The action is refused |
| Approve and invoice project billing | `invoice:create` or `invoice:generate` | The action is refused |

**Invoice Layouts**

| Task | Permissions required |
| --- | --- |
| See layouts and preview them | `billing:read` |
| Create, copy, edit a layout or set the default | `billing:update` |
| Delete a layout | `billing:delete` |
| Pick an image for a layout | `document:read` |

**Credits**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See credits | `credit:read` | The table shows an error |
| Add a credit | `credit:create` | The add is refused |
| Change an expiration date or expire a credit | `credit:update` | The change is refused |
| Transfer a credit to another client | `credit:transfer` and `client:read` | The transfer is refused |

**Billing settings** (Settings > Billing)

| Task | Permissions required |
| --- | --- |
| See the General tab: currency, payment terms, zero-dollar invoices, credit, renewal and quote defaults | `billing_settings:read` |
| Change those settings | `billing_settings:update` |
| See cost rates | `billing:read` |
| Change cost rates | `billing:update` |

Four things to know:

- **Some `invoice` permissions have no effect on the Billing screens.** `invoice:finalize`, `invoice:send` and `invoice:credit` apply only to the REST API. Finalizing on screen needs `invoice:update`, emailing needs `billing:create`, and applying credit needs `credit:update`.
- **The `financial` permissions do nothing on screen.** They apply only to the REST API.
- **Finance cannot void an invoice when QuickBooks Online is connected.** Voiding then also needs `accounting_integrations:remote_mutate`, which only Admin has by default.
- **Billing staff need `client:read`.** Creating a manual invoice or transferring a credit uses the client picker.

## Quotes

Quotes run on the `billing` resource. The Quotes row in the Permissions tab holds only Approve, and that permission does not let anyone create or edit a quote.

To let a technician create and edit quotes, add `billing:read`, `billing:create` and `billing:update` to their role. The default Technician role already has the client, contact and service permissions the quote form needs.

The `billing` permissions are shared. Granting them also opens contracts, contract lines and the other billing tabs to that role.

**Billing > Quotes**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open the Billing area | `service:read` or `billing:read` | The Billing page shows only an error |
| See the quotes list, open a quote, preview it, download the PDF | `billing:read` | The list shows a permission error |
| Open the quote form (new or edit) | `billing:read` and `contact:read` | The form fails to load |
| Pick a client and its locations | `client:read` | The client list does not load |
| Pick a unit of measure from your custom units | `service:read` | Only the built-in units are listed |
| Save a new custom unit of measure | `service:create` | The new unit is refused |
| Save a new quote, duplicate a quote, create from a template, save as template | `billing:create` | "Cannot create quotes" |
| Save changes, add, edit, remove or reorder lines | `billing:update` | "Cannot update quotes" |
| Submit for approval, send, resend, send a reminder, mark as accepted, create a revision | `billing:update` | "Cannot update quotes" |
| Approve a quote or request changes | `quotes:approve` | "Cannot approve quotes" |
| Convert to a contract, invoice or sales order | `billing:create` and `billing:update` | The conversion is refused |
| Delete a quote | `billing:delete` | "Cannot delete quotes" |
| Turn quote approval on or off | `billing:update` | The setting is not saved |

**Billing > Quote Layouts** and **Quote Templates**

| Task | Permissions required |
| --- | --- |
| See layouts and templates | `billing:read` |
| Edit a layout or set the default layout | `billing:update` |
| Create a quote template | `billing:create` |
| Delete a layout or template | `billing:delete` |

Three things to know:

- **You cannot approve your own quote.** The exception is when you are the only person in the tenant who holds `quotes:approve`.
- **The default currency and validity period come from billing settings.** A user without `billing_settings:read` can still create quotes. Their new quotes start from the client's currency, or USD, and a 30-day validity period.
- **Access rules can narrow which quotes a user may open or change.** If your tenant uses authorization bundles that limit a role to certain clients or to its own records, a user with `billing:update` can still be refused on a specific quote.

## Service catalog, products and tax

Services, products and service types use the `service` permissions. Service categories and tax use the `billing` permissions. Editing the catalog also needs `billing:read`.

| Task | Permissions required | Without it |
| --- | --- | --- |
| See services and products | `service:read` or `billing:read` | The tab shows an error |
| See service categories and tax rates in the service form | `billing:read` | An error banner shows on the tab |
| Create a service or product | `service:create` | The save is refused |
| Edit a service or product, or change its prices | `service:update` | The save is refused |
| Change a service's rate | `service:update` and `billing:read` | "Failed to update service" |
| See a service's cost | `service:update` | The cost is blank |
| Archive or delete a service or product | `service:delete` (archiving a product needs `service:update`) | The action is refused |
| Create, rename or delete service types | `service:create`, `service:update` or `service:delete` | The change is refused |
| See service categories | `billing:read` | The tab shows an error |
| Create, edit or delete service categories | `billing:create`, `billing:update` or `billing:delete` | The change is refused |
| Add a custom unit of measure | `service:create` | The new unit is refused |
| New prices default to the tenant currency | `billing_settings:read` | Prices default to USD |
| See tax rates | `billing:read` | The section shows an error |
| Add, edit or delete tax rates, regions, components and thresholds | `billing:create`, `billing:update` or `billing:delete` | The buttons are disabled |
| Change the tax source or the default tax rate | `billing:update` | The change is refused |
| Apply a tax rate to the catalog in bulk | `billing:update` and `service:update` | The change is refused |

Two things to know:

- **Only Admin can change the service catalog by default.** Every other role has `service:read` at most.
- **The Tax permission does nothing on screen.** Tax screens use the `billing` permissions instead.

## Projects

Work on project tasks is controlled by the `project` permissions, not `project_task`. Creating, editing, moving or assigning a task needs `project:update`. Deleting a task needs `project:delete`. The `project_task` permissions control only task comments and tags on a single task.

This matters for the default Technician role. They hold `project_task:create` and `project_task:update` but not `project:update`, so they can open projects and comment on tasks, but cannot create or change tasks. The task screens still show the edit controls, and each one fails with a permission error when used.

**Projects list**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See the projects list | `project:read` | The list is empty, with no error |
| Filter by contact or project manager | `contact:read` and `user:read` | Both filter lists are empty if either is missing |
| Create a project | `project:create` and `project:read` | The save is refused |
| Pick the client when creating a project | `client:read` | The picker is empty, so you cannot create the project |
| Pick the contact | `contact:read` | The picker is empty |
| Pick the project manager | `user:read` | The picker is empty, with no error |
| Pick a default service | `service:read` or `billing:read` | The picker is empty |
| Delete a project | `project:delete` | The delete is refused |

**Project detail**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open a project, including the board, list and timeline views | `project:read` | The page stays on "Loading" |
| See names in assignee and manager pickers | `user:read` | Every user picker is empty, with no error |
| See teams and pick a team | `user_settings:read` | Teams are missing |
| Edit project details, status, manager or dates | `project:update` | The save is refused |
| Add, edit, reorder, complete or reopen phases | `project:update` | The change is refused |
| Delete a phase | `project:delete` | The delete is refused |
| Drag dates and dependencies on the timeline | `project:update` | The timeline is read-only |
| Change the project's task status columns | `project:update` | The change is refused |
| Import phases and tasks | `project:update` | The import is refused |
| Export tasks to CSV | `project:read` | The export is refused |
| Send a project status update email | `project:update` | The send is refused |
| See the project Billing tab | `billing:read` | The tab is hidden |
| Configure project billing | `invoice:create` or `invoice:generate` | The change is refused |
| Add or edit materials | `project:update` | The change is refused |
| Pick materials from stock | `inventory:read` | The picker is empty |

**Tasks**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open a task and see its checklist, dependencies and linked tickets | `project:read` | The task does not open |
| Create a task | `project:update` | The save is refused |
| Edit a task, drag it to another status, reorder or move it | `project:update` | The change is refused |
| Assign users or a team | `project:update`. The pickers also need `user:read` and `user_settings:read`. | The change is refused, or the picker is empty |
| Add or tick checklist items | `project:update` | The change is refused |
| Delete a checklist item | `project:delete` | The delete is refused |
| Add or remove dependencies | `project:update` | The change is refused |
| Link or unlink a ticket | `project:update`. Searching tickets needs `ticket:read`. | The change is refused |
| Duplicate a task | `project:create` | The duplicate is refused |
| Delete a task | `project:delete` | The delete is refused |
| Read task comments | `project_task:read` | Comments do not load |
| Add a comment | `project_task:create` | The comment is refused |
| Edit a comment | `project_task:update` | The edit is refused |
| Delete a comment, including your own | `project_task:delete` | The delete is refused |
| Tag a single task | `project_task:update`. A new tag also needs `tag:create`. | The tags are read-only |
| Tag several tasks at once | `project:update` | Every row fails |
| See task documents | `document:read` | Documents do not load |
| Attach a document to a task | `document:update` | The attach is refused |
| Log time on a task | `time_entry:create` and `client:read` | See [Time entry](#time-entry-approvals-schedule-and-dispatch) |

**Project templates**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See and open templates | `project:read` | The list is empty, or the template shows "Template not found" |
| Create a template, or save a project as a template | `project:create` | The save is refused |
| Edit a template | `project:update` | The change is refused |
| Delete a template | `project:delete` | The delete is refused |
| Create a project from a template | `project:create` and `client:read` | The create is refused |

To let technicians work on project tasks, add `project:update` to their role. That also lets them edit the project itself, as nothing narrower exists today. Add `user:read` too, or every assignee picker stays empty.

## Time entry, approvals, schedule and dispatch

Time tracking uses `time_entry` and `time_sheet`. Approval depends on both a permission and who the user manages. The schedule and the dispatch board both store their entries under `user_schedule`.

**Time Entry**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See your time periods and create your timesheet | None | - |
| Open a timesheet | `time_sheet:read` and `time_entry:read` | The timesheet page shows an error |
| Log time against a ticket or project task | `time_entry:create` and `client:read` | Without `client:read`, the entry form fails with "Failed to initialize time entries" |
| Pick a ticket as the work item | `ticket:read` | No tickets are listed |
| Filter work items by assigned user | `user:read` | The filter list is empty |
| Edit a time entry | `time_entry:update` | The save is refused |
| Delete a time entry or remove a work item row | `time_entry:delete` | The delete is refused |
| Submit a timesheet | `time_sheet:submit` | The submit is refused |
| Reopen an approved timesheet | `time_sheet:reverse` | The button is hidden |

**Viewing and approving other people's time**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open **Time Management > Approvals** | Be the manager of at least one team, and hold `user_settings:read` | "Team lead access required" |
| See and approve the timesheets of people you manage | `time_sheet:approve` | The list is empty |
| See and approve everyone's timesheets | `time_sheet:approve` and `time_sheet:read_all` | You see only the people you manage |
| Request changes | `time_sheet:approve` | The action is refused |
| Reverse an approval | `time_sheet:reverse` | The action is refused |

"People you manage" means members of a team where you are the manager, plus anyone whose **Reports to** field names you.

**Time periods** (Settings > Time Entry)

| Task | Permissions required |
| --- | --- |
| View periods and settings | `time_period:read` |
| Create or generate periods | `time_period:create` |
| Edit a period | `time_period:update` |
| Delete a period | `time_period:delete`. A team manager can also bulk delete periods from the Time Entry page. |
| Change the period cadence | `time_period:manage` |

**Schedule**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See your own calendar | `user_schedule:read` | The calendar is empty |
| Create, edit or delete your own entries | `user_schedule:read` | The change is refused |
| See everyone's calendar | `user_schedule:update` | You see only calendars shared with you |
| Create, edit or delete entries for someone else | `user_schedule:update`, or an Edit share on that person's calendar | "Permission denied to assign schedule entries to other users" |
| Link a ticket to an entry | `ticket:read` | No tickets are listed |

**Technician Dispatch**

| Task | Permissions required | Without it |
| --- | --- | --- |
| Open the board | `technician_dispatch:read` | Access denied |
| See technician rows | `user:read` | The board has no rows |
| See unscheduled tickets | `ticket:read` | The list is empty |
| Switch the board to edit mode | `technician_dispatch:update` | The board is view-only |
| Drag a ticket onto another technician, or move their entries | `user_schedule:update` | "Permission denied" |

Five defaults catch people out:

- **Technicians cannot delete their own time entries.** Only Admin and Finance have `time_entry:delete` by default.
- **`time_sheet:approve` alone does not open the Approvals page.** The user must also manage a team and hold `user_settings:read`.
- **`time_sheet:read_all` does nothing on its own.** It widens what an approver can see, so it needs `time_sheet:approve` too.
- **The default Technician sees an empty dispatch board.** The role has `technician_dispatch:read` but no `user:read`.
- **Dispatching needs two permissions.** Grant `technician_dispatch:update` together with `user_schedule:update`, or drops onto other technicians fail.

**User Activities** shows your own activity to everyone. Viewing another user's activities needs `user_schedule:update`.

## Assets, passwords, documents and knowledge base

Asset permissions also control documents and tickets linked to assets. A user without `asset:read` cannot see any document linked to an asset, on any screen.

**Assets**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See the asset list or open an asset | `asset:read` | The page shows an error |
| Create an asset | `asset:create`. The client picker needs `client:read`. | The save is refused |
| Edit an asset, bulk update, manage asset groups and related assets | `asset:update` | The change is refused |
| Delete an asset | `asset:delete` | The delete is refused |
| See tickets linked to an asset | `ticket:read` | The section is empty |
| See an asset's documents | `asset:read` and `document:read` | "Documents unavailable" |
| Upload a document to an asset | `asset:update` and `document:create` | The upload is refused |
| Remove a document from an asset | `asset:update`, `asset:delete` and `document:update` | The change is refused |
| Add or edit asset notes | `asset:update` and `document:update` | The save is refused |
| Create or edit maintenance schedules | `asset:update` | The change is refused |
| Delete a maintenance schedule | `asset:delete` | The delete is refused |
| Complete, skip or pause maintenance | `asset:update` | The change is refused |
| Move custody, hand off, ship or return equipment | `asset:update` | The change is refused |
| Pick the person for a custody hand-off | `user:read` | The picker is empty |
| Run site audits | `asset:read` to view, `asset:update` to run | The action is refused |
| Open a warranty claim | `asset:update`, and `warranty:create` or `inventory:create` | The button is hidden |
| Refresh RMM data, reboot or run a script | `asset:update`. Datto RMM devices also need `rmm:execute_command`. | The action is refused |
| Print labels | `asset:read` | The action is refused |
| Link an asset to a ticket | `asset:update` | The change is refused |
| Unlink an asset from a ticket | `asset:delete` | The change is refused |

**Passwords**

| Task | Permissions required |
| --- | --- |
| See passwords | `credential:read` |
| Reveal a password or one-time code | `credential:reveal` |
| Create a password entry | `credential:create`. The client picker needs `client:read`. |
| Edit, restrict, or attach to an asset, ticket or contact | `credential:update`. The restrict dialog needs `user:read` and `user_settings:read`. |
| Delete | `credential:delete` |
| See the audit log | `credential:read` and `credential:audit` |

A restricted password is visible only to its owner and the users and teams it is assigned to.

**Documents**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See documents and folders | `document:read` | The page shows an error |
| Filter by user | `user:read` | The filter is empty |
| Upload a document or create a folder | `document:create` | The upload is refused |
| Edit, move, replace or change visibility | `document:update` | The change is refused |
| Create or revoke a share link | `document:update` | The action is refused |
| Delete a folder | `document:delete` | The delete is refused |
| See documents linked to an asset | `asset:read` | Those documents are hidden |
| See a contract's documents | `document:read` and `billing:read` | The list is empty |
| Attach a document to a ticket | `document:create` | The upload is refused |

**Knowledge base**

| Task | Permissions required |
| --- | --- |
| Read articles | `document:read` |
| Create an article, or create one from a ticket | `document:create` |
| Edit, publish, archive or review an article | `document:update` |
| Delete an article | `document:delete` |

Two things to know:

- **Only Admin can unlink assets from tickets or delete maintenance schedules by default.** Both need `asset:delete`.
- **Datto RMM commands need `rmm:execute_command`.** Only Admin has it by default.

## Inventory, purchasing and sales orders

Inventory has its own resource for each area. Only Admin holds any of them by default.

| Area | To view | To change | Also needed |
| --- | --- | --- | --- |
| Dashboard, reports, stock, units, loaners, kits list | `inventory:read` | `inventory:create` to receive stock, `inventory:update` to adjust or retire | - |
| Stock locations | `stock_location:read` | `stock_location:create`, `update` | Location dropdowns across inventory need `stock_location:read` |
| Transfers | `stock_transfer:read` | `stock_transfer:create` to dispatch, `update` to receive or cancel | - |
| Cycle counts | `cycle_count:read` | `cycle_count:create`, `update`; `approve` to approve | - |
| Vendors and vendor price lists | `vendor:read` | `vendor:create`, `update` | - |
| Purchase orders | `purchase_order:read` | `purchase_order:create`, `update` (also used to receive), `delete` | The create dialog needs `vendor:read`, `inventory:read` and `stock_location:read` |
| Vendor bills | `vendor_bill:read` | `vendor_bill:create`, `update` | `vendor:read` and `purchase_order:read` for the pickers; `billing:read` to see export status |
| Sales orders | `sales_order:read` | `sales_order:create`, `update`, `delete` | `client:read` for the client picker; `service:read` or `billing:read` for products |
| Invoice a sales order | - | `sales_order:update` and `billing:create` | - |
| Drop-ship or turn a backorder into a purchase order | - | `sales_order:update` and `purchase_order:create` | - |
| Kits | `inventory:read` | `inventory:create` and `service:create` to create; `inventory:update` and `service:update` to edit | - |
| Returns (RMA) | `inventory:read` or `warranty:read` | `inventory:create`, `inventory:update` | - |
| Restocking fee invoice | - | `billing:create` | Without it, the item is restocked but the fee is not billed |
| Document Layouts (sales order, packing slip, pick list) | `billing:read` | `billing:update`, `billing:delete` | `sales_order:read` to preview with a real record |

## Other areas

| Screen | Permissions required |
| --- | --- |
| Home dashboard | None |
| User Activities: your own activity | None. Creating an ad-hoc activity needs `user_schedule:read`. |
| User Activities: another user's activity | `user_schedule:update` |
| Reports | `reports:read` |
| Surveys dashboard | None |
| Workflows: view | `workflow:read` |
| Workflows: edit, publish, administer | `workflow:manage`, `workflow:publish`, `workflow:admin` |
| Job Monitoring: view | None |
| Job Monitoring: clear history | `job:delete` |
| Email Logs | None |
| Extensions | `extension:read` to view, `extension:write` to install or change |
| Marketing | `marketing:read` to view, `marketing:manage` to change |

## Settings and administration

Every user sees every settings tab. Each tab checks permissions only when it loads or saves data. Six resources sound alike but control different tabs:

| Resource | What it controls |
| --- | --- |
| `settings` | Notifications and email templates, email branding, sender addresses, ticket numbering, client portal logo, domain and features, SSO login policy, interaction types, experimental features |
| `system_settings` | Most integrations (RMM, Entra, Microsoft and Google, Teams, Hudu), SSO identity providers and login domains, Policies, asset types and statuses |
| `security_settings` | Creating, renaming and deleting roles, the Permissions matrix, viewing and ending other users' sessions, user provisioning |
| `user_settings` | Teams |
| `ticket_settings` | Boards and board statuses, ticket display settings, checklist templates, outbound email settings and email providers |
| `billing_settings` | Settings > Billing |

**Users**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See the Users tab | `user:read` | The tab shows an error |
| Invite a user | `user:invite` | The invite is refused |
| Create a user with a password | `user:create` | The save is refused |
| Edit a user, deactivate or reactivate them | `user:update` | The save is refused |
| Assign or remove roles | `user:update` | The change is refused |
| Delete a user | `user:delete` | The delete is refused |
| Reset another user's password | The role named Admin | The option is hidden |

**Teams**

| Task | Permissions required | Without it |
| --- | --- | --- |
| See teams | `user_settings:read` | The tab shows an error |
| Pick team members | `user:read` | The picker does not load |
| Create a team | `user_settings:create` | The save is refused |
| Rename a team, or change its members or manager | `user_settings:update` | The change is refused |
| Delete a team | `user_settings:delete` and `settings:delete` | The delete is refused |

**Security**

| Tab or task | Permissions required |
| --- | --- |
| Roles: create, rename or delete a role | `security_settings:create`, `update` or `delete` |
| Permissions: change what a role can do | `security_settings:update` |
| User Roles: see assignments | `user:read` |
| User Roles: assign or remove roles | `user:update` |
| Sessions: see everyone's sessions | `security_settings:read` |
| Sessions: end another user's session | `security_settings:update` |
| Policies | `system_settings:read` to view, `system_settings:update` to change |
| Single Sign-On: login policy and preferences | `settings:update` |
| Single Sign-On: identity providers and login domains | `system_settings:update` |
| API Keys: see and manage everyone's keys | The role named Admin |
| Webhooks | The role named Admin |

**Ticketing, SLA and time**

| Task | Permissions required |
| --- | --- |
| Create, edit or delete boards | `ticket_settings:create`, `update` or `delete` |
| Edit board statuses and display settings | `ticket_settings:update` |
| View a board's close rules and auto-close rules | `ticket_settings:read` |
| Change close rules, or create, edit or delete auto-close rules | `ticket_settings:update` to change close rules and edit auto-close rules, `ticket_settings:create` to add one, `ticket_settings:delete` to remove one |
| Edit external systems | `ticket:update` |
| Change ticket numbering | `settings:update` |
| Edit checklist templates | `ticket_settings:update` |
| Manage SLA policies | `sla_policy:read`, `create`, `update`, `delete` |
| Open Settings > Time Entry | `time_period:read` |
| Change time period settings | `time_period:manage` |

**Email, notifications and integrations**

| Task | Permissions required |
| --- | --- |
| See email settings | `settings:read` |
| List email providers | `ticket_settings:read` |
| Save outbound email settings and email providers, or connect, reconnect or resync an IMAP mailbox | `ticket_settings:update` |
| Manage sender addresses | `settings:update` |
| Notifications and email templates | `settings:read` to view, `settings:update` to change |
| RMM, Entra, Microsoft, Google, Teams and Hudu integrations | `system_settings:read` to view, `system_settings:update` to change |
| NinjaOne and Huntress | `settings:read` and `settings:update` |
| QuickBooks and Xero | `accounting_integrations:catalog_read`, `connections_manage` and `mappings_manage` |

**Other settings and admin pages**

| Page | Permissions required |
| --- | --- |
| Client Portal settings: logo, domain and feature toggles | `settings:update` |
| Tags | `tag` permissions. Display rules need `settings:update`. |
| Asset types and statuses | `system_settings:update` |
| Secrets | `secrets:view` and `secrets:manage` |
| Imports and exports | `import_export:read` and `import_export:manage` |
| Extensions | `extension:read` and `extension:write` |
| Account and subscription | `account_management:read` to view, `update` to change plan or payment, `delete` to cancel |
| Workflows | `workflow:read`, `manage`, `publish` and `admin` |
| Job Monitoring: clear history | `job:delete` |
| Reports | `reports:read` |
| Marketing | `marketing:read` and `marketing:manage` |

Four things to know:

- **Some admin features need the role named Admin, not a permission.** Resetting another user's password, managing everyone's API keys and webhooks check for a role called Admin. Granting `user:reset_password` or the `webhook` permissions to another role does not unlock them.
- **The Role permissions do nothing on screen.** They apply only to the REST API. Managing roles uses `security_settings`.
- **Saving email settings needs `ticket_settings:update`, not `settings:update`.**
- **Board close rules are a settings permission, not a ticket permission.** Viewing or changing close rules and auto-close rules checks `ticket_settings`, so `ticket:update` alone no longer opens them. Client portal users are always refused. Closing a ticket still needs `ticket:update`, plus `ticket:read` for the close-rule check that runs first.
- **Your profile needs no permission.** Every user can edit their own name, avatar, password and API keys.

## Client portal

Client portal users have their own roles: Admin, Finance and User. You manage them in **Settings > Security > Permissions**, in the **Client Portal** view. A permission ticked in the MSP view does nothing for portal users.

**What each built-in portal role can do**

| Task | Admin | Finance | User |
| --- | --- | --- | --- |
| View, create, reply to, close and reopen tickets | Yes | Yes | Yes |
| Upload ticket attachments | Yes | Yes | Yes |
| Delete their own ticket comments | No | No | No |
| See projects | Yes | Yes | Yes |
| See a project's billing summary | Yes | Yes | No |
| See invoices, quotes, usage and credits, and accept or reject quotes | Yes | Yes | No |
| See documents and the knowledge base | Yes | Yes | Yes |
| View and edit company details and logo | Yes | Yes | Yes |
| See the list of company users | Yes | Yes | No |
| Add, edit, deactivate or delete users, reset passwords, assign roles | Yes | No | No |
| Manage visibility groups | Yes | No | No |
| See devices, book appointments, submit service requests, edit own profile | Yes | Yes | Yes |

**Portal screens**

| Screen or task | Permission required | Without it |
| --- | --- | --- |
| Dashboard | None. Each tile needs the matching read permission (`ticket:read`, `project:read`, `billing:read`). | The tile shows 0 |
| See tickets | `ticket:read` | The list shows an error |
| Create a ticket | `ticket:create` | The create is refused. The button still shows. |
| Reply to a ticket, change its status, close or reopen it | `ticket:update` | The action is refused |
| Upload a ticket attachment | `document:create` | The upload is refused |
| Projects | `project:read` | The menu item is hidden, and the page shows "Insufficient permissions" |
| Billing menu, invoices, quotes, credits and usage | `billing:read` | The menu item and tabs are hidden |
| Accept or reject a quote | `billing:read` | The action is refused |
| Documents | `document:read` | The menu item is hidden |
| Knowledge base | `document:read` | The page shows an error |
| Company Settings | `client:read` | The menu item is hidden |
| Edit company details and logo | `client:update` | The save is refused |
| User Management tab | `user:read` | The tab is hidden |

**Managing portal users needs the Admin role itself.** Adding, editing, deactivating or deleting portal users, resetting passwords, assigning roles and managing visibility groups all require the portal role named Admin. A custom portal role that grants `user:create` or `user:update` is not enough on its own.

**Settings that control portal access without permissions:**

- **Visibility groups** decide whether a portal user sees every ticket, device and project of their company or only their own. A user without a group sees everything for their company. A portal Admin always does.
- **Boards** that are not visible in the client portal are hidden from every portal user, and portal users cannot create tickets on them.
- **Ticket statuses** must be marked as selectable in the portal before a portal user can choose them.
- **Appointments** appear only when you turn them on in the client portal settings.
- **Project visibility settings** on each project decide whether portal users see its phases, tasks and billing.

Three things to know:

- **Every portal role can edit company details by default.** All three roles hold `client:update`. Remove it from Finance and User if that is not what you want.
- **Paying an invoice and managing saved cards need no permission.** Any portal user from that company can do both, as long as they have the link.
- **Accepting a quote needs only `billing:read`.** Any portal user who can see quotes can accept or reject them.
