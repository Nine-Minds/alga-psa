import { FormDefinition } from '@alga/form-registry';
import { qboMappingErrorForm } from '../base-forms/qbo-mapping-error-form';

// This specialized form extends the QBO Mapping Error Form.
// Composition will be handled in the registration script.
export const qboInvoiceNoItemsMappedForm: FormDefinition = {
  name: 'QBO Invoice No Items Mapped Form',
  description: 'Form for handling QBO invoices with no items mapped.',
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