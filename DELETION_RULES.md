# Alga PSA Deletion Rules

This document explains how client and contact deletion works in Alga PSA, following industry best practices for Professional Services Automation (PSA) platforms.

## 🧹 Client Deletion Rules

### ✅ **You CAN delete a client if they have:**
- Addresses/locations only (these will be automatically cleaned up)
- Tax settings (these will be automatically cleaned up)
- Tags (these will be automatically cleaned up)

### ❌ **You CANNOT delete a client if they have:**
- **Contacts** - Remove or reassign contacts first
- **Tickets** (including closed tickets) - For audit trail preservation
- **Projects** - Complete or reassign projects first
- **Documents** - Move or delete documents first
- **Invoices or billing history** - For legal/compliance requirements
- **Interactions** - Communication history must be preserved
- **Assets or devices** - Reassign or remove assets first
- **Contracts or subscriptions** - Complete or cancel contracts first
- **Service usage records** - For billing accuracy

### 🗃️ **Alternative: Archive Instead of Delete**

If a client has business records, consider **archiving** instead:
- Hides the client from active lists
- Preserves all historical data
- Prevents new business activities
- Can be reactivated if needed
- Automatically archives related contacts and users

## 👤 Contact Deletion Rules

### ✅ **You CAN delete a contact if they have:**
- No ticket history
- No communication records
- No contract involvement
- Not set as primary contact

### ❌ **You CANNOT delete a contact if they are:**
- **Primary contact** for their client - Assign a different primary contact first
- **Referenced in tickets** (including closed) - For support history
- **Referenced in interactions** - For communication history
- **Contract approvers or signatories** - For legal compliance
- **Associated with documents** - For audit trails
- **Assigned to projects** - Reassign or complete projects first

### 💡 **Alternative: Mark as Inactive**

Instead of deletion, mark contacts as **inactive**:
- Hides from active contact lists
- Preserves all business relationships
- Maintains audit trails
- Prevents new activities
- Can be reactivated if needed

## 🛡️ **Why These Rules Exist**

These deletion rules follow PSA industry standards to ensure:

1. **Data Integrity** - Prevents orphaned records and broken relationships
2. **Audit Compliance** - Maintains required business records
3. **Legal Protection** - Preserves contracts, invoices, and communications
4. **Business Continuity** - Protects operational history and reporting
5. **User Experience** - Clear, predictable behavior that matches user expectations

## 📋 **Best Practices**

### Instead of Deleting:
1. **Archive clients** with business history
2. **Mark contacts as inactive** rather than deleting
3. **Clean up test data** before it accumulates business records
4. **Use bulk operations** for managing large numbers of inactive records

### When Deletion is Appropriate:
1. **Test/demo clients** with no real business data
2. **Duplicate entries** created by mistake (before they gain dependencies)
3. **Initial setup cleanup** during implementation

## 🔧 **Technical Implementation**

- All deletions happen within **database transactions** for safety
- **Permission checks** ensure only authorized users can delete/archive
- **Cascade cleanup** automatically removes safe-to-delete related data
- **Detailed error messages** explain exactly what's blocking deletion
- **Archive functions** provide safe alternatives to deletion

## 💬 **Error Messages You Might See**

**Client with dependencies:**
> "Cannot delete client with active business records. Consider archiving instead to preserve data integrity."

**Contact with history:**
> "Cannot delete contact with business history: 5 tickets (including closed), communication history. Consider marking the contact as inactive instead to preserve data integrity."

**Primary contact:**
> "Cannot delete contact with business history: primary contact for client. Please assign a different primary contact to the client first."

---

*This document reflects industry-standard PSA practices designed to protect your business data while providing flexibility for data management.*