# Reference Data Import System Migration Guide

## Overview

This guide covers the migration process for existing installations to enable the new Reference Data Import System introduced in migration `20250630140000_create_standard_reference_tables.cjs`.

## What's New

The Reference Data Import System adds:

1. **Standard reference tables** with pre-defined data
2. **Import functionality** in the UI for all reference types
3. **Conflict resolution** for handling duplicates
4. **Enhanced category management** with parent-child relationships
5. **Display ordering** for all reference data types

## Migration Steps

### 1. Database Migration

Run the migration to create standard tables and update existing tables:

```bash
npm run db:migrate:latest
```

This migration will:
- Create `standard_*` tables for all reference types
- Add `display_order` column to existing tables if missing
- Add `description` column to channels table
- Populate standard tables with pre-defined data
- Update existing records with sequential display orders

### 2. Update Seed Files

If you use seed files, update them to include the new fields:

#### Channels
Add `description` and `display_order`:
```javascript
{
  channel_name: 'Technical Issues',
  description: 'System failures, hardware issues, and technical problems',
  display_order: 1
}
```

#### Categories
Add `display_order` and ensure `channel_id` is set:
```javascript
{
  category_name: 'Hardware',
  channel_id: '<channel_uuid>',
  display_order: 1,
  created_by: '<user_uuid>'
}
```

#### Service Categories
Add `display_order`:
```javascript
{
  category_name: 'Managed Services',
  description: 'Ongoing managed service offerings',
  display_order: 1
}
```

### 3. UI Updates

The UI components are automatically updated with the migration. No manual changes needed.

### 4. Verify Installation

After migration:

1. Navigate to **Settings** → **General** → **Ticketing Settings**
2. Check each tab has the "Import from Standard Types" button
3. Verify existing data has proper display orders
4. Test importing a few standard items

## Breaking Changes

### Required Fields

The following fields are now required:

1. **Categories**
   - `channel_id` - Every category must belong to a channel
   - `created_by` - User who created the category

2. **All Reference Types**
   - `display_order` - Defaults to 0 if not specified

### API Changes

If you have custom API integrations:

1. **Category Creation** - Must include `channel_id`
2. **Import Endpoints** - New endpoints available:
   - `POST /api/reference-data/available`
   - `POST /api/reference-data/check-conflicts`
   - `POST /api/reference-data/import`

## Rollback Procedure

If you need to rollback:

```bash
npm run db:migrate:rollback
```

This will:
- Drop all `standard_*` tables
- Remove `display_order` columns
- Remove `description` from channels

**Warning**: Rollback will lose any imported standard data.

## Post-Migration Tasks

### 1. Review Display Orders

The migration assigns sequential orders to existing data. Review and adjust if needed:

1. Go to each reference data settings page
2. Review the order column
3. Edit items to adjust ordering

### 2. Import Standard Data

Take advantage of pre-defined configurations:

1. Click "Import from Standard Types"
2. Select relevant items for your organization
3. Resolve any conflicts
4. Customize as needed

### 3. Update Documentation

Update your internal documentation to reflect:
- New import functionality
- Category channel requirements
- Display order management

## Troubleshooting

### Migration Fails

**Error: "column already exists"**
- The migration may have partially completed
- Check which tables were created
- Manually drop partial tables and re-run

**Error: "null value in column 'created_by'"**
- Ensure all categories have a valid created_by user
- Update existing records before migration

### Import Issues

**"No standard items available"**
- Verify migration completed successfully
- Check standard tables have data:
  ```sql
  SELECT COUNT(*) FROM standard_channels;
  SELECT COUNT(*) FROM standard_categories;
  ```

**Import fails with constraint errors**
- Check tenant context is set
- Verify user has appropriate permissions
- Review server logs for detailed errors

### Performance Concerns

The standard tables are relatively small and indexed appropriately. If you experience performance issues:

1. Check indexes are created:
   ```sql
   \d standard_categories
   ```

2. Analyze query performance:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM standard_categories WHERE ...
   ```

## Best Practices

### For New Installations

1. Run migrations before seeding
2. Use import functionality instead of manual entry
3. Customize after importing

### For Existing Installations

1. Backup database before migration
2. Test in staging environment first
3. Communicate changes to users
4. Plan for training on new features

### Ongoing Maintenance

1. Review standard data with each upgrade
2. Keep display orders logical
3. Document any customizations
4. Use consistent naming conventions

## Support

For issues or questions:

1. Check the [Reference Data Import System](../reference/reference-data-import/reference_data_import_system.md) documentation
2. Review the [Settings Reference Data Guide](../reference/reference-data-import/settings_reference_data_guide.md)
3. Check server logs for detailed error messages
4. Contact support with migration version and error details