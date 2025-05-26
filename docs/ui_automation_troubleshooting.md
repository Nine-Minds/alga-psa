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

- [ ] Automation server is running on port 4000
- [ ] WebSocket connection is established
- [ ] Components use `useAutomationIdAndRegister` hook
- [ ] Import paths are correct
- [ ] ReflectionContainer wraps main content
- [ ] Component metadata updates with state changes
- [ ] Parent-child relationships are properly established
- [ ] No duplicate component IDs exist
- [ ] Browser console shows no UI reflection errors

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
   - [Development Guide](development_guide.md)

4. **Report Issues:**
   Include debug information and reproduction steps when reporting problems.

## Related Documentation

- [UI Reflection System](ui_reflection_system.md) - Core system documentation
- [UI Automation IDs](ui_automation_ids.md) - ID conventions and standards
- [Development Guide](development_guide.md) - General development practices