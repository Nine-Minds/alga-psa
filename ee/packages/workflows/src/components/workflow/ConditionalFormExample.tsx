import { useState } from 'react';
import { DynamicForm } from './DynamicForm';
import { RJSFSchema, UiSchema } from '@rjsf/utils';
import { Action } from '@alga-psa/workflows/forms/actionHandlerRegistry';

/**
 * Example component that demonstrates conditional display logic in forms
 */
export function ConditionalFormExample() {
  // Define the form schema
  const schema: RJSFSchema = {
    type: 'object',
    required: ['name', 'contactMethod'],
    properties: {
      name: {
        type: 'string',
        title: 'Full Name'
      },
      contactMethod: {
        type: 'string',
        title: 'Preferred Contact Method',
        enum: ['email', 'phone', 'mail'],
        default: 'email'
      },
      email: {
        type: 'string',
        title: 'Email Address',
        format: 'email'
      },
      phone: {
        type: 'string',
        title: 'Phone Number'
      },
      address: {
        type: 'object',
        title: 'Mailing Address',
        properties: {
          street: {
            type: 'string',
            title: 'Street Address'
          },
          city: {
            type: 'string',
            title: 'City'
          },
          state: {
            type: 'string',
            title: 'State/Province'
          },
          zipCode: {
            type: 'string',
            title: 'Zip/Postal Code'
          }
        }
      },
      sendUpdates: {
        type: 'boolean',
        title: 'Send me updates about new features',
        default: false
      },
      updateFrequency: {
        type: 'string',
        title: 'Update Frequency',
        enum: ['daily', 'weekly', 'monthly'],
        default: 'weekly'
      }
    }
  };

  // Define the UI schema with conditional display logic
  const uiSchema: UiSchema = {
    'ui:order': ['name', 'contactMethod', 'email', 'phone', 'address', 'sendUpdates', 'updateFrequency'],
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
    },
    address: {
      'ui:displayIf': {
        field: 'contactMethod',
        value: 'mail'
      }
    },
    updateFrequency: {
      'ui:displayIf': {
        field: 'sendUpdates',
        value: true
      }
    }
  };

  // Define form actions
  const formActions: Action[] = [
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
      id: 'reset',
      label: 'Reset Form',
      primary: false,
      variant: 'secondary',
      disabled: false,
      hidden: false,
      order: 1
    }
  ];

  // State to store form data
  const [formData, setFormData] = useState<any>({
    contactMethod: 'email',
    sendUpdates: false
  });

  // Handle form actions
  const handleAction = async (actionId: string, data: any) => {
    console.log(`Action ${actionId} triggered with form data:`, data);
    
    if (actionId === 'submit') {
      setFormData(data);
      alert('Form submitted! Check console for details.');
    } else if (actionId === 'reset') {
      setFormData({
        contactMethod: 'email',
        sendUpdates: false
      });
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6">Contact Information Form</h1>
      <p className="mb-4 text-gray-600">
        This form demonstrates conditional display logic. Try changing the "Preferred Contact Method" 
        and toggling "Send me updates" to see how fields appear and disappear.
      </p>
      
      <DynamicForm
        schema={schema}
        uiSchema={uiSchema}
        formData={formData}
        onAction={handleAction}
        actions={formActions}
      />
      
      <div className="mt-8 p-4 bg-gray-100 rounded">
        <h2 className="text-lg font-semibold mb-2">How It Works</h2>
        <p className="mb-2">
          This form uses conditional display logic to show/hide fields based on the values of other fields:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>The <strong>Email Address</strong> field is only shown when "Email" is selected as the contact method</li>
          <li>The <strong>Phone Number</strong> field is only shown when "Phone" is selected as the contact method</li>
          <li>The <strong>Mailing Address</strong> fields are only shown when "Mail" is selected as the contact method</li>
          <li>The <strong>Update Frequency</strong> field is only shown when "Send me updates" is checked</li>
        </ul>
        <p className="mt-2">
          This is implemented using the <code>ui:displayIf</code> property in the UI schema, which is processed by 
          the <code>applyConditionalLogic</code> function.
        </p>
      </div>
    </div>
  );
}
