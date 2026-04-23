import type { Knex } from 'knex';

export type AuthorizationDecisionStage = 'rbac' | 'builtin' | 'bundle' | 'mutation' | 'redaction';

export interface AuthorizationReason {
  stage: AuthorizationDecisionStage;
  code: string;
  message: string;
  sourceType?: 'builtin' | 'bundle' | 'system';
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthorizationSubject {
  tenant: string;
  userId: string;
  userType: 'internal' | 'client';
  roleIds?: string[];
  teamIds?: string[];
  clientId?: string | null;
  managedUserIds?: string[];
  portfolioClientIds?: string[];
  apiKeyId?: string | null;
}

export interface AuthorizationResourceRef {
  type: string;
  action: string;
  id?: string | null;
}

export type ScopeFieldOperator = 'eq' | 'in';

export interface ScopeConstraint {
  field: string;
  operator: ScopeFieldOperator;
  value: unknown;
}

export interface AuthorizationScope {
  allowAll: boolean;
  denied: boolean;
  constraints: ScopeConstraint[];
}

export interface AuthorizationRecord {
  id?: string | null;
  ownerUserId?: string | null;
  assignedUserIds?: string[];
  clientId?: string | null;
  boardId?: string | null;
  teamIds?: string[];
  [key: string]: unknown;
}

export interface AuthorizationMutationInput {
  kind: string;
  record?: AuthorizationRecord;
  next?: Record<string, unknown>;
}

export interface AuthorizationEvaluationInput {
  subject: AuthorizationSubject;
  resource: AuthorizationResourceRef;
  record?: AuthorizationRecord;
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
  selectedTeamIds?: string[];
  mutation?: AuthorizationMutationInput;
  requestCache?: AuthorizationRequestCache;
  knex?: Knex | Knex.Transaction;
}

export interface AuthorizationMutationDecision {
  allowed: boolean;
  reasons: AuthorizationReason[];
}

export interface AuthorizationDecision {
  allowed: boolean;
  scope: AuthorizationScope;
  redactedFields: string[];
  reasons: AuthorizationReason[];
}

export interface AuthorizationKernel {
  authorizeResource(input: AuthorizationEvaluationInput): Promise<AuthorizationDecision>;
  resolveScope(input: AuthorizationEvaluationInput): Promise<AuthorizationScope>;
  authorizeMutation(input: AuthorizationEvaluationInput): Promise<AuthorizationMutationDecision>;
  resolveFieldRedactions(input: AuthorizationEvaluationInput): Promise<string[]>;
  explainDecision(input: AuthorizationEvaluationInput): Promise<AuthorizationReason[]>;
}

export type RelationshipTemplateKey =
  | 'own'
  | 'assigned'
  | 'managed'
  | 'own_or_assigned'
  | 'own_or_managed'
  | 'same_client'
  | 'client_portfolio'
  | 'selected_clients'
  | 'same_team'
  | 'selected_boards';

export interface RelationshipRule {
  template: RelationshipTemplateKey;
  sourceId?: string;
}

export interface BuiltinAuthorizationResult {
  allowed: boolean;
  scope: AuthorizationScope;
  reasons: AuthorizationReason[];
}

export interface BundleAuthorizationResult {
  scope: AuthorizationScope;
  reasons: AuthorizationReason[];
  mutationDeniedReason?: AuthorizationReason | null;
  redactedFields?: string[];
}

export interface MutationGuardResult {
  allowed: boolean;
  reasons: AuthorizationReason[];
}

export interface FieldRedactionResult {
  fields: string[];
  reasons: AuthorizationReason[];
}

export interface BuiltinAuthorizationProvider {
  evaluate(input: AuthorizationEvaluationInput): Promise<BuiltinAuthorizationResult>;
  authorizeMutation(input: AuthorizationEvaluationInput): Promise<MutationGuardResult>;
  resolveFieldRedactions(input: AuthorizationEvaluationInput): Promise<FieldRedactionResult>;
}

export interface BundleAuthorizationProvider {
  evaluateNarrowing(input: AuthorizationEvaluationInput): Promise<BundleAuthorizationResult>;
}

export type RbacEvaluator = (input: AuthorizationEvaluationInput) => Promise<boolean>;

export interface AuthorizationRequestCache {
  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T>;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

export interface AuthorizationKernelFactoryInput {
  builtinProvider: BuiltinAuthorizationProvider;
  bundleProvider?: BundleAuthorizationProvider;
  rbacEvaluator: RbacEvaluator;
}
