import { FormDefinition } from '@alga/form-registry';
import { qboMappingErrorForm } from '../base-forms/qbo-mapping-error-form';

// This specialized form extends the QBO Mapping Error Form.
// Composition will be handled in the registration script.
export const qboItemMappingMissingForm: FormDefinition = {
  name: 'QBO Item Mapping Missing Form',
  description: 'Form for handling missing QBO item mappings.',
  jsonSchema: {
    type: 'object',
    properties: {
      // Inherits properties from qboMappingErrorForm
      // Add any specific properties here if needed
    },
    required: [
      // Inherits required fields from qboMappingErrorForm
    ],
  },
  uiSchema: {
    // Inherits uiSchema from qboMappingErrorForm
    // Add any specific uiSchema here if needed
  },
};