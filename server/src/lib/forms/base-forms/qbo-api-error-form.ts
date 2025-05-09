import { FormDefinition } from '@alga/form-registry';

export const qboApiErrorForm: FormDefinition = {
  name: 'QBO API Error Form',
  description: 'Generic form for handling QBO API errors.',
  jsonSchema: {
    type: 'object',
    properties: {
      errorMessage: {
        type: 'string',
        title: 'Error Message',
        readOnly: true,
      },
      errorCode: {
        type: 'string',
        title: 'Error Code',
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
      qboInvoiceId: {
        type: 'string',
        title: 'QBO Invoice ID (if available)',
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
      retryOperationOption: {
        type: 'boolean',
        title: 'Retry Operation',
        default: false,
      },
    },
    required: [
      'errorMessage',
      'errorCode',
      'workflowInstanceId',
      'algaInvoiceId',
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