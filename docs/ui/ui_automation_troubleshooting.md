# UI Automation Troubleshooting Guide

## Overview

This guide helps troubleshoot common issues with the UI Automation and Reflection system. It covers problems with component registration, UI state visibility, automation server connectivity, and debugging techniques.

## Quick Diagnostic Tools

### 1. UI State Dump Tool

Use the built-in UI state dump tool to inspect current component registration:

```bash
# From the ai-automation directory
cd tools/ai-automation
node ./dump-ui-state.js

# Options:
node ./dump-ui-state.js --json        # JSON output
node ./dump-ui-state.js --count       # Component count only
node ./dump-ui-state.js --components-only  # Components without tree structure
```

### 2. Claude Code Slash Command

Use the `/ui-state` command in Claude Code to get automated analysis:

```
/ui-state
```

This will run the dump tool and provide AI-powered analysis of your UI state.

### 3. Browser Console Logging

Enable detailed logging by checking browser console for UI reflection messages:
- `🔄 [UI-STATE]` - Component registration updates
- `🔌 [WEBSOCKET]` - WebSocket connection status
- `📡 [UI_STATE_UPDATE]` - State change broadcasts

## Common Issues and Solutions

### Issue 1: Components Not Showing in UI State

**Symptoms:**
- UI state dump shows only sidebar/navigation components
- Screen-specific components are missing
- Empty or minimal component count

**Root Causes & Solutions:**

#### A. Missing UI Reflection Integration

**Problem:** Component doesn't use `useAutomationIdAndRegister` hook.

**Solution:** Add UI reflection to the component:

```tsx
// Before: No UI reflection
function MyComponent() {
  return (
    <div>
      <button id="my-button">Click me</button>
    </div>
  );
}

// After: With UI reflection
function MyComponent() {
  const { automationIdProps } = useAutomationIdAndRegister({
    id: 'my-component',
    type: 'container',
    label: 'My Component'
  });

  const { automationIdProps: buttonProps } = useAutomationIdAndRegister({
    id: 'my-button',
    type: 'button',
    label: 'Click me'
  });

  return (
    <ReflectionContainer {...automationIdProps}>
      <div>
        <button {...buttonProps}>Click me</button>
      </div>
    </ReflectionContainer>
  );
}
```

#### B. Incorrect Import Paths

**Problem:** Import paths are wrong, causing hook to be undefined.

**Error Message:**
```
TypeError: useAutomationIdAndRegister is not a function
```

**Solution:** Use correct import paths:

```tsx
// Correct imports
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
```

#### C. Missing ReflectionContainer Wrapper

**Problem:** Components are registered but not properly nested.

**Solution:** Wrap main content with ReflectionContainer:

```tsx
function PageComponent() {
  const { automationIdProps: pageProps } = useAutomationIdAndRegister({
    id: 'my-page',
    type: 'container',
    label: 'My Page'
  });

  return (
    <ReflectionContainer {...pageProps}>
      {/* All page content goes here */}
      <div className="page-content">
        {/* ... */}
      </div>
    </ReflectionContainer>
  );
}
```

### Issue 2: Automation Server Connection Problems

**Symptoms:**
- `dump-ui-state.js` returns connection errors
- WebSocket connection failures in browser console
- UI state not updating in real-time

**Diagnostic Steps:**

1. **Check Automation Server Status:**
```bash
# Check if automation server is running
curl http://localhost:4000/api/ui-state
```

2. **Verify Server Logs:**
```bash
# In the main project directory
docker-compose logs | grep automation
```

3. **Check WebSocket Connection:**
Open browser console and look for:
```
[WEBSOCKET] 🔌 Client connected
[WEBSOCKET] 📡 UI_STATE_UPDATE received
```

**Solutions:**

#### A. Start Automation Server

```bash
# Start the automation server
cd tools/ai-automation
npm start
```

#### B. Check Port Conflicts

If port 4000 is in use, update configuration:
```bash
# Check what's using port 4000
lsof -i :4000

# Kill conflicting process if needed
kill -9 <PID>
```

#### C. Restart Docker Services

```bash
# Restart all services
docker-compose down
docker-compose up -d
```

### Issue 3: UI State Not Updating

**Symptoms:**
- Components show in initial dump but don't update
- State changes not reflected in UI state
- Stale component metadata

**Root Causes & Solutions:**

#### A. Missing Metadata Updates

**Problem:** Component state changes but metadata isn't updated.

**Solution:** Use `updateMetadata` function:

```tsx
function DynamicButton({ label, disabled }) {
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister({
    id: 'dynamic-button',
    type: 'button',
    label,
    disabled
  });

  // Update metadata when props change
  useEffect(() => {
    updateMetadata({ label, disabled });
  }, [label, disabled, updateMetadata]);

  return <button {...automationIdProps}>{label}</button>;
}
```

