# UI Reflection System

## Overview

The UI Reflection System provides a live, high-level JSON description of the application's UI state, enabling automated testing, LLM-driven interactions, and real-time UI state monitoring. The system captures information about buttons, dialogs, forms, data grids, and other UI components, making the application's interface programmatically observable and controllable.

## Key Features

- **Live UI State**: Real-time JSON representation of UI components and their states
- **Stable Component IDs**: Consistent identifiers for reliable automated testing
- **Type Safety**: Full TypeScript support for component definitions
- **Automatic State Updates**: Components self-report their state changes
- **WebSocket Broadcasting**: UI state changes are broadcast for external tools
- **Minimal Boilerplate**: Easy integration with existing components

## Architecture

The system follows a client-server architecture with three main components:

```
Browser (React App) -> AI Backend Server -> External Consumers (LLM/Automation)
```

1. **React Client Components**:
   - **Type System** (`types.ts`):
     * Defines interfaces for UI components
     * Provides type safety and documentation
     * Extensible for custom component types

   - **State Aggregator** (`UIStateContext.tsx`):
     * Maintains the global UI state
     * Handles component registration
     * Manages state updates
     * Connects to AI Backend Server via Socket.IO
     * Emits real-time state changes

   - **Registration Hooks** (`useRegisterUIComponent.ts`):
     * Enables component self-registration
     * Handles lifecycle management
     * Provides state update utilities

2. **AI Backend Server** (`tools/ai-automation/src/index.ts`):
   - Runs on port 4000
   - Receives UI state updates from React client
   - Broadcasts updates to connected automation tools/LLMs
   - Integrates with Puppeteer for browser automation
   - Handles WebSocket connections and lifecycle

3. **External Consumers**:
   - Connect to AI Backend Server via WebSocket
   - Receive real-time UI state updates
   - Can be test harnesses, LLM agents, or monitoring tools
   - Use stable component IDs for automation

### Communication Flow

1. **Component Registration**:
   ```
   React Component -> UIStateContext -> Socket.IO -> AI Backend Server
   ```

2. **State Updates**:
   ```
   Component State Change -> UIStateContext -> Socket.IO -> AI Backend Server -> External Consumers
   ```

3. **Automation**:
   ```
   LLM/Test Tool -> AI Backend Server -> Puppeteer -> Browser
   ```

## WebSocket Integration

### 1. React Client to AI Backend

The UIStateContext automatically:
- Connects to the AI Backend Server on mount
- Handles connection lifecycle and reconnection
- Emits state updates when components change

```typescript
// Internal Socket.IO connection (handled by UIStateContext)
const socket = io('http://localhost:4000', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

// Automatic state emission
socket.emit('UI_STATE_UPDATE', pageState);
```

### 2. External Consumer Connection

Connect to the AI Backend Server to receive UI state updates:

```typescript
// Example Socket.IO consumer
const socket = io('http://localhost:4000');

socket.on('UI_STATE_UPDATE', (pageState) => {
  console.log('Current UI State:', {
    pageId: pageState.id,
    title: pageState.title,
    componentCount: pageState.components.length
  });
  
  // Handle the update (e.g., run automation, update monitoring)
  handleUIStateUpdate(pageState);
});
```

## Implementation Guide

### 1. Setting Up the Provider

Wrap your application or specific pages with the UIStateProvider:

```tsx
import { UIStateProvider } from '../types/ui-reflection/UIStateContext';

function App() {
  return (
    <UIStateProvider
      initialPageState={{
        id: 'main-app',
        title: 'My Application',
        components: []
      }}
    >
      <YourAppContent />
    </UIStateProvider>
  );
}
```

### 2. Augmenting Components

#### Basic Component Registration

Use the `useRegisterUIComponent` hook to register any UI component:

```tsx
import { useRegisterUIComponent } from '../types/ui-reflection/useRegisterUIComponent';
import { ButtonComponent } from '../types/ui-reflection/types';

function ActionButton({ label, disabled, onClick }: Props) {
  const updateMetadata = useRegisterUIComponent<ButtonComponent>({
    id: 'action-button',
    type: 'button',
    label,
    disabled,
    actions: ['click']
  });

  // Update metadata when props change
  useEffect(() => {
    updateMetadata({ label, disabled });
  }, [label, disabled, updateMetadata]);

  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
```

#### Automatic Props Synchronization

