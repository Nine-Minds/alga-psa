import { FormDefinition } from '@alga/form-registry';

export const qboLookupErrorForm: FormDefinition = {
  name: 'QBO Lookup Error Form',
  description: 'Generic form for handling QBO lookup errors.',
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
      algaServiceId: {
        type: 'string',
        title: 'Alga Service ID',
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
      retryLookupOption: {
        type: 'boolean',
        title: 'Retry Lookup',
        default: false,
      },
    },
    required: [
      'errorMessage',
      'workflowInstanceId',
      'algaInvoiceId',
      'algaServiceId',
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