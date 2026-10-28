import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { publishServiceRequestDefinition, type ServiceRequestDefinitionVersionRecord } from './definitionPublishing';
import { validateBasicFormSchema } from './basicFormBuilder';
import {
  getServiceRequestExecutionProvider,
  getServiceRequestFormBehaviorProvider,
  getServiceRequestVisibilityProvider,
} from './providers/registry';

export interface ServiceRequestPublishValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface ServiceRequestDefinitionForValidation {
  name: string;
  linked_service_id: string | null;
  form_schema: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown>;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown>;
  visibility_provider: string;
  visibility_config: Record<string, unknown>;
  audience_mode?: 'all' | 'scoped';
}

export async function validateServiceRequestDefinitionForPublish(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<ServiceRequestPublishValidationResult> {
  const db = tenantDb(knex, tenant);
  const definition = (await db.table('service_request_definitions')
    .where({ definition_id: definitionId })
    .first()) as ServiceRequestDefinitionForValidation | undefined;

  if (!definition) {
    return {
      isValid: false,
      errors: ['Service request definition not found'],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!definition.name?.trim()) {
    errors.push('Name is required');
  }

  const formValidation = validateBasicFormSchema(definition.form_schema ?? {});
  if (!formValidation.isValid) {
    errors.push(...formValidation.errors.map((error) => `Form: ${error}`));
  }

  if (definition.linked_service_id) {
    const linkedService = await db.table('service_catalog')
      .where({ service_id: definition.linked_service_id })
      .select('service_id', 'is_active')
      .first<{ service_id: string; is_active?: boolean | null }>();

    if (!linkedService) {
      errors.push('Linked service no longer exists');
    } else if (linkedService.is_active === false) {
      warnings.push('Linked service is inactive');
    }
  }

  const executionProvider = getServiceRequestExecutionProvider(definition.execution_provider);
  if (!executionProvider) {
    errors.push(`Unknown execution provider: ${definition.execution_provider}`);
  } else {
    const validation = executionProvider.validateConfig(definition.execution_config ?? {});
    if (!validation.isValid) {
      errors.push(...(validation.errors ?? []).map((error) => `Execution: ${error}`));
    }
    warnings.push(...(validation.warnings ?? []).map((warning) => `Execution: ${warning}`));
  }

  const formBehaviorProvider = getServiceRequestFormBehaviorProvider(definition.form_behavior_provider);
  if (!formBehaviorProvider) {
    errors.push(`Unknown form behavior provider: ${definition.form_behavior_provider}`);
  } else {
    const validation = formBehaviorProvider.validateConfig(definition.form_behavior_config ?? {});
    if (!validation.isValid) {
      errors.push(...(validation.errors ?? []).map((error) => `Form behavior: ${error}`));
    }
    warnings.push(...(validation.warnings ?? []).map((warning) => `Form behavior: ${warning}`));
  }

  // LEVERAGE: pattern condition-dialects — overlapping condition dialect; candidate to converge on @alga-psa/predicates (also: workflow event-wait filters, reporting FilterDefinition, inbound email rules, service-request visibility)
  const visibilityProvider = getServiceRequestVisibilityProvider(definition.visibility_provider);
  if (!visibilityProvider) {
    errors.push(`Unknown visibility provider: ${definition.visibility_provider}`);
  } else {
    const validation = visibilityProvider.validateConfig(definition.visibility_config ?? {});
    if (!validation.isValid) {
      errors.push(...(validation.errors ?? []).map((error) => `Visibility: ${error}`));
    }
    warnings.push(...(validation.warnings ?? []).map((warning) => `Visibility: ${warning}`));
  }

  if (definition.audience_mode === 'scoped') {
    const [clientRow, groupRow] = await Promise.all([
      db.table('service_request_audience_clients')
        .where({ definition_id: definitionId })
        .first('client_id'),
      db.table('service_request_audience_client_groups')
        .where({ definition_id: definitionId })
        .first('group_id'),
    ]);
    if (!clientRow && !groupRow) {
      errors.push(
        'Visibility: Restricted audience has no clients or client groups selected; choose at least one or set the audience to Everyone'
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function publishServiceRequestDefinitionWithValidation(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  publishedBy?: string | null;
}): Promise<ServiceRequestDefinitionVersionRecord> {
  const validation = await validateServiceRequestDefinitionForPublish(
    input.knex,
    input.tenant,
    input.definitionId
  );

  if (!validation.isValid) {
    throw new Error(`Publish validation failed: ${validation.errors.join('; ')}`);
  }

  return publishServiceRequestDefinition(input);
}