#### B. Module Instance Mismatch

**Problem:** Different UIStateManager instances in different processes.

**Solution:** Ensure automation server is used as source of truth:
- Use HTTP API endpoints instead of direct module access
- Verify WebSocket connections are active
- Check for multiple server instances

### Issue 4: Component Hierarchy Issues

**Symptoms:**
- Components appear as root-level instead of nested
- Parent-child relationships are incorrect
- Auto-generated IDs are wrong

**Solutions:**

#### A. Proper Context Usage

```tsx
// Correct: Parent sets context for children
function ParentContainer() {
  const { automationIdProps } = useAutomationIdAndRegister({
    id: 'parent-container',
    type: 'container',
    label: 'Parent'
  });

  return (
    <ReflectionContainer {...automationIdProps}>
      {/* Children inherit parent context automatically */}
      <ChildComponent />  {/* Will be parent-container-child */}
    </ReflectionContainer>
  );
}

function ChildComponent() {
  // No explicit parentId needed - inherited from context
  const { automationIdProps } = useAutomationIdAndRegister({
    type: 'button',
    label: 'Child Button'
  });

  return <button {...automationIdProps}>Click</button>;
}
```

#### B. ID Naming Conventions

Follow consistent naming patterns:
- Screen/Page: `my-screen`
- Subcontainer: `${parentId}-section` (e.g., `my-screen-filters`)
- Component: `${parentId}-type` (e.g., `my-screen-filters-select`)

### Issue 5: Form Field Naming and Override ID Support

**Symptoms:**
- Form fields show generic auto-generated names like `formField-1`, `formField-2`
- Meaningful field names like `email`, `phone_no` are not appearing
- Components ignore `data-automation-id` attributes

**Root Causes & Solutions:**

#### A. Missing Override ID Support

**Problem:** Components auto-generate IDs instead of using provided `data-automation-id`.

**Solution:** Implement the override ID pattern in form components:

```tsx
// Enhanced useAutomationIdAndRegister with override support
export function useAutomationIdAndRegister<T extends UIComponent>(
  component: Omit<T, 'id'> & { id?: string },
  shouldRegister: boolean = true,
  overrideId?: string  // Third parameter for override ID
): {
  automationIdProps: { id: string; 'data-automation-id': string };
  updateMetadata: (partial: Partial<T>) => void;
}

// In form components (Input, CustomSelect, TextArea):
const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
  type: 'formField',
  fieldType: 'textField',
  id,
  label
}, true, dataAutomationId);  // Pass override ID as third parameter
```

#### B. Implementing Override ID Pattern in Components

**Solution:** Update form components to support `data-automation-id`:

```tsx
// Before: No override support
export const Input = forwardRef<HTMLInputElement, InputProps & AutomationProps>(
  ({ label, id, ...props }, ref) => {
    const { automationIdProps } = useAutomationIdAndRegister({
      id,
      type: 'formField',
      fieldType: 'textField'
    });
    
    return <input {...automationIdProps} {...props} />;
  }
);

// After: With override support
export const Input = forwardRef<HTMLInputElement, InputProps & AutomationProps>(
  ({ label, id, "data-automation-id": dataAutomationId, ...props }, ref) => {
    const { automationIdProps } = useAutomationIdAndRegister({
      id,
      type: 'formField', 
      fieldType: 'textField'
    }, true, dataAutomationId);  // Pass override ID
    
    return <input {...automationIdProps} {...props} />;
  }
);
```

#### C. Usage Pattern for Meaningful Field Names

**Solution:** Use `data-automation-id` for meaningful form field names:

```tsx
// Form with meaningful field names
function MyForm() {
  return (
    <form>
      <Input 
        data-automation-id="company-name-input"
        label="Company Name"
        value={formData.companyName}
        onChange={(e) => setFormData({...formData, companyName: e.target.value})}
      />
      <CustomSelect
        data-automation-id="client_type_select"
        label="Client Type"
        options={clientTypeOptions}
        value={formData.clientType}
        onValueChange={(value) => setFormData({...formData, clientType: value})}
      />
      <TextArea
        data-automation-id="notes"
        label="Notes"
        value={formData.notes}
        onChange={(e) => setFormData({...formData, notes: e.target.value})}
      />
    </form>
  );
}
```

### Issue 6: Dialog Type Registration Problems

**Symptoms:**
- Dialogs appear as `Type: container` instead of `Type: dialog`
- Dialog `open` property is missing from UI state
- Dialog actions (submit/cancel) are not available

**Root Causes & Solutions:**

#### A. Incorrect Dialog Wrapper Usage

**Problem:** Using `ReflectionContainer` wrapper makes dialogs appear as containers.

