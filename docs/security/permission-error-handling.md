# Permission Error Handling

## Overview
The application uses a consistent approach to handle permission-related errors with a distinct visual style to differentiate them from regular errors.

## Error Handling Utility

The `errorHandling.ts` utility provides:

### Client-side Functions

1. **`handleError(error, fallbackMessage?)`**
   - Automatically detects permission errors
   - Shows permission errors with:
     - ShieldAlert icon (from Lucide)
     - Light red background (#FEF2F2)
     - Dark red text (#991B1B)
     - Red border (#FCA5A5)
     - Longer duration (5 seconds)
   - Shows regular errors with default toast styling

2. **`isPermissionError(error)`**
   - Checks if an error message contains "Permission denied"
   - Returns boolean

3. **`useErrorHandler()`**
   - React hook that provides error handling utilities

### Server-side Functions

1. **`throwPermissionError(action, additionalInfo?)`**
   - Throws consistent permission errors
   - Format: "Permission denied: You don't have permission to [action]. [additionalInfo]"

## Usage Examples

### In Components

```typescript
import { handleError } from 'server/src/lib/utils/errorHandling';

try {
  await createTag({ ... });
} catch (error) {
  handleError(error, 'Failed to add tag');
}
```

### In Server Actions

```typescript
import { throwPermissionError } from 'server/src/lib/utils/errorHandling';

if (!await hasPermission(user, 'tag', 'create')) {
  throwPermissionError('create new tags', 'You can only select from existing tags');
}
```

## Visual Examples

### Permission Error
- Message: "Permission denied: You don't have permission to create new tags. You can only select from existing tags"
- Icon: ShieldAlert (Lucide icon in red)
- Background: Light red
- Duration: 5 seconds
- Style: Prominent border and coloring

### Regular Error
- Message: "Failed to add tag"
- Icon: Default error icon
- Background: Default toast background
- Duration: Default (3 seconds)
- Style: Standard error toast

## Benefits

1. **Consistency**: All permission errors look the same across the app
2. **Clarity**: Users immediately know when an action failed due to permissions
3. **Helpfulness**: Permission errors often include additional context
4. **Maintainability**: Single place to update permission error styling