import { FormDefinition } from '@alga/form-registry';
import { qboApiErrorForm } from '../base-forms/qbo-api-error-form';

// This specialized form extends the QBO API Error Form.
// Composition will be handled in the registration script.
export const qboSyncErrorForm: FormDefinition = {
  name: 'QBO Sync Error Form',
  description: 'Form for handling QBO sync errors.',
  jsonSchema: {
    type: 'object',
    properties: {
      // Inherits properties from qboApiErrorForm
      // Add any specific properties here if needed
    },
    required: [
      // Inherits required fields from qboApiErrorForm
    ],
  },
  uiSchema: {
    // Inherits uiSchema from qboApiErrorForm
    // Add any specific uiSchema here if needed
  },
};