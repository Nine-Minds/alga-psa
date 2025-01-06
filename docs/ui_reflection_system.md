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
- **Hierarchical Structure**: True parent-child relationships between components

## Hierarchical Component Model

The UI reflection system supports a true hierarchical component model, enabling natural representation of nested UI structures:

### 1. Base Component Structure

All components can participate in parent-child relationships:

```typescript
interface BaseComponent {
  id: string;
  type: string;
  label?: string;
  disabled?: boolean;
  actions?: string[];
  parentId?: string;  // Reference to parent component
  children?: UIComponent[];  // Child components
}
```

### 2. Parent-Child Registration

Components can be registered with explicit parent-child relationships:

```typescript
// Register parent form
const updateForm = useRegisterUIComponent<FormComponent>({
  id: 'login-form',
  type: 'form'
});

// Register child field with parent reference
const updateField = useRegisterUIComponent<FormFieldComponent>({
  id: 'email-field',
  type: 'formField',
  fieldType: 'textField',
  parentId: 'login-form'  // Reference to parent
});
```

### 3. State Management

The UIStateContext maintains the complete component hierarchy:

```typescript
// Internal state structure
{
  components: [
    {
      id: 'login-form',
      type: 'form',
      children: [
        {
          id: 'email-field',
          type: 'formField',
          fieldType: 'textField',
          parentId: 'login-form'
        },
        {
          id: 'password-field',
          type: 'formField',
          fieldType: 'textField',
          parentId: 'login-form'
        }
      ]
    }
  ]
}
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

### 2. Component Registration

Use the `useRegisterUIComponent` hook to register any UI component:

```tsx
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

### 3. Form Components

Forms require special attention to maintain proper state synchronization between the form component and its children:

```tsx
function LoginForm({ onSubmit }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Register the form component
  const updateForm = useRegisterUIComponent<FormComponent>({
    id: 'login-form',
    type: 'form',
    label: 'Login'
  });

  // Register individual components with parent reference
  const updateUsernameField = useRegisterUIComponent<FormFieldComponent>({
    id: 'username-field',
    type: 'formField',
    fieldType: 'textField',
    label: 'Username',
    value: username,
    required: true,
    parentId: 'login-form'
  });

  const updatePasswordField = useRegisterUIComponent<FormFieldComponent>({
    id: 'password-field',
    type: 'formField',
    fieldType: 'textField',
    label: 'Password',
    value: password,
    required: true,
    parentId: 'login-form'
  });

  // Update field states when they change
  useEffect(() => {
    updateUsernameField({ value: username });
    updatePasswordField({ value: password });
  }, [username, password, updateUsernameField, updatePasswordField]);

  return (
    <form onSubmit={onSubmit}>
      <Input id="username-field" value={username} onChange={setUsername} />
      <Input id="password-field" value={password} onChange={setPassword} type="password" />
    </form>
  );
}
```

## Best Practices

1. **Component Registration**:
   - Register form components first
   - Register child components with proper parentId references
   - Use descriptive, hierarchical IDs (e.g., 'user-settings-save-button')
   - Keep IDs stable across renders
   - Make IDs unique within their context

2. **State Management**:
   - Update individual components when their state changes
   - Keep state updates minimal and focused
   - Clean up properly in unmount handlers
   - Only update properties defined in type interfaces

3. **Parent-Child Relationships**:
   - Use parentId to establish relationships
   - Keep hierarchies shallow when possible
   - Clean up entire component trees on unmount
   - Consider component reuse in hierarchies

4. **Type Safety**:
   - Always provide specific component types to hooks
   - Follow type definitions strictly
   - Avoid adding custom fields not in type definitions
   - Use proper type imports

5. **Performance**:
   - Batch state updates when possible
   - Only register components that need external visibility
   - Use memoization for complex state calculations
   - Consider update frequency

## Testing Integration

The UI reflection system integrates with testing through data-automation-id attributes:

```tsx
// Component registration
const updateButton = useRegisterUIComponent<ButtonComponent>({
  id: 'submit-button',
  type: 'button',
  label: 'Submit'
});

// DOM element
<button {...withDataAutomationId({ id: 'submit-button' })}>
  Submit
</button>
```

This ensures:
- UI reflection IDs match testing selectors
- Components are consistently identifiable
- Automated tests can reliably interact with elements

## Contributing

To extend the system:

1. Add new component types to `types.ts`
2. Update documentation
3. Add test coverage
4. Submit PR with examples
