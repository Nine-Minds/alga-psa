# Reference Data Import - Quick Guide

## What is Reference Data Import?

A feature that lets you quickly import pre-defined configurations (like ticket priorities, statuses, boards, and categories) instead of creating them manually.

## How to Access

1. Go to **Settings**
2. Navigate to:
   - **General** → **Ticketing Settings** for most items
   - **Billing** → **Settings** for service categories

## How to Import

### Basic Import Process

1. Click **"Import from Standard Types"** button
2. Select items using checkboxes (or check header to select all)
3. Click **"Import Selected"**
4. Handle any conflicts if they appear

### Special Case: Categories

Categories require selecting a target board:

1. Click **"Import from Standard Categories"**
2. **Select a Board** from dropdown (required!)
3. Select categories to import
4. Click **"Import Selected"**

## Understanding the Display

### Boards Import Dialog
- **Active** - Switch shows if board is active
- **Default** - Switch shows if it's the default board
- **Order** - Display sequence number

### Categories Import Dialog
- **↳** - Indicates a subcategory
- Parent categories import with their subcategories
- All imported categories go to selected board

## Handling Conflicts

### Name Conflict
**"A [item] with this name already exists"**
- Choose: Skip this item
- Or: Import with new name (edit the suggested name)

### Order Conflict
**"Display order X is already in use"**
- System suggests next available number
- Just click to accept

## Quick Tips

✅ **DO:**
- Check what you already have before importing
- Import standard items first, then customize
- Use consistent naming
- Keep hierarchies simple (max 2-3 levels)

❌ **DON'T:**
- Import duplicates of existing items
- Forget to select a board for categories
- Over-complicate category hierarchies
- Import everything - only what you need

## Common Items to Import

### Boards (Organizational Groupings)
- General Support
- Technical Issues  
- Administration
- Security & Compliance
- Projects
- Urgent Matters

### Priorities
- Low
- Medium
- High
- Critical

### Statuses
- New
- In Progress
- Waiting
- Resolved
- Closed

### Categories (Examples)
- **Technical Issues**
  - ↳ Hardware Failures
  - ↳ Software Problems
- **Service Requests**
  - ↳ New User Setup
  - ↳ Access Requests

## After Importing

1. **Review** imported items in the table
2. **Edit** any items to customize names or orders
3. **Test** by creating a new ticket to see options
4. **Delete** any unnecessary imported items

## Troubleshooting

**Import button does nothing?**
- Check browser console (F12)
- Refresh the page
- Check your permissions

**Can't see imported categories?**
- Check the board filter dropdown
- Make sure you selected the right board

**Import succeeded but items missing?**
- Check if filtered by board
- Look for inactive items
- Refresh the page

## Need More Help?

See the full documentation:
- [Settings Reference Data Guide](settings_reference_data_guide.md)
- [Reference Data Import System](reference_data_import_system.md)