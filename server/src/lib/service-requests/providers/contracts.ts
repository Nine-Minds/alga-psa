import type {
  ServiceRequestDefinitionShape,
  ServiceRequestExecutionMode,
  ServiceRequestPortalMetadata,
} from '../domain';
import type { Knex } from 'knex';

export interface ServiceRequestProviderValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface ServiceRequestExecutionContext {
  knex: Knex;
  tenant: string;
  definitionId: string;
  definitionVersionId: string;
  submissionId: string;
  /** The requester's portal user; null for a contact with no portal login. */
  requesterUserId: string | null;
  /** The MSP user who filed this on the requester's behalf; null/omitted when self-filed. */
  submittedByUserId?: string | null;
  clientId: string;
  contactId?: string | null;
  payload: Record<string, unknown>;
  /**
   * The published version's form schema snapshot, which matches `payload`. Lets a provider
   * present the answers in the order and grouping the form asked them.
   */
  formSchema: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface ServiceRequestExecutionResult {
  status: 'succeeded' | 'failed';
  createdTicketId?: string;
  workflowExecutionId?: string;
  /** Where the portal should send the user next (e.g. a Stripe Checkout URL). Transient. */
  redirectUrl?: string;
  errorSummary?: string;
}

export interface ServiceRequestExecutionProvider {
  key: string;
  displayName: string;
  executionMode: ServiceRequestExecutionMode;
  validateConfig(config: Record<string, unknown>): ServiceRequestProviderValidationResult;
  execute(context: ServiceRequestExecutionContext): Promise<ServiceRequestExecutionResult>;
}

export interface ServiceRequestFormBehaviorContext {
  tenant: string;
  requesterUserId: string | null;
  clientId: string;
  contactId?: string | null;
}

export interface ServiceRequestFormBehaviorProvider {
  key: string;
  displayName: string;
  validateConfig(config: Record<string, unknown>): ServiceRequestProviderValidationResult;
  resolveInitialValues?(
    context: ServiceRequestFormBehaviorContext,
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  resolveVisibleFieldKeys?(
    context: ServiceRequestFormBehaviorContext,
    formSchema: Record<string, unknown>,
    values: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<string[]>;
}

export interface ServiceRequestVisibilityContext {
  tenant: string;
  requesterUserId: string | null;
  clientId: string;
  contactId?: string | null;
}

export interface ServiceRequestVisibilityProvider {
  key: string;
  displayName: string;
  validateConfig(config: Record<string, unknown>): ServiceRequestProviderValidationResult;
  canAccessDefinition(
    context: ServiceRequestVisibilityContext,
    definition: Pick<ServiceRequestDefinitionShape, 'tenant' | 'metadata' | 'linkedServiceId'>,
    config: Record<string, unknown>
  ): Promise<boolean>;
}

export interface ServiceRequestTemplateDraft {
  metadata: ServiceRequestPortalMetadata;
  linkedServiceId?: string | null;
  formSchema: Record<string, unknown>;
  providers: {
    executionProvider: string;
    executionConfig: Record<string, unknown>;
    formBehaviorProvider: string;
    formBehaviorConfig: Record<string, unknown>;
    visibilityProvider: string;
    visibilityConfig: Record<string, unknown>;
  };
}

export interface ServiceRequestTemplateDefinition {
  id: string;
  name: string;
  description: string;
  buildDraft(): ServiceRequestTemplateDraft;
}

export interface ServiceRequestTemplateProvider {
  key: string;
  displayName: string;
  listTemplates(): ServiceRequestTemplateDefinition[];
}

export interface ServiceRequestAdminExtensionProvider {
  key: string;
  displayName: string;
  getEditorSections?(): string[];
}

export interface ServiceRequestProviderRegistrations {
  executionProviders: ServiceRequestExecutionProvider[];
  formBehaviorProviders: ServiceRequestFormBehaviorProvider[];
  visibilityProviders: ServiceRequestVisibilityProvider[];
  templateProviders: ServiceRequestTemplateProvider[];
  adminExtensionProviders?: ServiceRequestAdminExtensionProvider[];
}
