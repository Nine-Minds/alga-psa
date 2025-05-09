import { FormDefinition } from '@alga/form-registry';

export const workflowErrorForm: FormDefinition = {
  name: 'Workflow Error Form',
  description: 'Generic form for handling workflow errors.',
  jsonSchema: {
    type: 'object',
    properties: {
      errorMessage: {
        type: 'string',
        title: 'Error Message',
        readOnly: true,
      },
      errorStackTrace: {
        type: 'string',
        title: 'Error Stack Trace',
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
      restartWorkflowOption: {
        type: 'boolean',
        title: 'Restart Workflow',
        default: false,
      },
    },
    required: [
      'errorMessage',
      'errorStackTrace',
      'workflowInstanceId',
      'algaInvoiceId',
      'resolutionStatus',
    ],
  },
  uiSchema: {
    errorMessage: {
      'ui:widget': 'textarea',
    },
    errorStackTrace: {
      'ui:widget': 'textarea',
    },
    resolutionNotes: {
      'ui:widget': 'textarea',
    },
  },
};