For simpler cases, use `useRegisterUIComponentWithProps`:

```tsx
function SubmitButton({ label, disabled }: Props) {
  useRegisterUIComponentWithProps<ButtonComponent>(
    {
      id: 'submit-button',
      type: 'button',
      label,
      disabled
    },
    { label, disabled } // These props will automatically sync
  );

  return <button type="submit">{label}</button>;
}
```

### 3. Complex Components

#### Dialogs

```tsx
function ConfirmDialog({ isOpen, title, onConfirm, onCancel }: Props) {
  useRegisterUIComponentWithProps<DialogComponent>(
    {
      id: 'confirm-dialog',
      type: 'dialog',
      title,
      open: isOpen,
      content: [
        {
          id: 'confirm-button',
          type: 'button',
          label: 'Confirm',
          actions: ['click']
        },
        {
          id: 'cancel-button',
          type: 'button',
          label: 'Cancel',
          actions: ['click']
        }
      ]
    },
    { open: isOpen }
  );

  return (
    <Dialog open={isOpen}>
      <h2>{title}</h2>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </Dialog>
  );
}
```

#### Forms

```tsx
function LoginForm({ onSubmit }: Props) {
  const [values, setValues] = useState({ username: '', password: '' });

  useRegisterUIComponentWithProps<FormComponent>(
    {
      id: 'login-form',
      type: 'form',
      fields: [
        {
          id: 'username',
          type: 'textField',
          label: 'Username',
          value: values.username,
          required: true
        },
        {
          id: 'password',
          type: 'textField',
          label: 'Password',
          value: values.password,
          required: true
        }
      ]
    },
    { fields: [/* updated field values */] }
  );

  return (
    <form onSubmit={onSubmit}>
      {/* form fields */}
    </form>
  );
}
```

## Best Practices

1. **Component IDs**:
   - Use descriptive, hierarchical IDs (e.g., 'user-settings-save-button')
   - Keep IDs stable across renders
   - Make IDs unique within their context

2. **State Updates**:
   - Only update metadata for props that affect the UI state
   - Avoid unnecessary updates
   - Use the convenience hook when possible

3. **Type Safety**:
   - Always provide specific component types to hooks
   - Define proper interfaces for custom components
   - Validate component type changes

4. **Performance**:
   - Use memoization for complex metadata
   - Only register components that need external visibility
   - Clean up properly in unmount handlers

5. **WebSocket Communication**:
   - Handle connection errors gracefully
   - Implement reconnection logic
   - Consider message throttling for high-frequency updates
   - Validate message formats

6. **Security Considerations**:
   - Restrict WebSocket connections to trusted sources
   - Validate UI state updates
   - Consider authentication for external consumers
   - Monitor for suspicious patterns

## Use Cases

### 1. Automated Testing

```typescript
// Example test using Socket.IO connection
test('submit button enables when form is valid', async () => {
  const socket = io('http://localhost:4000');
  
  // Wait for UI state update
  const pageState = await new Promise(resolve => {
    socket.once('UI_STATE_UPDATE', resolve);
  });
  
  const submitButton = pageState.components.find(
    c => c.id === 'submit-button'
  );
  expect(submitButton.disabled).toBe(false);
  
  socket.close();
});
```

### 2. LLM Integration

```typescript
// Example LLM automation using Socket.IO
const socket = io('http://localhost:4000');

socket.on('UI_STATE_UPDATE', async (pageState) => {
  // Analyze UI state with LLM
  const actions = await llm.analyze(pageState);
  
  // Execute actions through Puppeteer API
  for (const action of actions) {
    await fetch('http://localhost:4000/api/puppeteer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: action })
    });
  }
});
```

### 3. UI State Monitoring

```typescript
// Example Socket.IO monitoring
const socket = io('http://localhost:4000');

socket.on('UI_STATE_UPDATE', (pageState) => {
  console.log('Current UI State:', {
    pageId: pageState.id,
    title: pageState.title,
    componentCount: pageState.components.length
  });
  
  // Record metrics or trigger automation
  metrics.record(pageState);
  automationSystem.analyze(pageState);
});
```

## Troubleshooting

Common issues and solutions:

1. **Component Not Appearing in State**:
   - Verify the component is wrapped in UIStateProvider
   - Check that useRegisterUIComponent is called
   - Ensure proper cleanup on unmount

