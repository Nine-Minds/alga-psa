# Reference Data Import System

## Overview

The Reference Data Import System allows multi-tenant organizations to import pre-defined standard reference data types into their tenant-specific tables. This feature provides consistency across deployments while maintaining tenant isolation.

## Architecture

### Database Structure

The system uses a two-tier approach:

1. **Standard Reference Tables** - System-wide tables containing pre-defined reference data
2. **Tenant-Specific Tables** - Per-tenant copies of reference data that can be customized

```
standard_* tables (system-wide)
    ↓ import
tenant tables (per-organization)
```

### Standard Reference Tables

The following standard reference tables are available:

- `standard_boards` - Organizational containers/boards for grouping categories
- `standard_service_categories` - Categories for service catalog items  
- `standard_categories` - Ticket/project categories with parent-child relationships
- `standard_priorities` - Ticket priority levels
- `standard_statuses` - Ticket status options
- `standard_service_types` - Service billing types
- `standard_interaction_types` - Types of customer interactions

## User Interface

### Accessing Import Functionality

All reference data types that support importing include an "Import from Standard Types" button on their respective settings pages:

1. Navigate to **Settings** → **General** → **Ticketing Settings**
2. Select the appropriate tab (Priorities, Statuses, Boards, Categories, etc.)
3. Click the **"Import from Standard Types"** button

### Import Process

#### 1. Selection Dialog

When clicking "Import from Standard Types", users see:

- A list of all available standard items
- Checkboxes to select individual items or select all via header checkbox
- Visual indicators:
  - For boards: Active/Inactive switches and Default status
  - For categories: Hierarchical display with parent-child relationships
  - Display order for all items

#### 2. Additional Options

**Categories Import**: 
- Requires selecting a target board
- All imported categories will be assigned to the selected board
- Parent-child relationships are preserved

#### 3. Conflict Resolution

If imported items conflict with existing data, users see:

**Name Conflicts**: When an item with the same name exists
- Skip the item
- Import with a new name (editable)

**Order Conflicts**: When the display order is already in use
- Import with suggested next available order

#### 4. Import Confirmation

After successful import:
- Toast notification confirms success
- Table automatically refreshes to show new items
- Items maintain their relative ordering

## Features

### Parent-Child Relationships (Categories)

Categories support hierarchical organization:
- Parent categories can be assigned to different boards
- Subcategories inherit their parent's board
- Changing a parent's board updates all subcategories
- Visual indentation shows hierarchy

### Display Ordering

All reference data types support custom display ordering:
- Order is preserved during import
- Conflicts are automatically resolved
- Subcategories are ordered within their parent

### Board Assignment (Categories)

- Parent categories must have a board
- Subcategories inherit parent's board
- Board can be edited for parent categories only
- Warning shown when changing affects subcategories

### Active/Default Flags

**Boards**:
- `is_inactive` - Marks board as inactive
- `is_default` - Sets default board for client portal
- Only one board can be default at a time

**Other Types**:
- Most types include `is_active` or similar status flags
- Inactive items can be hidden from selection lists

## Implementation Details

### Server Actions

The import system uses server actions for all operations:

```typescript
// Get available standard data
const available = await getAvailableReferenceData(dataType);

// Check for conflicts before import
const conflicts = await checkImportConflicts(dataType, selectedIds, options);

// Import with conflict resolution
await importReferenceData(dataType, selectedIds, options, resolutions);
```

### Database Schema

Standard tables include:
- `id` (UUID) - Unique identifier
- `*_name` - Display name
- `description` - Optional description
- `display_order` - Sort order
- `created_at` / `updated_at` - Timestamps

Tenant tables add:
- `tenant` - Tenant identifier
- `created_by` - User who created the record
- Additional tenant-specific fields

### Migration

The standard reference data is populated via migration:
`migrations/20250630140000_create_standard_reference_tables.cjs`

This ensures consistent data across all deployments.

## Best Practices

### For Administrators

1. **Review Before Import**: Check existing data to avoid duplicates
2. **Plan Channel Assignment**: For categories, decide channel strategy first
3. **Maintain Naming Conventions**: Use consistent naming across imports
4. **Order Management**: Review display orders after import

### For Developers

1. **Adding New Reference Types**:
   - Create standard table via migration
   - Add configuration to `referenceDataActions.ts`
   - Implement UI component following existing patterns
   - Include proper TypeScript interfaces

2. **Customizing Import Behavior**:
   - Override `mapFields` for special field handling
   - Add custom validation in `validateImport`
   - Implement special conflict resolution if needed

## Supported Reference Types

### Currently Implemented

1. **Channels** (`/settings/general/ticketing`)
   - Import organizational groupings for categories
   - Set active/inactive status
   - Designate default channel for client portal

2. **Categories** (`/settings/general/ticketing`)
   - Import with parent-child relationships
   - Assign to channels
   - Hierarchical display and ordering

3. **Service Categories** (`/settings/billing`)
   - Import billing categories
   - Used for service catalog organization

4. **Priorities** (`/settings/general/ticketing`)
   - Import priority levels
   - Set colors and ordering

5. **Statuses** (`/settings/general/ticketing`)
   - Import ticket statuses
   - Configure status types

6. **Service Types** (`/settings/billing`)
   - Import billing methods
   - Configure service billing types

7. **Interaction Types** (`/settings/general/ticketing`)
   - Import customer interaction types
   - Used for tracking communication methods

### Adding New Types

To add import functionality to a new reference type:

1. Create the standard table with migration
2. Add type configuration to `referenceDataConfig`
3. Update the component to include import button
4. Test conflict resolution scenarios

## Troubleshooting

### Common Issues

**"No standard items available to import"**
- Check if migration has run successfully
- Verify standard table has data

**Import fails with constraint error**
- Check for required fields (e.g., `created_by`)
- Ensure proper tenant context

**Items not appearing after import**
- Verify filter settings (channel filter for categories)
- Check if items were marked as inactive

**Duplicate name errors**
- Use conflict resolution dialog
- Consider unique naming strategy

### Debug Tips

1. Check browser console for detailed errors
2. Verify server logs for constraint violations
3. Inspect network tab for failed requests
4. Review database for data integrity

## Future Enhancements

Potential improvements to the import system:

1. **Bulk Operations**
   - Export current configuration
   - Import from CSV/JSON
   - Copy between tenants

2. **Template Management**
   - Save import selections as templates
   - Share templates between organizations

3. **Advanced Filtering**
   - Filter standard items by category
   - Search within import dialog
   - Preview before import

4. **Audit Trail**
   - Track who imported what and when
   - Rollback capabilities
   - Change history