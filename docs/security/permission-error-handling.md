# Permission Error Handling

## Overview
The application uses a consistent approach to handle permission-related errors with a distinct visual style to differentiate them from regular errors.

Everything below lives in `@alga-psa/ui/lib/errorHandling`. The old
`server/src/lib/utils/errorHandling` duplicate was deleted — it could not carry an
i18n key, so a permission error routed through it was permanently English.

## Returning a permission error (preferred)

Server actions **return** their errors rather than throwing, so the client keeps a
typed payload instead of a stringified stack:

```typescript
import { permissionError } from '@alga-psa/ui/lib/errorHandling';

if (!(await hasPermission(user, 'tag', 'create'))) {
  return permissionError(
    "You don't have permission to create new tags",
    'msp/tags:errors.createNotAllowed'
  );
}
```

The second argument is a namespaced i18n key. `withAuth` / `withOptionalAuth`
localize the payload on the way out (`localizeActionError`), so nothing at the
render site changes and the call site stays synchronous. Omit the key and the
message stays English — no behaviour change for un-migrated actions.

`actionError(message, key?, params?)` is the same channel for non-permission
failures.

## Error Handling Utility

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
   - Checks the error's `PERMISSION_DENIED` code, not its prose
   - Returns boolean
   - Matching on the English text (`.includes('Permission denied')`) is a bug: a
     localized message no longer contains it

3. **`useErrorHandler()`**
   - React hook that provides error handling utilities

### Server-side Functions

1. **`throwPermissionError(action, additionalInfo?)`**
   - Throws a `CodedError` carrying the `PERMISSION_DENIED` code
   - Message format: "Permission denied: You don't have permission to [action]. [additionalInfo]"
   - Legacy path: the thrown message cannot be translated. Prefer returning
     `permissionError(message, key)` from the action.

## Usage Examples

### In Components

```typescript
import { handleError } from '@alga-psa/ui/lib/errorHandling';

try {
  await createTag({ ... });
} catch (error) {
  handleError(error, 'Failed to add tag');
}
```

### In Server Actions

```typescript
import { throwPermissionError } from '@alga-psa/ui/lib/errorHandling';

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
5. **Translatable**: the key travels with the payload, so the boundary can render
   the message in the user's language
