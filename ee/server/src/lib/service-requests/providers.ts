import { SERVICE_REQUEST_EXECUTION_MODES } from 'server/src/lib/service-requests/domain';
import type {
  ServiceRequestExecutionProvider,
  ServiceRequestExecutionResult,
  ServiceRequestFormBehaviorProvider,
  ServiceRequestProviderRegistrations,
  ServiceRequestTemplateProvider,
  ServiceRequestVisibilityProvider,
} from 'server/src/lib/service-requests/providers/contracts';
import { ticketOnlyExecutionProvider } from 'server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider';

interface WorkflowExecutionConfig {
  workflowId?: string;
  inputMapping?: Record<string, string>;
  simulateFailure?: boolean;
}

type VisibilityRuleOperator =
  | 'equals'
  | 'not-equals'
  | 'is-true'
  | 'is-false'
  | 'has-value'
  | 'is-empty';

interface AdvancedVisibilityRule {
  fieldKey: string;
  source: string;
  operator: VisibilityRuleOperator;
  value?: unknown;
}

interface AdvancedFormBehaviorConfig {
  contextDefaults?: Record<string, unknown>;
  visibilityRules?: AdvancedVisibilityRule[];
}

function getWorkflowConfig(config: Record<string, unknown>): WorkflowExecutionConfig {
  return {
    workflowId:
      typeof config.workflowId === 'string' && config.workflowId.trim().length > 0
        ? config.workflowId.trim()
        : undefined,
    inputMapping:
      config.inputMapping && typeof config.inputMapping === 'object' && !Array.isArray(config.inputMapping)
        ? (config.inputMapping as Record<string, string>)
        : undefined,
    simulateFailure: config.simulateFailure === true,
  };
}

function resolvePath(payload: Record<string, unknown>, source: string): unknown {
  if (!source.startsWith('payload.')) {
    return payload[source];
  }

  const path = source.slice('payload.'.length);
  if (!path) {
    return undefined;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, payload);
}

function buildWorkflowInputs(
  payload: Record<string, unknown>,
  config: WorkflowExecutionConfig,
  extras?: { createdTicketId?: string }
): Record<string, unknown> {
  const mapping = config.inputMapping ?? {};
  const inputs: Record<string, unknown> = {};
  for (const [targetKey, source] of Object.entries(mapping)) {
    if (source === 'ticketId') {
      inputs[targetKey] = extras?.createdTicketId ?? null;
      continue;
    }
    if (source.startsWith('literal:')) {
      inputs[targetKey] = source.slice('literal:'.length);
      continue;
    }
    inputs[targetKey] = resolvePath(payload, source);
  }
  if (Object.keys(inputs).length === 0) {
    return payload;
  }
  return inputs;
}

function validateWorkflowConfig(config: WorkflowExecutionConfig): { isValid: boolean; errors?: string[] } {
  if (!config.workflowId) {
    return {
      isValid: false,
      errors: ['workflowId is required'],
    };
  }
  return { isValid: true };
}

function buildWorkflowReference(
  workflowId: string,
  submissionId: string,
  createdTicketId?: string
): string {
  if (createdTicketId) {
    return `wf_${workflowId}_${createdTicketId}`;
  }
  return `wf_${workflowId}_${submissionId}`;
}

async function executeWorkflowSubmission(input: {
  config: WorkflowExecutionConfig;
  submissionId: string;
  payload: Record<string, unknown>;
  createdTicketId?: string;
}): Promise<ServiceRequestExecutionResult> {
  if (!input.config.workflowId) {
    return {
      status: 'failed',
      errorSummary: 'workflowId is required',
    };
  }

  if (input.config.simulateFailure) {
    return {
      status: 'failed',
      errorSummary: 'Workflow startup failed (simulated).',
      createdTicketId: input.createdTicketId,
    };
  }

  const workflowInputs = buildWorkflowInputs(input.payload, input.config, {
    createdTicketId: input.createdTicketId,
  });
  const hasMissingTicketMapping = Object.values(workflowInputs).some(
    (value) => value === null && input.createdTicketId
  );
  if (hasMissingTicketMapping) {
    return {
      status: 'failed',
      errorSummary: 'Workflow input mapping failed to resolve ticket-linked values.',
      createdTicketId: input.createdTicketId,
    };
  }

  return {
    status: 'succeeded',
    createdTicketId: input.createdTicketId,
    workflowExecutionId: buildWorkflowReference(
      input.config.workflowId,
      input.submissionId,
      input.createdTicketId
    ),
  };
}

const workflowOnlyExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'workflow-only',
  displayName: 'Workflow Only',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.WORKFLOW_ONLY,
  validateConfig: (config) => validateWorkflowConfig(getWorkflowConfig(config)),
  async execute(context) {
    const workflowConfig = getWorkflowConfig(context.config);
    return executeWorkflowSubmission({
      config: workflowConfig,
      submissionId: context.submissionId,
      payload: context.payload,
    });
  },
};

const ticketPlusWorkflowExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'ticket-plus-workflow',
  displayName: 'Ticket + Workflow',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.TICKET_PLUS_WORKFLOW,
  validateConfig: (config) => validateWorkflowConfig(getWorkflowConfig(config)),
  async execute(context) {
    const ticketResult = await ticketOnlyExecutionProvider.execute(context);
    if (ticketResult.status !== 'succeeded' || !ticketResult.createdTicketId) {
      return {
        status: 'failed',
        createdTicketId: ticketResult.createdTicketId,
        errorSummary: ticketResult.errorSummary ?? 'Ticket creation failed before workflow start.',
      };
    }

    const workflowConfig = getWorkflowConfig(context.config);
    return executeWorkflowSubmission({
      config: workflowConfig,
      submissionId: context.submissionId,
      payload: context.payload,
      createdTicketId: ticketResult.createdTicketId,
    });
  },
};

