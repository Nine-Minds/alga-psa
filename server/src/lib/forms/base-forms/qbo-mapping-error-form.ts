import { FormDefinition } from '@alga/form-registry';

export const qboMappingErrorForm: FormDefinition = {
  name: 'QBO Mapping Error Form',
  description: 'Generic form for handling QBO mapping errors.',
  jsonSchema: {
    type: 'object',
    properties: {
      errorMessage: {
        type: 'string',
        title: 'Error Message',
        readOnly: true,
      },
      workflowInstanceId: {
        type: 'string',
        title: 'Workflow Instance ID',
        readOnly: true,
      },
      algaInvoiceId: {
        type: 'string',
        title: 'Alga Invoice ID',
        readOnly: true,
      },
      entityId: {
        type: 'string',
        title: 'Entity ID (Company/Item/Service)',
        readOnly: true,
      },
      resolutionStatus: {
        type: 'string',
        title: 'Resolution Status',
        enum: ['resolved', 'escalated', 'deferred'],
        default: 'deferred',
      },
      resolutionNotes: {
        type: 'string',
        title: 'Resolution Notes',
      },
      createMappingOption: {
        type: 'boolean',
        title: 'Create Mapping',
        default: false,
      },
    },
    required: [
      'errorMessage',
      'workflowInstanceId',
      'algaInvoiceId',
      'entityId',
      'resolutionStatus',
    ],
  },
  uiSchema: {
    errorMessage: {
      'ui:widget': 'textarea',
    },
    resolutionNotes: {
      'ui:widget': 'textarea',
    },
  },
};