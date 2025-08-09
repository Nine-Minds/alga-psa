# Settings Reference Data Guide

## Overview

This guide covers the reference data management features available in the Settings area of the application. Reference data includes system-wide configurations like priorities, statuses, boards, and categories that are used throughout the ticketing and project management systems.

## Accessing Reference Data Settings

### Navigation

1. Click on **Settings** in the main navigation
2. Navigate to either:
   - **General** → **Ticketing Settings** (for most reference data)
   - **Billing** → **Settings** (for service-related reference data)

## Ticketing Settings

### Tabs Overview

The Ticketing Settings page contains multiple tabs:

- **Priorities** - Urgency levels for tickets
- **Statuses** - Workflow states for tickets  
- **Boards** - Organizational boards for ticket grouping
- **Categories** - Ticket categorization
- **Service Types** - Types of billable services
- **Interaction Types** - Customer communication methods

### Common Features

All reference data types share these features:

1. **Add New** - Create custom entries
2. **Edit** - Modify existing entries
3. **Delete** - Remove unused entries (with protection for in-use items)
4. **Import from Standard Types** - Import pre-defined system entries
5. **Pagination** - Navigate through large datasets
6. **Ordering** - Control display sequence

## Managing Boards

Boards are organizational containers that group related ticket categories, similar to departments or high-level groupings (e.g., General Support, Technical Issues, Administration, Security & Compliance).

### Features

- **Active/Inactive Toggle** - Enable or disable boards
- **Default Board** - Set the default board for client portal ticket submissions
- **Description** - Add context for each organizational grouping
- **Display Order** - Control the sequence in channel lists

### Import Process

1. Click **Import from Standard Boards**
2. Select board groupings to import using checkboxes
3. Review Active/Default status (shown as switches)
4. Click **Import Selected**

### Best Practices

- Keep at least one board active
- Set a sensible default board for client portal
- Use clear, descriptive names that reflect organizational areas
- Consider how categories will be grouped under each board

## Managing Categories

Categories provide hierarchical organization for tickets and projects.

### Unique Features

- **Parent-Child Relationships** - Create category hierarchies
- **Board Assignment** - Categories belong to specific boards
- **Hierarchical Display** - Subcategories shown indented under parents

### Creating Categories

#### Parent Categories
1. Click **Add Category**
2. Enter category name
3. Select a board (required)
4. Set display order
5. Click **Create**

#### Subcategories
1. Click **Add Category**
2. Enter category name
3. Select a parent category from dropdown
4. Display order is auto-calculated
5. Board is inherited from parent
6. Click **Create**

### Editing Categories

- **Parent Categories**: Can change name, order, and board
- **Subcategories**: Can change name and order only
- **Board Changes**: Changing a parent's board affects all subcategories

### Import Process

1. Click **Import from Standard Categories**
2. **Select Target Board** (required)
3. Select categories to import
   - Parent categories import with their subcategories
   - Maintain hierarchical structure
4. Click **Import Selected**

### Board Filtering

Use the board dropdown to filter categories:
- "All Boards" shows everything
- Individual boards show only their categories
- Hierarchy is maintained in filtered views

## Managing Service Categories

Located in **Billing** → **Settings**, service categories organize your service catalog.

### Features

- Group related services
- Control billing presentation
- Support for descriptions
- Custom ordering

### Usage

Service categories are used when:
- Creating service catalog items
- Generating invoices
- Running billing reports

## Import Conflict Resolution

When importing items that conflict with existing data:

### Name Conflicts

When an item with the same name exists:
- **Skip this item** - Don't import the conflicting item
- **Import with new name** - Enter a different name

### Order Conflicts

When the display order is taken:
- System suggests next available order
- Automatically resolved on import

### Resolution Tips

- Review existing data before importing
- Use consistent naming conventions
- Plan display ordering strategy

## Best Practices

### Organization

1. **Consistent Naming**
   - Use clear, descriptive names
   - Avoid abbreviations
   - Consider sorting implications

2. **Logical Ordering**
   - Most common items first
   - Group related items
   - Leave gaps for future additions

3. **Channel Strategy** (Categories)
   - Assign categories to appropriate channels
   - Don't overcomplicate the hierarchy
   - Maximum 2-3 levels deep recommended

### Maintenance

1. **Regular Review**
   - Remove unused items
   - Update descriptions
   - Verify channel assignments

2. **Before Importing**
   - Check what already exists
   - Plan the target structure
   - Consider impact on existing tickets

3. **Testing Changes**
   - Test in a non-production environment first
   - Verify ticket creation still works
   - Check reporting impacts

## Troubleshooting

### Common Issues

**Can't delete a category**
- Check if tickets are using it
- Remove associations first

**Import button not working**
- Verify you have appropriate permissions
- Check browser console for errors

**Categories not showing**
- Check channel filter setting
- Verify categories have correct channel

**Subcategories appearing at wrong level**
- Verify parent category relationship
- Check display order values

### Tips

- Use browser refresh if data seems stale
- Check for validation errors in forms
- Review server response in network tab

## Advanced Features

### Bulk Operations

While not available in UI, administrators can:
- Use database scripts for bulk updates
- Export/import via API (if available)
- Modify multiple items via direct database access

### Integration Points

Reference data is used by:
- Ticket creation forms
- Reporting systems
- Client portal
- API endpoints
- Workflow automation

Changes to reference data immediately affect these systems.

## Summary

The reference data import system provides a powerful way to standardize configurations across your organization while maintaining flexibility for customization. Key points:

1. Import saves time on initial setup
2. Conflict resolution prevents data issues  
3. Hierarchical organization supports complex structures
4. Channel assignment enables proper categorization
5. Display ordering provides control over user experience

For technical implementation details, see the [Reference Data Import System](reference_data_import_system.md) documentation.