2. **Type Errors**:
   - Confirm component type matches interface
   - Check for required properties
   - Verify generic type parameters

3. **Performance Issues**:
   - Reduce update frequency
   - Memoize complex metadata
   - Only register necessary components

## Future Enhancements

Planned improvements:

1. Component action handlers
2. State persistence
3. Time-travel debugging
4. Component relationship tracking
5. Automated accessibility checking

## Augmenting Existing Components

When adding UI reflection capabilities to existing components, follow these patterns based on the component type:

### 1. Basic Components (e.g., Button)

For simple components that maintain minimal state:

```tsx
// Before
interface ButtonProps {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  variant?: string;
}

// After
interface ButtonProps {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  variant?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ id, label, disabled, variant, ...props }, ref) => {
    // Register with UI reflection system if id is provided
    const updateMetadata = id ? useRegisterUIComponent<ButtonComponent>({
      type: 'button',
      id,
      label,
      disabled,
      variant,
      actions: ['click']
    }) : undefined;

    // Update metadata when disabled state changes
    useEffect(() => {
      if (updateMetadata && disabled !== undefined) {
        updateMetadata({ disabled });
      }
    }, [disabled, updateMetadata]);

    return (
      <button
        ref={ref}
        disabled={disabled}
        data-automation-id={id}
        {...props}
      >
        {label}
      </button>
    );
  }
);
```

Key points:
- Make UI reflection opt-in via optional id prop
- Add data-automation-id for testing
- Update metadata when relevant props change
- Preserve existing functionality

### 2. Stateful Components (e.g., Dialog)

For components that manage internal state:

```tsx
interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Content components for UI reflection */
  content?: DialogComponent['content'];
}

export const Dialog: React.FC<DialogProps> = ({ 
  isOpen, onClose, title, id, content, children 
}) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = id ? useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id,
    title: title || '',
    open: isOpen,
    content,
    actions: ['submit', 'cancel']
  }) : undefined;

  // Update metadata when open state changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({ open: isOpen });
    }
  }, [isOpen, updateMetadata]);

  return (
    <DialogRoot open={isOpen} data-automation-id={id}>
      {/* Dialog content */}
    </DialogRoot>
  );
};
```

Key points:
- Track component state in reflection system
- Update metadata on state changes
- Allow passing child components for reflection

### 3. Form Components (e.g., Input)

For form fields that need to track value changes:

```tsx
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the field is required */
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ id, label, value, disabled, required, ...props }, ref) => {
    // Register as a form component with a single field
    const updateMetadata = id ? useRegisterUIComponent<FormComponent>({
      type: 'form',
      id,
      label,
      disabled,
      actions: ['type'],
      fields: [{
        type: 'textField',
        id: `${id}-field`,
        label,
        value: typeof value === 'string' ? value : undefined,
        disabled,
        required
      }]
    }) : undefined;

    // Update metadata when value or field props change
    useEffect(() => {
      if (updateMetadata && typeof value === 'string') {
        updateMetadata({
          fields: [{
            type: 'textField',
            id: `${id}-field`,
            label,
            value,
            disabled,
            required
          }]
        });
      }
    }, [value, label, disabled, required, id, updateMetadata]);

    return (
      <input
        ref={ref}
        data-automation-id={id}
        {...props}
        value={value}
        disabled={disabled}
        required={required}
      />
    );
  }
);
```

Key points:
- Handle form field value updates
- Maintain proper typing with InputHTMLAttributes
- Structure as a single-field form component
- Preserve HTML input attributes and behavior

### Best Practices for Augmentation

1. **Opt-in Registration**:
   - Make UI reflection optional via id prop
   - Only register and update when id is provided
   - Maintain backward compatibility

2. **Type Safety**:
   - Extend existing prop interfaces carefully
   - Handle optional props appropriately
   - Ensure proper typing with HTML attributes

3. **State Updates**:
   - Update metadata only when relevant props change
   - Group related updates together
   - Consider performance implications

4. **Testing Support**:
   - Add data-automation-id attributes
   - Maintain consistent id patterns
   - Document component reflection behavior

5. **Existing Functionality**:
   - Preserve all current features
   - Maintain ref forwarding if present
   - Keep existing event handlers

## Contributing

To extend the system:

1. Add new component types to `types.ts`
2. Update documentation
3. Add test coverage
4. Submit PR with examples
