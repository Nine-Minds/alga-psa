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
- **Hierarchical Structure**: Automatic parent-child relationships through context
- **Auto ID Generation**: Consistent ID generation with parent context integration

## Hierarchical Component Model

The UI reflection system uses React Context to maintain parent-child relationships automatically:

### 1. Base Component Structure

All components can participate in parent-child relationships:

```typescript
interface BaseComponent {
  id: string;          // Unique identifier (can be auto-generated)
  type: string;        // Component type (e.g., 'container', 'button')
  label?: string;      // Human-readable label
  disabled?: boolean;  // Component state
  actions?: string[];  // Available actions
}
```

### 2. Parent-Child Registration

Components inherit their parent's ID through context:

```typescript
// Parent container sets the context
<ReflectionContainer id="ticketing-dashboard">
  {/* Children automatically know their parent */}
  <TicketFilters />  // Gets ticketing-dashboard as parent
  <TicketTable />    // Gets ticketing-dashboard as parent
</ReflectionContainer>
```

### 3. State Management

The UIStateContext maintains the complete component hierarchy:

```typescript
// Internal state structure
{
  components: [
    {
      id: 'ticketing-dashboard',
      type: 'container',
      children: [
        {
          id: 'ticketing-dashboard-filters',
          type: 'container'
        },
        {
          id: 'ticketing-dashboard-table',
          type: 'container',
          children: [
            {
              id: 'ticketing-dashboard-table-status-select',
              type: 'formField',
              fieldType: 'select'
            }
          ]
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

Use the `useAutomationIdAndRegister` hook to register components and get DOM props:

```tsx
function ActionButton({ id, label, disabled, onClick }: Props) {
  // Single hook call for registration and DOM props
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    id,                    // Optional - will auto-generate if not provided
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
    <button {...automationIdProps} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
```

### 3. Form Components

Forms use ReflectionContainer to establish parent-child relationships:

```tsx
function LoginForm({ id }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <ReflectionContainer id={id} label="Login Form">
      <form onSubmit={handleSubmit}>
        <Input
          id={`${id}-username`}  // Parent ID is inherited
          value={username}
          onChange={setUsername}
        />
        <Input
          id={`${id}-password`}
          value={password}
          onChange={setPassword}
          type="password"
        />
      </form>
    </ReflectionContainer>
  );
}
```

## Best Practices

1. **Component Registration**:
   - Use ReflectionContainer for major UI sections
   - Let child components inherit parent context
   - Follow naming conventions for IDs:
     * Screen/Page: my-screen
     * Subcontainers: ${parentId}-section
     * Components: ${parentId}-type

2. **State Management**:
   - Use useAutomationIdAndRegister for unified registration
   - Keep state updates minimal and focused
   - Clean up properly in unmount handlers
   - Only update properties defined in type interfaces

3. **Parent-Child Relationships**:
   - Let React context handle parent-child relationships
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
// Component registration and DOM props in one call
const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
  id: 'submit-button',
  type: 'button',
  label: 'Submit'
});

// DOM element
<button {...automationIdProps}>
  Submit
</button>
```

This ensures:
- UI reflection IDs match testing selectors
- Components are consistently identifiable
- Automated tests can reliably interact with elements
- Parent-child relationships are reflected in IDs

## Contributing

To extend the system:

1. Add new component types to `types.ts`
2. Update documentation
3. Add test coverage
4. Submit PR with examples

See also:
- [UI Automation IDs](ui_automation_ids.md)
- [Development Guide](development_guide.md)
