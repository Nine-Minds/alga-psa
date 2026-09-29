# Limit client portal ticket visibility

Visibility groups control which tickets a client portal contact can access. New and existing groups default to **All of this client's tickets**. Contacts without a group keep full access to their client's tickets.

## Hide a board from the portal entirely

A per-board toggle in **Settings → Ticketing → Boards** controls whether a board is visible in the client portal at all. When **Show in client portal** is turned off for a board, that board is removed from every portal surface — ticket lists, the ticket creation picker, dashboard totals, and the REST API — regardless of which visibility groups a contact belongs to. A visibility group that lists the board still grants no portal access while the switch is off.

This lets you keep internal workflow boards (staging queues, triage boards, engineering escalations) invisible to clients without updating every visibility group. A hidden pill appears on the board row in board settings to flag boards currently excluded from the portal.

Boards hidden this way are also invisible to client administrators; the board-level switch is the highest-priority portal access control and cannot be overridden by group membership.

## Controlling visibility through groups

A client administrator can manage groups in **Client Settings → Visibility Groups**. MSP staff can manage the same groups from a contact's **Client Portal** tab.

1. Create or edit a visibility group.
2. Select the boards its members can access. A group with no selected boards gives no ticket access.
3. Choose **Only their own tickets** to limit members to tickets where they are listed as the contact.
4. Save the group and assign it to the appropriate contacts.

The restriction applies to ticket lists, details, documents, dashboard totals and activity, and API access. A direct ticket link does not grant access. Comments and status changes require access to the ticket.

Client administrators can see all of their client's tickets on the group's selected boards, even when **Only their own tickets** is selected. This includes tickets with no contact. Ordinary members of a contact-scoped group cannot see tickets with no contact. To make one visible to a member, assign that person as the ticket's contact.

Tickets created in the client portal are assigned to the submitting contact. Tickets created by staff, email, or integrations may have no contact. Review those tickets before switching a group to **Only their own tickets**.

Board restrictions from visibility groups still apply to client administrators. Changing ticket visibility does not change MSP staff access or add ticket watchers or CC contacts.
