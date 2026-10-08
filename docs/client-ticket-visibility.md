# Limit client portal visibility

Visibility groups control which tickets, devices and projects a client portal contact can access. Each group has three independent scopes: **Ticket visibility**, **Device visibility** and **Project visibility**. New and existing groups default every scope to **All of this client's …**. Contacts without a group keep full access to their client's tickets, devices and projects.

## Hide a board from the portal entirely

A per-board toggle in **Settings → Ticketing → Boards** controls whether a board is visible in the client portal at all. When **Show in client portal** is turned off for a board, that board is removed from every portal surface — ticket lists, the ticket creation picker, dashboard totals, and the REST API — regardless of which visibility groups a contact belongs to. A visibility group that lists the board still grants no portal access while the switch is off.

This lets you keep internal workflow boards (staging queues, triage boards, engineering escalations) invisible to clients without updating every visibility group. A hidden pill appears on the board row in board settings to flag boards currently excluded from the portal.

Boards hidden this way are also invisible to client administrators; the board-level switch is the highest-priority portal access control and cannot be overridden by group membership.

## Controlling visibility through groups

A client administrator can manage groups in **Client Settings → Visibility Groups**. MSP staff can manage the same groups from a contact's **Client Portal** tab.

1. Create or edit a visibility group.
2. Select the boards its members can access. A group with no selected boards gives no ticket access.
3. Choose a scope for **Ticket visibility**, **Device visibility** and **Project visibility**. **All of this client's …** shows everything the client has. **Only their own …** limits members to the records described below.
4. Save the group and assign it to the appropriate contacts.

The group list shows the three scopes for each group as `Tickets: … · Devices: … · Projects: …`.

Client administrators always see everything, whatever the group says. Board restrictions from the group still apply to client administrators for tickets.

## Managers: who reports to whom

Each contact can have a **Reports to** contact. Set it on the contact in the PSA (**Contacts → Edit**), on the portal user's profile in **Client Settings → Users**, or through the REST API (`manager_contact_id`). The manager must be a different contact at the same client, and the chain cannot loop. Changing a contact's client clears their manager and their reports; deleting a contact clears the link on everyone who reported to them.

A manager's "own" records include those of everyone below them in the tree, directly or through other managers. This applies to every scope that is set to **Only their own …**. A contact with no reports sees only their own.

## Tickets

With **Only their own tickets**, a member sees a ticket on the group's boards when any of these is true:

- they are the ticket's contact, or the contact is one of their reports;
- the ticket belongs to a billing profile they have been granted ticket access to, or to the client's default profile when that profile is granted;
- they are an active contact watcher (CC) on the ticket.

Ordinary members cannot see tickets with no contact unless one of the other rules applies. To make one visible, assign a contact to the ticket, add the person as a watcher, or grant the billing profile. Tickets created in the client portal are assigned to the submitting contact. Tickets created by staff, email or integrations may have no contact, so review them before switching a group to **Only their own tickets**.

A manager does not inherit the tickets their reports watch; watching only counts for the person who is the watcher.

The restriction applies to ticket lists, details, documents, dashboard totals and activity, and API access. A direct ticket link does not grant access. Comments and status changes require access to the ticket.

## Devices

A device can be assigned to a contact (**Assigned to**) in the PSA asset form, the quick-add form, or the REST API (`contact_name_id`). The contact must belong to the device's client and cannot be a shared mailbox. Moving a device to another client, including an RMM sync that re-maps it, clears the assignment.

With **Only their own devices**, a member sees devices assigned to them or to someone who reports to them. **Unassigned devices are hidden** from ordinary members, the same way tickets with no contact are. After switching a group to this scope, the Devices tab can look empty until the devices have been assigned.

A ticket that has a device linked still shows the device's name, tag and type to its viewer when they cannot open the device itself. The dashboard device count and maintenance feed follow the same scope. Creating a ticket for a device requires that the device is visible to the user.

## Projects

Projects already have a contact. With **Only their own projects**, a member sees projects whose contact is them or one of their reports. Projects with no contact are hidden from ordinary members. The scope covers the projects list and details, phases, tasks and statuses, task and project documents, the billing summary and the dashboard project count and recent projects. Being added to a project another way does not grant access; a project membership table is not part of this feature.

## What does not change

- Hiding a board from the portal and the per-board toggle above still win over every group.
- MSP staff access is unchanged.
- Invoices, billing and contracts are not scoped by contact.
- There are no location or department groups; use **Reports to** for people and billing-profile grants for a site's tickets.

