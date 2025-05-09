import { FormDefinition } from '@alga/form-registry';
import { workflowErrorForm } from '../base-forms/workflow-error-form';

// This specialized form extends the Workflow Error Form.
// Composition will be handled in the registration script.
export const secretFetchErrorForm: FormDefinition = {
  name: 'Secret Fetch Error Form',
  description: 'Form for handling secret fetch errors.',
  jsonSchema: {
    type: 'object',
    properties: {
      // Inherits properties from workflowErrorForm
      // Add any specific properties here if needed
    },
    required: [
      // Inherits required fields from workflowErrorForm
    ],
  },
  uiSchema: {
    // Inherits uiSchema from workflowErrorForm
    // Add any specific uiSchema here if needed
  },
};