**Solution:** Use `withDataAutomationId` directly on dialog content:

```tsx
// Before: Shows as Type: container
function MyDialog({ open, onOpenChange }) {
  const { automationIdProps } = useAutomationIdAndRegister({
    id: 'my-dialog',
    type: 'dialog',
    title: 'My Dialog'
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ReflectionContainer {...automationIdProps}>
          {/* Dialog content */}
        </ReflectionContainer>
      </DialogContent>
    </Dialog>
  );
}

// After: Shows as Type: dialog
function MyDialog({ open, onOpenChange }) {
  const { automationIdProps: updateDialog } = useAutomationIdAndRegister<DialogComponent>({
    id: 'my-dialog',
    type: 'dialog',
    title: 'My Dialog',
    open
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...withDataAutomationId(updateDialog)}
        className="..."
      >
        <ReflectionParentContext.Provider value={updateDialog.id}>
          {/* Dialog content */}
        </ReflectionParentContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
```

#### B. Missing Dialog State Updates

**Solution:** Update dialog metadata when state changes:

```tsx
// Update dialog metadata when open state changes
useEffect(() => {
  if (updateMetadata) {
    updateMetadata({ open });
  }
}, [open, updateMetadata]);
```

### Issue 7: Double Registration Prevention

**Symptoms:**
- Duplicate components appearing in UI state
- Form fields registered both by parent and themselves
- Generic IDs mixed with meaningful names

**Root Causes & Solutions:**

#### A. Parent and Child Both Registering

**Problem:** Parent component and form components both call `useAutomationIdAndRegister`.

**Solution:** Remove duplicate registrations from parent component:

```tsx
// Before: Double registration
function QuickAddForm() {
  // DON'T: Register fields at parent level
  const { automationIdProps: emailProps } = useAutomationIdAndRegister({
    id: 'email',
    type: 'formField',
    fieldType: 'textField',
    parentId: 'my-form'
  });

  return (
    <form>
      <Input {...emailProps} />  {/* Input also registers itself */}
    </form>
  );
}

// After: Single registration with override ID
function QuickAddForm() {
  return (
    <form>
      <Input data-automation-id="email" />  {/* Only Input registers */}
    </form>
  );
}
```

#### B. Conditional Registration Pattern

**Solution:** Use conditional registration to prevent duplicates:

```tsx
// In form components, check for data-automation-id
const shouldRegister = !dataAutomationId;
const { automationIdProps } = useAutomationIdAndRegister({
  type: 'formField',
  fieldType: 'textField',
  id: shouldRegister ? id : undefined
}, shouldRegister, dataAutomationId);
```

### Issue 8: Hook Parameter Debugging

**Symptoms:**
- `useAutomationIdAndRegister` behaves unexpectedly
- Parameters not being passed correctly
- Function receiving default values instead of provided ones

**Debugging Steps:**

#### A. Verify Function Signature

**Check:** Ensure you're passing parameters in the correct order:

```tsx
// Correct parameter order
useAutomationIdAndRegister<T>(
  component: Omit<T, 'id'> & { id?: string },
  shouldRegister: boolean = true,
  overrideId?: string
)

// Common mistake: Missing shouldRegister parameter
// WRONG:
const { automationIdProps } = useAutomationIdAndRegister({
  type: 'formField',
  fieldType: 'textField'
}, dataAutomationId);  // Missing shouldRegister parameter

// CORRECT:
const { automationIdProps } = useAutomationIdAndRegister({
  type: 'formField',
  fieldType: 'textField'
}, true, dataAutomationId);  // All parameters provided
```

#### B. Add Debug Logging

**Solution:** Add logging to verify parameter values:

```tsx
const { automationIdProps } = useAutomationIdAndRegister({
  type: 'formField',
  fieldType: 'textField',
  id
}, shouldRegister, dataAutomationId);

console.log('🔍 Hook params:', { shouldRegister, dataAutomationId, id });
console.log('🔍 Generated props:', automationIdProps);
```

### Issue 9: Raw HTML Elements vs UI Components

**Symptoms:**
- Some form fields not appearing in UI state
- Mixed registration patterns in the same component
- Inconsistent automation ID application

**Root Causes & Solutions:**

#### A. Raw HTML Elements Don't Auto-Register

**Problem:** Using raw `<input>`, `<select>`, `<textarea>` elements.

**Solution:** Replace with UI reflection components:

```tsx
// Before: Raw HTML elements (invisible to UI reflection)
function UserPicker() {
  return (
    <div className="dropdown">
      <div className="search">
        <input  // This won't appear in UI state
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
    </div>
  );
}

// After: Using UI reflection components
function UserPicker({ "data-automation-id": dataAutomationId }) {
  return (
    <div className="dropdown">
      <div className="search">
        <Input  // This will appear in UI state
          data-automation-id={dataAutomationId ? `${dataAutomationId}-search` : undefined}
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
    </div>
  );
}
```