const advancedFormBehaviorProvider: ServiceRequestFormBehaviorProvider = {
  key: 'advanced',
  displayName: 'Advanced',
  validateConfig: (config) => {
    const parsed = parseAdvancedFormBehaviorConfig(config);
    const errors: string[] = [];

    if ('contextDefaults' in config && parsed.contextDefaults === undefined) {
      errors.push('contextDefaults must be an object');
    }

    if ('visibilityRules' in config) {
      if (!Array.isArray(config.visibilityRules)) {
        errors.push('visibilityRules must be an array');
      } else {
        for (const [index, rule] of config.visibilityRules.entries()) {
          if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
            errors.push(`visibilityRules[${index}] must be an object`);
            continue;
          }

          const candidate = rule as Record<string, unknown>;
          if (typeof candidate.fieldKey !== 'string' || candidate.fieldKey.trim().length === 0) {
            errors.push(`visibilityRules[${index}].fieldKey is required`);
          }
          if (typeof candidate.source !== 'string' || candidate.source.trim().length === 0) {
            errors.push(`visibilityRules[${index}].source is required`);
          }

          const operator = candidate.operator;
          if (
            operator !== 'equals' &&
            operator !== 'not-equals' &&
            operator !== 'is-true' &&
            operator !== 'is-false' &&
            operator !== 'has-value' &&
            operator !== 'is-empty'
          ) {
            errors.push(
              `visibilityRules[${index}].operator must be one of equals, not-equals, is-true, is-false, has-value, is-empty`
            );
          }

          if (
            (operator === 'equals' || operator === 'not-equals') &&
            candidate.value === undefined
          ) {
            errors.push(`visibilityRules[${index}].value is required for ${operator}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
  async resolveInitialValues(context, config) {
    const parsed = parseAdvancedFormBehaviorConfig(config);
    const defaults = parsed.contextDefaults ?? {};

    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (typeof value !== 'string') {
        resolved[key] = value;
        continue;
      }

      resolved[key] = value
        .replace('{{requesterUserId}}', context.requesterUserId)
        .replace('{{clientId}}', context.clientId)
        .replace('{{contactId}}', context.contactId ?? '');
    }
    return resolved;
  },
  async resolveVisibleFieldKeys(context, formSchema, values, config) {
    const fields = Array.isArray((formSchema as any)?.fields)
      ? ((formSchema as any).fields as any[])
      : [];
    const fieldKeys = fields
      .map((field) => (typeof field?.key === 'string' ? field.key : null))
      .filter((fieldKey): fieldKey is string => !!fieldKey);

    const parsed = parseAdvancedFormBehaviorConfig(config);
    const rules = parsed.visibilityRules ?? [];
    if (rules.length === 0) {
      return fieldKeys;
    }

    const rulesByField = new Map<string, AdvancedVisibilityRule[]>();
    for (const rule of rules) {
      const existing = rulesByField.get(rule.fieldKey) ?? [];
      existing.push(rule);
      rulesByField.set(rule.fieldKey, existing);
    }

    return fieldKeys.filter((fieldKey) => {
      const fieldRules = rulesByField.get(fieldKey);
      if (!fieldRules || fieldRules.length === 0) {
        return true;
      }
      return fieldRules.every((rule) => {
        const sourceValue = resolveVisibilitySourceValue(rule.source, values, context);
        return evaluateVisibilityRule(rule, sourceValue);
      });
    });
  },
};

function parseAdvancedFormBehaviorConfig(
  config: Record<string, unknown>
): AdvancedFormBehaviorConfig {
  const visibilityRules = Array.isArray(config.visibilityRules)
    ? config.visibilityRules
        .map((candidate) => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return null;
          }

          const rule = candidate as Record<string, unknown>;
          if (
            typeof rule.fieldKey !== 'string' ||
            typeof rule.source !== 'string' ||
            (rule.operator !== 'equals' &&
              rule.operator !== 'not-equals' &&
              rule.operator !== 'is-true' &&
              rule.operator !== 'is-false' &&
              rule.operator !== 'has-value' &&
              rule.operator !== 'is-empty')
          ) {
            return null;
          }

          return {
            fieldKey: rule.fieldKey.trim(),
            source: rule.source.trim(),
            operator: rule.operator,
            value: rule.value,
          } as AdvancedVisibilityRule;
        })
        .filter((rule): rule is AdvancedVisibilityRule => !!rule)
    : undefined;

  const contextDefaults =
    config.contextDefaults && typeof config.contextDefaults === 'object' && !Array.isArray(config.contextDefaults)
      ? (config.contextDefaults as Record<string, unknown>)
      : undefined;

  return {
    contextDefaults,
    visibilityRules,
  };
}

function resolveVisibilitySourceValue(
  source: string,
  values: Record<string, unknown>,
  context: {
    requesterUserId: string;
    clientId: string;
    contactId?: string | null;
  }
): unknown {
  if (source === 'context.requesterUserId') {
    return context.requesterUserId;
  }
  if (source === 'context.clientId') {
    return context.clientId;
  }
  if (source === 'context.contactId') {
    return context.contactId ?? null;
  }
  if (source.startsWith('payload.')) {
    return values[source.slice('payload.'.length)];
  }
  return values[source];
}

function evaluateVisibilityRule(rule: AdvancedVisibilityRule, sourceValue: unknown): boolean {
  switch (rule.operator) {
    case 'equals':
      return sourceValue === rule.value;
    case 'not-equals':
      return sourceValue !== rule.value;
    case 'is-true':
      return sourceValue === true || sourceValue === 'true' || sourceValue === 'on' || sourceValue === '1';
    case 'is-false':
      return (
        sourceValue === false ||
        sourceValue === 'false' ||
        sourceValue === 'off' ||
        sourceValue === '0' ||
        sourceValue === null ||
        sourceValue === undefined ||
        sourceValue === ''
      );
    case 'has-value':
      return sourceValue !== null && sourceValue !== undefined && String(sourceValue).trim().length > 0;
    case 'is-empty':
      return sourceValue === null || sourceValue === undefined || String(sourceValue).trim().length === 0;
    default:
      return true;
  }
}

const advancedVisibilityProvider: ServiceRequestVisibilityProvider = {
  key: 'advanced-visibility',
  displayName: 'Advanced Visibility',
  validateConfig: (config) => {
    const errors: string[] = [];

    if (
      'allowAll' in config &&
      config.allowAll !== true &&
      config.allowAll !== false
    ) {
      errors.push('allowAll must be a boolean');
    }

    if ('allowedClientIds' in config) {
      if (!Array.isArray(config.allowedClientIds)) {
        errors.push('allowedClientIds must be an array');
      } else if (
        config.allowedClientIds.some(
          (value) => typeof value !== 'string' || value.trim().length === 0
        )
      ) {
        errors.push('allowedClientIds must contain only non-empty strings');
      }
    }

    if ('allowedRequesterUserIds' in config) {
      if (!Array.isArray(config.allowedRequesterUserIds)) {
        errors.push('allowedRequesterUserIds must be an array');
      } else if (
        config.allowedRequesterUserIds.some(
          (value) => typeof value !== 'string' || value.trim().length === 0
        )
      ) {
        errors.push('allowedRequesterUserIds must contain only non-empty strings');
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
  async canAccessDefinition(context, _definition, config) {
    const allowAll = config.allowAll !== false;
    if (!allowAll) {
      return false;
    }

    const allowedClientIds = Array.isArray(config.allowedClientIds)
      ? config.allowedClientIds.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : [];
    if (allowedClientIds.length > 0 && !allowedClientIds.includes(context.clientId)) {
      return false;
    }

    const allowedRequesterUserIds = Array.isArray(config.allowedRequesterUserIds)
      ? config.allowedRequesterUserIds.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : [];
    if (
      allowedRequesterUserIds.length > 0 &&
      !allowedRequesterUserIds.includes(context.requesterUserId)
    ) {
      return false;
    }

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
