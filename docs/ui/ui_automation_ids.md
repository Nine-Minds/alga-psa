# UI Automation IDs

## Overview

The UI reflection system provides a live, high-level JSON description of the application's UI state. To ensure proper integration with automated testing and LLM-driven interactions, all UI components must maintain consistency between their UI state IDs and DOM data-automation-id attributes.

## Parent-Child Relationships

Components automatically inherit their parent's ID through React context, eliminating the need to manually wire parentId everywhere:

```typescript
// Parent container sets the context
<ReflectionContainer id="ticketing-dashboard">
  {/* Children automatically know their parent */}
  <TicketFilters /> {/* gets ticketing-dashboard as parent */}
  <TicketTable />  {/* gets ticketing-dashboard as parent */}
</ReflectionContainer>
```

## Naming Conventions

Follow these patterns for component IDs:

1. **Screen/Page Components**:
   ```typescript
   // Base page ID
   id="ticketing-dashboard"
   ```

2. **Subcontainers**:
   ```typescript
   // Major sections use parent ID + purpose
   id={`${parentId}-filters`}    // ticketing-dashboard-filters
   id={`${parentId}-table`}      // ticketing-dashboard-table
   ```

3. **UI Components**:
   ```typescript
   // Individual elements use parent ID + type
   id={`${parentId}-status-select`}  // ticketing-dashboard-filters-status-select
   id={`${parentId}-search-input`}   // ticketing-dashboard-filters-search-input
   ```

## Sidebar Menu ID Convention

The sidebar menu items use a double-prefix pattern in their DOM automation IDs. The `Sidebar` component generates an `id` of `menu-{name}` for each item, which is then passed to `SidebarMenuItem`. The `SidebarMenuItem` renders the element with a `data-automation-id` of `sidebar-menu-menu-{name}`, resulting in the `menu-` prefix appearing twice.

For example, the Home menu item renders as:
```
data-automation-id="sidebar-menu-menu-home"
```

Other examples:
- Tickets: `sidebar-menu-menu-tickets`
- Companies: `sidebar-menu-menu-companies`
- Settings: `sidebar-menu-menu-settings`

When writing tests or automation scripts targeting sidebar items, use the full double-prefix form (`sidebar-menu-menu-{name}`).

## The useAutomationIdAndRegister Hook

Use this hook to combine UI reflection registration and data-automation-id props:

```typescript
function MyComponent({ id, ...props }) {
  // Register with reflection system and get DOM props
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ContainerComponent>({
    id,                    // Optional - will auto-generate if not provided
    type: 'container',
    label: 'My Component'
  });

  return <div {...automationIdProps} {...props} />;
}
```

### Features

1. **Automatic ID Generation**:
   ```typescript
   // With explicit ID
   const { automationIdProps } = useAutomationIdAndRegister({
     id: `${parentId}-filters`,
     type: 'container'
   });

   // With auto-generated ID
   const { automationIdProps } = useAutomationIdAndRegister({
     type: 'container'  // generates like: container-1, container-2, etc.
   });
   ```

2. **Parent Context Integration**:
   ```typescript
   // Auto-generated IDs include parent context
   parentId: 'my-screen'
   auto-generated: 'my-screen-button-1'
   ```

3. **Single Source of Truth**:
   - One hook call provides both reflection registration and DOM attributes
   - No chance of mismatch between UI state and DOM
   - Type-safe through TypeScript generics

## Core Components

Over 52 UI components now implement the `useAutomationIdAndRegister` pattern, including but not limited to:
- Button (`packages/ui/src/components/Button.tsx`)
- Input (`packages/ui/src/components/Input.tsx`)
- Dialog (`packages/ui/src/components/Dialog.tsx`)
- SearchableSelect, CustomSelect, AsyncSearchableSelect
- TextArea, SearchInput, TagInput
- ClientPicker, UserPicker, ContactPicker, CountryPicker
- DateTimePicker, DatePicker, TimePicker
- GenericDialog, CategoryPicker, BoardPicker

When creating new components that use the UI reflection system, follow these examples to maintain consistency.

## Testing

When writing tests, always use the component's ID to locate elements:

```typescript
// Good - uses data-automation-id that matches UI state
cy.get('[data-automation-id="ticketing-dashboard-filters-status-select"]').click();

// Bad - uses other selectors that might change
cy.get('.status-select').click();
cy.get('select:contains("Status")').click();
```

## Benefits

1. **Automated Testing**: 
   - Consistent, predictable IDs make tests reliable
   - Parent-child relationships reflected in ID structure
   - Auto-generated IDs maintain uniqueness

2. **LLM Integration**: 
   - Hierarchical component structure is clear from IDs
   - Consistent naming makes UI state easy to understand
   - Automatic parent-child tracking improves accuracy

3. **Developer Experience**:
   - No manual parentId prop passing
   - Auto-generated IDs reduce boilerplate
   - Single hook call for all UI reflection needs
   - Type-safe through TypeScript

4. **Maintenance**:
   - Consistent naming conventions
   - Clear component hierarchy
   - Reduced coupling between tests and implementation
   - Single source of truth for IDs

## Implementation Details

The UI reflection system uses React's Context API to maintain a live representation of the UI state. Each component that registers with the system contributes to this state, and the data-automation-id attributes provide a direct mapping between the logical UI state and the actual DOM elements.

The system now includes:
- ReflectionParentContext for automatic parent-child relationships
- useAutomationIdAndRegister hook for unified registration and DOM props
- Automatic ID generation with consistent naming patterns
- Type-safe component registration through TypeScript

See also:
- [UI Reflection System](ui_reflection_system.md)
- [Development Guide](../getting-started/development_guide.md)
