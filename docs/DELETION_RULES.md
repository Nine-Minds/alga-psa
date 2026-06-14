# Alga PSA Deletion Rules

This document explains how client, contact, and ticket deletion works in Alga PSA.

## Client Deletion Rules

### You CAN delete a client if they have:
- Addresses/locations only (these will be automatically cleaned up)
- Tax settings (these will be automatically cleaned up)
- Tags (these will be automatically cleaned up)

### You CANNOT delete a client if they have:
- **Contacts** - Remove or reassign contacts first
- **Tickets** (including closed tickets) - For audit trail preservation
- **Projects** - Complete or reassign projects first
- **Documents** - Move or delete documents first
- **Invoices or billing history** - For legal/compliance requirements
- **Interactions** - Communication history must be preserved
- **Assets or devices** - Reassign or remove assets first

### Alternative: Mark as Inactive

If a client has business records, consider **marking as inactive** instead:
- Hides the client from active lists
- Preserves all historical data
- Prevents new business activities
- Can be reactivated if needed
- Related contacts can also be marked inactive

## Contact Deletion Rules

### You CAN delete a contact if they have:
- No ticket history
- No communication records
- Not set as billing contact

### You CANNOT delete a contact if they are:
- **Billing contact** for their client - Assign a different billing contact first
- **Referenced in tickets** (including closed) - For support history
- **Referenced in interactions** - For communication history
- **Associated with documents** - For audit trails
- **Assigned to projects** - Reassign or complete projects first

### Alternative: Mark as Inactive

Instead of deletion, mark contacts as **inactive**:
- Hides from active contact lists
- Preserves all business relationships
- Maintains audit trails
- Prevents new activities
- Can be reactivated if needed

## Ticket Deletion Rules

Tickets can be deleted from the ticket detail page (the **Delete** button in the top-right toolbar) or via the REST API (`DELETE /api/v1/tickets/{id}`). Both paths run the same dependency validation before removing any data.

### You CAN delete a ticket if it has:
- Comments and internal notes (automatically removed)
- Attachments and documents owned by the ticket (automatically removed)
- SLA notification tracking records (automatically removed)
- Email reply tokens (automatically removed)
- Project-ticket links (automatically removed)
- Tags (automatically removed)

### You CANNOT delete a ticket if it has:
- **Logged time entries** – Review, close, or delete the time entries on the ticket first
- **Schedule entries** – Remove or reassign any scheduled work blocks against the ticket first

### What happens to the SLA audit log

SLA audit log rows are *not* deleted when a ticket is removed. Instead they are **detached**: the `ticket_id` column is set to `null` and the original ticket ID and number are written into `event_data`. This preserves SLA compliance records even after the ticket itself is gone.

Ticket activity logs (`ticket_audit_logs`) are deleted along with the ticket.

### REST API behaviour

`DELETE /api/v1/tickets/{id}` enforces the same dependency rules described above. If blocking records exist the endpoint returns `409 Conflict` with a `details.dependencies` array listing each blocking item so the caller knows exactly what to remove first. When the delete succeeds the response is `204 No Content` and the ticket is removed from the search index.

### Alternative: Close the ticket

If a ticket has extensive time-entry history or you want to keep it for billing reconciliation, close it instead of deleting it. Closed tickets are excluded from most active-ticket views but remain fully available in reporting, SLA dashboards, and audit trails.

## Why These Rules Exist

These deletion rules ensure:

1. **Data Integrity** - Prevents orphaned records and broken relationships
2. **Audit Compliance** - Maintains required business records
3. **Legal Protection** - Preserves invoices and communications
4. **Business Continuity** - Protects operational history and reporting
5. **User Experience** - Clear, predictable behavior

## Best Practices

### Instead of Deleting:
1. **Mark clients as inactive** when they have business history
2. **Mark contacts as inactive** rather than deleting
3. **Close tickets** rather than deleting when time entries or schedule entries are present
4. **Clean up test data** before it accumulates business records

### When Deletion is Appropriate:
1. **Test/demo clients** with no real business data
2. **Duplicate entries** created by mistake (before they gain dependencies)
3. **Initial setup cleanup** during implementation
4. **Tickets with no time entries or schedule entries** when the work item is no longer needed

## Technical Implementation

- All deletions happen within **database transactions** for safety
- **Permission checks** ensure only authorized users can delete/mark inactive
- **Cascade cleanup** automatically removes safe-to-delete related data
- **Detailed error messages** explain exactly what's blocking deletion

## Error Messages You Might See

**Client with dependencies:**
> "Cannot delete client with active business records. Consider marking as inactive instead to preserve data integrity."

**Contact with history:**
> "Cannot delete contact with business history: 5 tickets, communication history. Consider marking the contact as inactive instead."

**Billing contact:**
> "Cannot delete this contact because they are set as the billing contact. Please assign a different billing contact first."

**Ticket with blocking records (API):**
> `409 Conflict` — `details.dependencies` lists each blocking record type (e.g. time entries, schedule entries) that must be cleared before the ticket can be deleted.

---

*This document describes the actual deletion behavior implemented in Alga PSA.*
