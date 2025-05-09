import { FormDefinition } from '@alga/form-registry';
import { qboLookupErrorForm } from '../base-forms/qbo-lookup-error-form';

// This specialized form extends the QBO Lookup Error Form.
// Composition will be handled in the registration script.
export const qboItemLookupFailedForm: FormDefinition = {
  name: 'QBO Item Lookup Failed Form',
  description: 'Form for handling QBO item lookup failures.',
  jsonSchema: {
    type: 'object',
    properties: {
      // Inherits properties from qboLookupErrorForm
      // Add any specific properties here if needed
    },
    required: [
      // Inherits required fields from qboLookupErrorForm
    ],
  },
  uiSchema: {
    // Inherits uiSchema from qboLookupErrorForm
    // Add any specific uiSchema here if needed
  },
};