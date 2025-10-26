import { DynamicForm } from './DynamicForm';
import { RJSFSchema, UiSchema } from '@rjsf/utils';
import { Action } from '@server/lib/workflow/forms/actionHandlerRegistry';

// Example schema for a credit reimbursement form
const creditReimbursementSchema: RJSFSchema = {
  type: "object",
  required: ["client_id", "amount", "reason"],
  properties: {
    client_id: {
      type: "string",
      title: "Client"
    },
    amount: {
      type: "number",
      title: "Amount"
    },
    reason: {
      type: "string",
      title: "Reason for Reimbursement"
    },
    transaction_date: {
      type: "string",
      format: "date",
      title: "Date of Transaction"
    },
    order_number: {
      type: "string",
      title: "Order Number (if applicable)"
    },
    assigned_to: {
      type: "string",
      title: "Assign To"
    }
  }
};

// UI Schema specifying which widgets to use
const creditReimbursementUiSchema: UiSchema = {
  client_id: {
    "ui:widget": "ClientPickerWidget",
    "ui:options": {
      filters: { isActive: true },
      updateFields: true,
      fieldPrefix: "client_"
    }
  },
  amount: {
    "ui:widget": "InputWidget",
    "ui:options": {
      inputMode: "numeric"
    }
  },
  reason: {
    "ui:widget": "TextAreaWidget"
  },
  transaction_date: {
    "ui:widget": "DatePickerWidget"
  },
  assigned_to: {
    "ui:widget": "UserPickerWidget",
    "ui:options": {
      roles: ["finance_manager", "approver"]
    }
  }
};

export function FormExample() {
  // Define custom actions for the form
  const formActions: Action[] = [
    {
      id: 'submit',
      label: 'Submit Request',
      primary: true,
      variant: 'default' as const,
      disabled: false,
      hidden: false,
      order: 0
    },
    {
      id: 'save_draft',
      label: 'Save Draft',
      primary: false,
      variant: 'secondary' as const,
      disabled: false,
      hidden: false,
      order: 1
    },
    {
      id: 'cancel',
      label: 'Cancel',
      primary: false,
      variant: 'outline' as const,
      disabled: false,
      hidden: false,
      order: 2
    }
  ];

  // Handle form actions
  const handleAction = async (actionId: string, formData: any) => {
    console.log(`Action ${actionId} triggered with form data:`, formData);
    
    switch (actionId) {
      case 'submit':
        // In a real application, you would submit this data to your API
        alert('Form submitted! Check console for details.');
        break;
      case 'save_draft':
        alert('Draft saved! Check console for details.');
        break;
      case 'cancel':
        alert('Form cancelled!');
        break;
      default:
        console.warn(`Unknown action: ${actionId}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6">Credit Reimbursement Request</h1>
      
      <DynamicForm
        schema={creditReimbursementSchema}
        uiSchema={creditReimbursementUiSchema}
        onAction={handleAction}
        actions={formActions}
      />
    </div>
  );
}