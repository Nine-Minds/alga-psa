# ITIL Consolidation Cleanup Plan

**Date**: 2025-09-18
**Issue**: Incomplete consolidation, cleanup needed

## Original Implementation Plan (From Previous Claude)

### :dart: Design Decision Summary
- ITIL remains rigid - no user modifications allowed
- Per-board configuration - each channel chooses custom OR ITIL (not tenant-level)
- Full consolidation - migrate ITIL data to standard priority/category tables
- Immediate implementation - go straight to consolidation (no interim fixes)

### :clipboard: Original Implementation Plan

**Phase 1: Create ITIL Standard Records**

1.1 ITIL Priority Records
Create migration to populate **standard_priorities** table with ITIL standards:
```sql
-- 5 ITIL priority records (GLOBAL, not per tenant)
INSERT INTO standard_priorities (priority_id, priority_name, color, order_number, is_itil_standard, item_type, itil_priority_level)
VALUES
  (uuid(), 'Critical', '#EF4444', 1, true, 'ticket', 1),
  (uuid(), 'High', '#F97316', 2, true, 'ticket', 2),
  (uuid(), 'Medium', '#EAB308', 3, true, 'ticket', 3),
  (uuid(), 'Low', '#3B82F6', 4, true, 'ticket', 4),
  (uuid(), 'Planning', '#6B7280', 5, true, 'ticket', 5);
```

1.2 ITIL Category Records
Create migration to populate **standard_categories** table with ITIL tree:
```sql
-- Parent categories: Hardware, Software, Network, Security, Service Request
-- Child categories: Server, Application, VPN, Malware, Access Request, etc.
-- Mark all with is_itil_standard: true
```

**Phase 2: Update Channel Configuration**
- Add ITIL capability flags to **standard_channels** and **channels** tables
- Modify channel priority/category type validation
- Ensure channels using ITIL only reference ITIL standard records
- Add UI warnings if ITIL standards are attempted to be modified

**Phase 3: Update ITIL Components**

3.1 Impact × Urgency Calculation
- Keep existing calculation logic in UI components
- Map calculated priority level (1-5) to corresponding ITIL priority record ID
- Store in standard priority_id field instead of itil_priority_level

3.2 Category Selection
- ItilFields, TicketInfo, QuickAddTicket already use CategoryPicker
- Update to use ITIL records from categories table instead of hardcoded ItilCategories
- Filter CategoryPicker to show only ITIL records when channel uses ITIL

**Phase 4: Database Schema Updates**

4.1 Add ITIL Standard Flags
```sql
-- Add to standard_priorities table (NOT per tenant)
ALTER TABLE standard_priorities ADD COLUMN is_itil_standard BOOLEAN DEFAULT false;
ALTER TABLE standard_priorities ADD COLUMN itil_priority_level INTEGER; -- 1-5 mapping

-- Add to standard_categories table (NOT per tenant)
ALTER TABLE standard_categories ADD COLUMN is_itil_standard BOOLEAN DEFAULT false;

-- Add ITIL capability flags to channels
ALTER TABLE channels ADD COLUMN supports_itil_priorities BOOLEAN DEFAULT false;
ALTER TABLE channels ADD COLUMN supports_itil_categories BOOLEAN DEFAULT false;

-- Add ITIL capability flags to standard_channels
ALTER TABLE standard_channels ADD COLUMN supports_itil_priorities BOOLEAN DEFAULT false;
ALTER TABLE standard_channels ADD COLUMN supports_itil_categories BOOLEAN DEFAULT false;
```

4.2 Migration Script for Existing Tickets
**SKIPPED** - No tickets with ITIL in production (branch not published yet)

**Phase 5: Update Business Logic**

5.1 Ticket Creation/Updates
- Remove dual priority/category handling
- Always use priority_id and category_id
- For ITIL channels: map Impact×Urgency to ITIL priority record ID

5.2 Filtering & Queries
- Remove dual filtering logic from optimizedTicketActions.ts
- All tickets now filter by standard priority_id and category_id
- ITIL tickets appear in filters automatically (same table, same fields)

5.3 Display Logic
- Update ticket-columns.tsx to remove ITIL-specific display paths
- All tickets use same priority/category display logic
- ITIL calculation details (Impact×Urgency) remain in ticket details

**Phase 6: Cleanup**

6.1 Remove Redundant Fields
After migration validation:
```sql
-- Remove old ITIL fields from tickets table
ALTER TABLE tickets DROP COLUMN itil_priority_level;
ALTER TABLE tickets DROP COLUMN itil_category;
ALTER TABLE tickets DROP COLUMN itil_subcategory;
```

6.2 Remove Hardcoded ITIL Data
- Remove ItilCategories object from utils
- Remove hardcoded priority mapping logic
- Keep ItilLabels for Impact/Urgency display only

### User Feedback on Original Plan
- **Step 4.2 not necessary** - no tickets with ITIL in production (branch has not been published)
- **Migration files can be edited** - they were rolled back, so direct editing is possible
- **Step 1.1** - priorities should not be per tenant, add them to **standard_priorities** to make ITIL available for import
- **4.1 Add ITIL Standard Flags** - these should go to **standard_priorities**, **standard_categories** (not tenant tables)
- **Need ITIL capability flags** - add to both **standard_channels** and **channels** tables

