# Notification Event Recipients

This document describes who receives notifications for each event type in the Alga PSA notification system.

## Notification Events and Recipients

### 📋 Ticket Events

#### `TICKET_CREATED`
- **Recipients:** All users with `user:read` permission (typically admins/managers)
- **Trigger:** A new ticket is created in the system
- **Use Case:** Keeps management informed of new support requests
- **Priority:** Normal
- **Template:** Displays ticket number and title

#### `TICKET_ASSIGNED`
- **Recipients:** Only the specifically assigned user
- **Trigger:** A ticket is assigned to a user (or reassigned)
- **Use Case:** Alerts the assigned technician of new work
- **Priority:** Normal
- **Template:** Shows ticket number, title, and assignment details

#### `TICKET_UPDATED` / `TICKET_STATUS_CHANGED`
- **Recipients:** 
  - The assigned user (if any)
  - Users with escalation permissions (if priority changed)
- **Trigger:** Ticket status changes or priority escalates
- **Use Case:** Keeps assigned user informed of status changes
- **Priority:** Low (Normal for priority escalations)
- **Template:** Shows old/new status or priority

#### `TICKET_COMMENT_ADDED` / `TICKET_CLIENT_RESPONSE`
- **Recipients:**
  - The assigned user (if different from comment author)
  - Any users mentioned with @username in the comment
- **Trigger:** A comment is added to a ticket
- **Use Case:** Alerts relevant users to new information or responses
- **Priority:** Normal
- **Template:** Shows comment preview and mentions

#### `TICKET_CLOSED`
- **Recipients:**
  - The assigned user
  - The user who created the ticket (if different from assigned user)
- **Trigger:** A ticket is marked as closed
- **Use Case:** Confirms ticket resolution to relevant parties
- **Priority:** Low
- **Template:** Shows ticket closure confirmation

---

### 🏗️ Project Events

#### `PROJECT_CREATED`
- **Recipients:** All users with `project:read` permission
- **Trigger:** A new project is created
- **Use Case:** Keeps project stakeholders informed of new projects
- **Priority:** Normal
- **Template:** Shows project name and creation details

#### `PROJECT_ASSIGNED`
- **Recipients:** Only the specifically assigned project manager
- **Trigger:** A project is assigned to a manager
- **Use Case:** Alerts the project manager of new responsibility
- **Priority:** Normal
- **Template:** Shows project assignment details

#### `PROJECT_TASK_ASSIGNED`
- **Recipients:** Only the specifically assigned user
- **Trigger:** A project task is assigned to a user
- **Use Case:** Alerts the user of new task assignment
- **Priority:** Normal
- **Template:** Shows task name, project, and assignment details

#### `PROJECT_CLOSED`
- **Recipients:** All project team members
- **Trigger:** A project is marked as completed/closed
- **Use Case:** Informs team of project completion
- **Priority:** Normal
- **Template:** Shows project completion confirmation

---

### 💰 Billing Events

#### `INVOICE_GENERATED`
- **Recipients:** All users with `billing:read` permission
- **Trigger:** A new invoice is generated
- **Use Case:** Keeps billing team informed of new invoices
- **Priority:** Normal
- **Template:** Shows invoice number and amount

#### `INVOICE_FINALIZED`
- **Recipients:** All users with `billing:read` permission
- **Trigger:** An invoice is finalized and ready for sending
- **Use Case:** Alerts billing team that invoice is ready for client delivery
- **Priority:** Normal
- **Template:** Shows finalized invoice details

---

### ⏰ Time Tracking Events

#### `TIME_ENTRY_SUBMITTED`
- **Recipients:** All users with `user:read` permission (managers)
- **Trigger:** A time entry is submitted for approval
- **Use Case:** Alerts managers that time entries need approval
- **Priority:** Normal
- **Template:** Shows user name, hours, and approval status

#### `TIME_ENTRY_APPROVED`
- **Recipients:** Only the user who submitted the time entry
- **Trigger:** A time entry is approved
- **Use Case:** Confirms to the user that their time was approved
- **Priority:** Low
- **Template:** Shows approved hours and date

---

## Permission System Reference

The notification system uses these permission patterns:

| Permission | Description | Typical Recipients |
|------------|-------------|-------------------|
| `user:read` | Can view user information | Managers, Admins |
| `project:read` | Can view project information | Project stakeholders |
| `billing:read` | Can access billing/invoice information | Billing team, Managers |
| `ticket:read` | Can view tickets | Support staff, Managers |
| `nonexistent:permission` | Disables permission-based notifications | Used for specific-user-only events |

## Special Notification Logic

### @Mentions
- **How it works:** Use `@username` in ticket comments
- **Recipients:** Mentioned users receive notifications regardless of other rules
- **Example:** `@john Please review this issue` → john gets notified

### Additional Users
Some events have custom logic to notify specific users beyond permission-based recipients:

- **TICKET_ASSIGNED:** Only notifies the assigned user (ignores permissions)
- **PROJECT_TASK_ASSIGNED:** Only notifies the assigned user
- **TICKET_COMMENT_ADDED:** Notifies assigned user + mentioned users
- **TICKET_CLOSED:** Notifies assigned user + ticket creator

### User Preferences Override
- All notifications respect individual user preferences
- Users can disable specific notification types in their settings
- Default behavior: notify if no preference is set

## Current Recipient Counts

Based on your system setup, here are the typical recipient counts:

- **TICKET_CREATED:** ~7 users (all admins with `user:read`)
- **TICKET_ASSIGNED:** 1 user (only assigned user)
- **PROJECT_CREATED:** Users with `project:read` permission
- **Billing Events:** Users with `billing:read` permission

## Customization

To modify notification recipients, update the configuration in:
`server/src/lib/eventBus/subscribers/notificationSubscriber.ts`

Each event configuration includes:
- `permission`: Base permission required to receive notifications  
- `getAdditionalUsers()`: Function to add specific users beyond permission-based ones
- `priority`: Notification priority level

## Examples

### Example 1: Ticket Assignment
```
1. Ticket #FLOW-123 created → 7 admins get TICKET_CREATED notification
2. Ticket assigned to Alice → Only Alice gets TICKET_ASSIGNED notification
3. Bob adds comment mentioning @charlie → Alice (assigned) + Charlie (mentioned) get notifications
```

### Example 2: Project Workflow  
```
1. New project created → All users with project:read permission get notified
2. Project assigned to manager → Only the assigned manager gets notified
3. Task assigned to developer → Only the assigned developer gets notified
```