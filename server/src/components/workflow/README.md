# Workflow UI System Components

This directory contains the components for the Dynamic Workflow UI System, which provides a flexible, metadata-driven UI system for workflow management.

## Implemented Components

### 1. DynamicForm Component

A wrapper around React JSONSchema Form (RJSF) that integrates with the application's UI components. It provides:

- Custom widget integration with existing UI components
- Form state management
- Support for field updates from widgets
- Integration with the action handler system
- Support for multiple action buttons
- Context data for workflow integration

### 2. TaskForm Component

A specialized form component for workflow tasks that:

- Handles task submission and other task actions
- Manages submission state (loading, errors)
- Integrates with the task inbox system
- Supports custom task actions

### 3. ActionButton Component

A generic action button component that:

- Renders based on action metadata
- Supports various button styles
- Handles confirmation dialogs
- Manages processing state
- Supports icons and custom styling

### 4. ActionButtonGroup Component

A component for rendering multiple action buttons that:

- Handles layout and styling of action buttons
- Sorts actions by priority and order
- Filters hidden actions
- Provides consistent spacing and alignment

### 5. Custom Widgets

Located in `server/src/lib/workflow/forms/customWidgets.tsx`, these widgets integrate RJSF with the application's UI components:

- InputWidget
- TextAreaWidget
- DatePickerWidget
- CompanyPickerWidget
- UserPickerWidget
- CheckboxWidget

### 6. Custom Field Template

Located in `server/src/lib/workflow/forms/customFieldTemplate.tsx`, this template provides custom rendering for form fields with:

- Consistent styling
- Required field indicators
- Error message display
- Help text support

### 7. Action Handler Registry

Located in `server/src/lib/workflow/forms/actionHandlerRegistry.ts`, this registry provides:

- Registration of action handlers
- Execution of action handlers
- Context data for action handlers
- Standard action handlers (submit, cancel, save_draft)
- Support for custom business logic

### 8. Form Example

A sample implementation showing how to use the DynamicForm component with a credit reimbursement form schema and custom actions.

## Usage Example

```tsx
import { DynamicForm } from './DynamicForm';
import { Action } from '../../lib/workflow/forms/actionHandlerRegistry';

// Define your form schema
const schema = {
  type: "object",
  required: ["name", "email"],
  properties: {
    name: {
      type: "string",
      title: "Name"
    },
    email: {
      type: "string",
      format: "email",
      title: "Email"
    }
  }
};

// Define your UI schema
const uiSchema = {
  name: {
    "ui:widget": "InputWidget"
  },
  email: {
    "ui:widget": "InputWidget"
  }
};

// Define custom actions
const actions: Action[] = [
  {
    id: 'submit',
    label: 'Submit',
    primary: true,
    variant: 'default',
    disabled: false,
    hidden: false,
    order: 0
  },
  {
    id: 'cancel',
    label: 'Cancel',
    primary: false,
    variant: 'secondary',
    disabled: false,
    hidden: false,
    order: 1
  }
];

// Use the DynamicForm component with actions
function MyForm() {
  const handleAction = async (actionId: string, formData: any) => {
    console.log(`Action ${actionId} triggered with data:`, formData);
    
    // Handle different actions
    if (actionId === 'submit') {
      // Submit the form
    } else if (actionId === 'cancel') {
      // Cancel the form
    }
  };

  return (
    <DynamicForm
      schema={schema}
      uiSchema={uiSchema}
      onAction={handleAction}
      actions={actions}
    />
  );
}
```

## Completed Tasks

1. ✅ **Create custom widget registry** - Implemented in `customWidgets.tsx`
2. ✅ **Build generic action button component** - Implemented in `ActionButton.tsx` and `ActionButtonGroup.tsx`
3. ✅ **Create action handler system** - Implemented in `actionHandlerRegistry.ts`
4. ✅ **Implement conditional display logic** - Implemented in `conditionalLogic.ts` and integrated with `DynamicForm.tsx`
5. ✅ **Add confirmation dialogs, comments, and attachments** - Confirmation dialogs implemented in `ActionButton.tsx`

## Conditional Display Logic

The system supports conditional display logic for form fields based on the values of other fields. This is implemented using the `ui:displayIf` property in the UI schema:

```typescript
// Example UI schema with conditional display logic
const uiSchema = {
  email: {
    'ui:widget': 'email',
    'ui:displayIf': {
      field: 'contactMethod',
      value: 'email'
    }
  },
  phone: {
    'ui:widget': 'text',
    'ui:displayIf': {
      field: 'contactMethod',
      value: 'phone'
    }
  }
};
```

The `conditionalLogic.ts` module provides utilities for processing conditional display logic:

- `applyConditionalLogic`: Processes a schema with conditional logic and returns a modified schema
- `createConditionalField`: Creates a field that depends on another field
- `createMultiConditionalField`: Creates a field that depends on multiple conditions

The `ConditionalFormExample.tsx` component demonstrates how to use conditional display logic in forms.

## Next Steps

1. **Optimize RJSF performance** - For complex forms
2. **Implement responsive design** - For both standalone and embedded modes
3. **Create embedded version** - For user activities screen