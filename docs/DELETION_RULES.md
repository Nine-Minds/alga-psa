# Alga PSA Deletion Rules

This document explains how client and contact deletion works in Alga PSA.

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
3. **Clean up test data** before it accumulates business records

### When Deletion is Appropriate:
1. **Test/demo clients** with no real business data
2. **Duplicate entries** created by mistake (before they gain dependencies)
3. **Initial setup cleanup** during implementation

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

---

*This document describes the actual deletion behavior implemented in Alga PSA.*
