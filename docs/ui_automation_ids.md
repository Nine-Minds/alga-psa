# UI Automation IDs

## Overview

The UI reflection system provides a live, high-level JSON description of the application's UI state. To ensure proper integration with automated testing and LLM-driven interactions, all UI components must maintain consistency between their UI state IDs and DOM data-automation-id attributes.

## Requirements

1. Every component that registers with the UI reflection system (using `useRegisterUIComponent`) must:
   - Have a unique `id` prop that identifies it in the UI state
   - Use the same ID value for its `data-automation-id` DOM attribute

2. Use the provided utilities:
   ```typescript
   import { withDataAutomationId } from '../types/ui-reflection/withDataAutomationId';

   // Function component example
   function MyComponent({ id, ...props }) {
     return <div {...withDataAutomationId({ id })} {...props} />;
   }

   // Or use the HOC for automatic handling
   const MyComponent = withUIReflectionId(BaseComponent);
   ```

## Core Components

The following core UI components already implement this pattern:
- Button (`server/src/components/ui/Button.tsx`)
- Input (`server/src/components/ui/Input.tsx`)
- Dialog (`server/src/components/ui/Dialog.tsx`)

When creating new components that use the UI reflection system, follow these examples to maintain consistency.

## Testing

When writing tests, always use the component's ID to locate elements:

```typescript
// Good - uses data-automation-id that matches UI state
cy.get('[data-automation-id="submit-button"]').click();

// Bad - uses other selectors that might change
cy.get('.submit-btn').click();
cy.get('button:contains("Submit")').click();
```

## Benefits

1. **Automated Testing**: Consistent IDs make it easier to write reliable tests
2. **LLM Integration**: Enables AI systems to accurately understand and interact with the UI
3. **Debugging**: Simplifies tracking component state and behavior
4. **Maintenance**: Reduces coupling between tests and implementation details

## Implementation Details

The UI reflection system uses React's Context API to maintain a live representation of the UI state. Each component that registers with the system contributes to this state, and the data-automation-id attributes provide a direct mapping between the logical UI state and the actual DOM elements.

See also:
- [UI Reflection System](ui_reflection_system.md)
- [Development Guide](development_guide.md)
