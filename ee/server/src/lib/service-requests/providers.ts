import { SERVICE_REQUEST_EXECUTION_MODES } from 'server/src/lib/service-requests/domain';
import type {
  ServiceRequestExecutionProvider,
  ServiceRequestFormBehaviorProvider,
  ServiceRequestProviderRegistrations,
  ServiceRequestTemplateProvider,
  ServiceRequestVisibilityProvider,
} from 'server/src/lib/service-requests/providers/contracts';

const workflowOnlyExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'workflow-only',
  displayName: 'Workflow Only',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.WORKFLOW_ONLY,
  validateConfig: () => ({ isValid: true }),
  async execute() {
    return {
      status: 'failed',
      errorSummary: 'Workflow-only execution is not wired yet.',
    };
  },
};

const ticketPlusWorkflowExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'ticket-plus-workflow',
  displayName: 'Ticket + Workflow',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.TICKET_PLUS_WORKFLOW,
  validateConfig: () => ({ isValid: true }),
  async execute() {
    return {
      status: 'failed',
      errorSummary: 'Ticket + workflow execution is not wired yet.',
    };
  },
};

const advancedFormBehaviorProvider: ServiceRequestFormBehaviorProvider = {
  key: 'advanced',
  displayName: 'Advanced',
  validateConfig: () => ({ isValid: true }),
  async resolveInitialValues() {
    return {};
  },
};

const advancedVisibilityProvider: ServiceRequestVisibilityProvider = {
  key: 'advanced-visibility',
  displayName: 'Advanced Visibility',
  validateConfig: () => ({ isValid: true }),
  async canAccessDefinition() {
    return true;
  },
};

const enterpriseTemplateProvider: ServiceRequestTemplateProvider = {
  key: 'ee-starter-pack',
  displayName: 'EE Starter Pack',
  listTemplates: () => [],
};

export async function getServiceRequestEnterpriseProviderRegistrations(): Promise<ServiceRequestProviderRegistrations> {
  return {
    executionProviders: [workflowOnlyExecutionProvider, ticketPlusWorkflowExecutionProvider],
    formBehaviorProviders: [advancedFormBehaviorProvider],
    visibilityProviders: [advancedVisibilityProvider],
    templateProviders: [enterpriseTemplateProvider],
    adminExtensionProviders: [],
  };
}
