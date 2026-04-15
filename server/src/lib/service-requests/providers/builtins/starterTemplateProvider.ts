import type {
  ServiceRequestTemplateDefinition,
  ServiceRequestTemplateProvider,
} from '../contracts';

const starterTemplates: ServiceRequestTemplateDefinition[] = [
  {
    id: 'new-hire',
    name: 'New Hire',
    description: 'Collect baseline onboarding information for a new employee.',
    buildDraft: () => ({
      metadata: {
        name: 'New Hire Request',
        description: 'Request setup for a new team member.',
        icon: 'user-plus',
      },
      formSchema: {
        fields: [
          { key: 'employee_name', type: 'short-text', label: 'Employee Name', required: true },
          { key: 'start_date', type: 'date', label: 'Start Date', required: true },
          { key: 'department', type: 'short-text', label: 'Department', required: false },
        ],
      },
      providers: {
        executionProvider: 'ticket-only',
        executionConfig: {
          titleTemplate: 'New Hire Setup: {{employee_name}}',
          includeFormResponsesInDescription: true,
        },
        formBehaviorProvider: 'basic',
        formBehaviorConfig: {},
        visibilityProvider: 'all-authenticated-client-users',
        visibilityConfig: {},
      },
    }),
  },
];

export const starterTemplateProvider: ServiceRequestTemplateProvider = {
  key: 'ce-starter-pack',
  displayName: 'CE Starter Pack',
  listTemplates: () => starterTemplates,
};
