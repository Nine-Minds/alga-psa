# Tag Permissions Requirements

## Overview
This document outlines the permission requirements for tag functionality in the system. The permissions are based on a combination of tagged entity permissions and tag-specific permissions.

## Permission Matrix

### 1. View Tags
**Action**: Display tags on an entity  
**Required Permissions**: 
- Read permission for the tagged entity (e.g., `ticket:read`, `project:read`, `company:read`)

### 2. Create New Tag
**Action**: Create a brand new tag with custom text  
**Required Permissions**:
- Update permission for the tagged entity (e.g., `ticket:update`, `project:update`)
- `tag:create` permission

### 3. Add Existing Tag
**Action**: Select and add a tag from the suggestion dropdown  
**Required Permissions**:
- Update permission for the tagged entity (e.g., `ticket:update`, `project:update`)
- Note: `tag:create` permission is NOT required for adding existing tags

### 4. Edit Tag Properties
**Action**: Modify tag text or colors  
**Required Permissions**:
- Update permission for the tagged entity
- `tag:update` permission

### 5. Delete Single Tag
**Action**: Remove a single tag from an entity  
**Required Permissions**:
- Update permission for the tagged entity
- **Additional Check**: User can only delete tags they created (requires `created_by` field)
- **Note**: Legacy tags without `created_by` can be deleted by anyone with entity update permission

### 6. Delete All Tags
**Action**: Remove all instances of a tag across entities (Delete All button)  
**Required Permissions**:
- Update permission for the tagged entity
- `tag:delete` permission

## Entity Type Mapping

The `tagged_type` field in `tag_definitions` table maps to the following entities:

| tagged_type | Required Entity Permission |
|-------------|---------------------------|
| company | `company:[action]` |
| contact | `contact:[action]` |
| ticket | `ticket:[action]` |
| project | `project:[action]` |
| project_task | `project_task:[action]` |
| workflow_form | `workflow_form:[action]` |

## Implementation Notes

### Implementation Approach
- Permission checks are implemented server-side in tag actions
- Follows the existing pattern used throughout the application (e.g., ticket actions)
- Uses `hasPermission` from the RBAC module with user, resource, and action parameters
- Throws descriptive error messages when permissions are denied

### Updated Data
- The `created_by` column is now populated for new tag mappings
- The `Tag.insert` method accepts an optional userId parameter
- The `createTag` action gets the current user and passes it to Tag.insert

### User Experience
- When a user lacks permissions, actions throw errors with clear messages
- Client-side components should handle these errors and display appropriate feedback
- The TagContext handles permission errors and shows toast notifications

### Updated Actions
All tag actions now include permission checks:
1. `createTag` - Checks entity update permission; tag create permission only required for new tags
2. `updateTag` - Checks entity update + tag update permissions  
3. `deleteTag` - Checks entity update + verifies user created the tag
4. `updateTagColor` - Checks entity update + tag update permissions
5. `updateTagText` - Checks entity update + tag update permissions
6. `deleteAllTagsByText` - Checks entity update + tag delete permissions

### Error Handling Pattern
```typescript
if (!await hasPermission(currentUser, entityResource, 'update', trx)) {
  throw new Error(`Permission denied: Cannot update ${tag.tagged_type.replace('_', ' ')}`);
}
```