#### B. Component Registration Requirements

**Guidelines:**
- Always use UI reflection components (`Input`, `CustomSelect`, `TextArea`, etc.) instead of raw HTML
- Ensure all interactive elements have automation IDs
- Prefer `data-automation-id` for meaningful names over auto-generated IDs

## Debugging Techniques

### 1. Enable Verbose Logging

Add detailed logging to your components:

```tsx
function DebugComponent() {
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister({
    id: 'debug-component',
    type: 'container',
    label: 'Debug Component'
  });

  console.log('🔍 Debug Component Props:', automationIdProps);
  
  useEffect(() => {
    console.log('🔍 Component mounted with ID:', automationIdProps.id);
    return () => {
      console.log('🔍 Component unmounting:', automationIdProps.id);
    };
  }, []);

  return <ReflectionContainer {...automationIdProps}>...</ReflectionContainer>;
}
```

### 2. UI State Monitoring

Set up real-time monitoring of UI state changes:

```javascript
// In browser console
const socket = io('http://localhost:4000');
socket.on('ui_state_update', (state) => {
  console.log('🔄 UI State Update:', state);
});
```

### 3. Component Registration Tracking

Track component registrations in real-time:

```tsx
// Add to UIStateContext for debugging
const registerComponent = useCallback((component: UIComponent) => {
  console.log('📝 Registering component:', component.id, component.type);
  // ... existing registration logic
}, []);
```

### 4. Automation Server Health Check

Create a health check script:

```javascript
// health-check.js
const fetch = require('node-fetch');

async function checkHealth() {
  try {
    const response = await fetch('http://localhost:4000/api/ui-state');
    const data = await response.json();
    console.log('✅ Automation server healthy');
    console.log('📊 Component count:', data.componentCount);
  } catch (error) {
    console.error('❌ Automation server unhealthy:', error.message);
  }
}

checkHealth();
```

## Performance Considerations

### 1. Component Registration Limits

- Only register components that need automation visibility
- Avoid registering every minor UI element
- Use containers to group related elements

### 2. Update Frequency

- Batch state updates when possible
- Debounce rapid state changes
- Use `useMemo` for expensive state calculations

### 3. Memory Management

- Ensure components unregister on unmount
- Clear component hierarchies properly
- Monitor for memory leaks in long-running pages

## Validation Checklist

When troubleshooting UI automation issues, verify:

### Basic Setup
- [ ] Automation server is running on port 4000
- [ ] WebSocket connection is established
- [ ] Components use `useAutomationIdAndRegister` hook
- [ ] Import paths are correct
- [ ] ReflectionContainer wraps main content
- [ ] Browser console shows no UI reflection errors

### Component Registration
- [ ] Component metadata updates with state changes
- [ ] Parent-child relationships are properly established
- [ ] No duplicate component IDs exist
- [ ] Form components use UI reflection components instead of raw HTML

### Form Field Naming
- [ ] Form fields have meaningful names (not `formField-1`, `formField-2`)
- [ ] `data-automation-id` attributes are properly passed to form components
- [ ] Override ID pattern is implemented in form components
- [ ] No duplicate registrations from parent and child components

### Dialog Registration
- [ ] Dialogs appear as `Type: dialog` (not `Type: container`)
- [ ] Dialog `open` property is available in UI state
- [ ] Dialog uses `withDataAutomationId` instead of `ReflectionContainer`
- [ ] Dialog metadata updates when state changes

### Hook Parameter Validation
- [ ] `useAutomationIdAndRegister` receives all parameters in correct order
- [ ] `shouldRegister` parameter is provided when using override IDs
- [ ] `overrideId` parameter is passed as third argument
- [ ] Hook parameters are logged for debugging when issues occur

## Getting Help

If issues persist:

1. **Collect Debug Information:**
   - UI state dump output (`node ./dump-ui-state.js`)
   - Browser console logs
   - Automation server logs
   - Component registration errors

2. **Create Minimal Reproduction:**
   - Isolate the problematic component
   - Create a simple test case
   - Document expected vs. actual behavior

3. **Check Documentation:**
   - [UI Reflection System](ui_reflection_system.md)
   - [UI Automation IDs](ui_automation_ids.md)
   - [Development Guide](../getting-started/development_guide.md)

4. **Report Issues:**
   Include debug information and reproduction steps when reporting problems.

## Related Documentation

- [UI Reflection System](ui_reflection_system.md) - Core system documentation
- [UI Automation IDs](ui_automation_ids.md) - ID conventions and standards
- [Development Guide](../getting-started/development_guide.md) - General development practices