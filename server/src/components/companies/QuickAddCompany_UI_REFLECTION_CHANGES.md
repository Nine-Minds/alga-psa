# QuickAddCompany UI Reflection Integration

## Changes Made

### 1. Added UI Reflection Imports
- `useAutomationIdAndRegister` hook
- `ReflectionContainer` component  
- `DialogComponent` type

### 2. Added State Management
- Added `error` state for error tracking
- Properly reset error state when dialog opens/closes

### 3. Dialog Registration
```typescript
const { automationIdProps: dialogProps, updateMetadata } = useAutomationIdAndRegister<DialogComponent>({
  id: 'quick-add-company-dialog',
  type: 'dialog', 
  label: 'Quick Add Company Dialog',
  helperText: "",
  title: 'Add New Client',
});
```

### 4. Metadata Updates
- Added useEffect to update dialog metadata when state changes (open/closed, error states)
- Updates helperText with error messages
- Updates open state

### 5. Form Container
- Wrapped form content in `ReflectionContainer` with ID `quick-add-company-form`
- Applied automation ID props to Dialog component

### 6. Error Handling
- Enhanced error handling to set error state for UI reflection
- Clear errors when dialog opens

## UI Reflection Benefits

The QuickAddCompany dialog will now:
- Appear in the UI state JSON with proper identification
- Report its open/closed state
- Report error messages through helperText
- Have consistent automation IDs for testing
- Be properly nested in the component hierarchy

## Testing

The dialog should now be visible in the UI reflection system and can be:
- Located by automation tools using `quick-add-company-dialog` ID
- Monitored for state changes (open/closed)
- Checked for error states via helperText property