---

## Post-Implementation Assessment

**Date**: 2025-09-18
**Status**: Plan approximately 70% completed - significant cleanup work remains

### ✅ What Was Successfully Implemented:

**Database Schema Updates:**
- ✅ Added ITIL flags to `standard_priorities`, `standard_categories`, `standard_channels`, and `channels` tables
- ✅ ITIL priorities added to `standard_priorities` table with proper mapping
- ✅ ITIL categories added to `standard_categories` table
- ✅ Removed redundant `itil_category`, `itil_subcategory`, and `itil_priority_level` fields from tickets table migration
- ✅ Priority calculation and mapping logic updated in `ticketActions.ts`
- ✅ Priority display logic consolidated in `ticket-columns.tsx`

**Business Logic:**
- ✅ Updated `optimizedTicketActions.ts` to fetch both custom and ITIL priorities/categories
- ✅ Priority calculation maps ITIL Impact×Urgency to correct `standard_priorities` record

### ❌ Why The Plan Was Not Fully Executed:

The implementation stopped at the database/backend level but **did not complete the frontend component cleanup**. Many files still reference the deprecated fields that should have been removed:

- `itil_priority_level` - found in 15+ files
- `itil_category` - found in 20+ files
- `itil_subcategory` - found in 15+ files

**Root Cause**: The original implementation focused on making the new system work alongside the old system, but did not complete the removal of the old system, leaving a **dual-system approach** instead of true consolidation.

---

## Completion Plan - Remaining Work

The following phases will complete the ITIL consolidation by removing all legacy dual-system references and fully implementing the unified priority/category system.

### Phase 1: Interface & Schema Cleanup (High Priority)

**1.1 Update Ticket Interfaces**
- File: `server/src/interfaces/ticket.interfaces.tsx`
- Remove deprecated fields from `ITicket` interface: `itil_priority_level`, `itil_category`, `itil_subcategory`
- Update comment on `priority_id` to reflect unified system
- Update `ITicketListItem` interface accordingly

**1.2 Update Ticket Schemas**
- File: `server/src/lib/schemas/ticket.schema.ts`
- Remove from `ticketFormSchema`: `itil_priority_level`, `itil_category`, `itil_subcategory`
- Remove validation rule requiring `priority_id OR itil_priority_level`
- Remove corresponding fields from `ticketSchema` and `ticketUpdateSchema`

**1.3 Update Channel Interface**
- File: `server/src/interfaces/channel.interface.ts`
- Remove `display_itil_category` field if no longer needed

### Phase 2: Component Logic Updates (Critical)

**2.1 Modernize ItilFields Component**
- File: `server/src/components/tickets/ItilFields.tsx`
- Remove hardcoded `ItilCategories` import and usage
- Update to receive ITIL categories as props from parent components
- Remove category/subcategory selection logic (use unified CategoryPicker)
- Keep only Impact/Urgency fields and resolution fields

**2.2 Complete QuickAddTicket Updates**
- File: `server/src/components/tickets/QuickAddTicket.tsx`
- Remove all references to `itil_category` and `itil_subcategory`
- Remove hardcoded category handling logic
- Ensure ITIL categories are properly filtered from unified categories list

**2.3 Complete TicketInfo Updates**
- File: `server/src/components/tickets/ticket/TicketInfo.tsx`
- Remove legacy ITIL category handling
- Ensure category changes go through unified category system only

**2.4 Update TicketDetails Component**
- File: `server/src/components/tickets/ticket/TicketDetails.tsx`
- Remove separate ITIL category state management
- Remove legacy field handling in update logic
- Ensure all category/priority updates use unified system

### Phase 3: Business Logic Cleanup (Medium Priority)

**3.1 Update Service Layer**
- File: `server/src/lib/services/itilService.ts`
- Update category references to use category_id
- Modify metrics collection to work with unified category system

**3.2 Update Workflow Logic**
- File: `server/src/lib/workflows/itilIncidentLifecycleWorkflow.ts`
- Update category validation to use unified category system

**3.3 Clean Up Remaining Components**
- Update any remaining files with legacy field references
- Ensure all ticket queries only use unified fields

### Phase 4: Testing & Validation (Critical)

**4.1 Functional Testing**
- Test ITIL ticket creation with Impact/Urgency calculation
- Verify ITIL categories display correctly in CategoryPicker
- Confirm priority mapping works correctly
- Test ticket updates maintain ITIL functionality

**4.2 Database Verification**
- Confirm no code references removed database fields
- Verify ITIL priorities/categories are properly loaded from standard tables

### Success Criteria
✅ No references to `itil_priority_level`, `itil_category`, `itil_subcategory` in codebase
✅ All ITIL tickets use unified `priority_id` and `category_id` fields
✅ ITIL Impact/Urgency calculation still works and maps to correct priorities
✅ ITIL categories display correctly using unified CategoryPicker
✅ All tests pass and ITIL functionality is preserved
