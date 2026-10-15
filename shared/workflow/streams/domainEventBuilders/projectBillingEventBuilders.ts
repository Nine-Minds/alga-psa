import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

/**
 * Builders for the project-billing workflow events (config + schedule lifecycle, milestone readiness,
 * payment-status derivation). `tenantId` / `occurredAt` / actor are stamped by `publishWorkflowEvent`
 * from the publish context, so none of these take a tenant.
 */

type ProjectBillingConfigPayloadInput = {
  projectId: string;
  configId: string;
  billingModel: string;
  invoiceMode: string;
  userId: string;
};

export function buildProjectBillingConfigCreatedPayload(params: ProjectBillingConfigPayloadInput) {
  return builtWorkflowPayload('PROJECT_BILLING_CONFIG_CREATED', {
    projectId: params.projectId,
    configId: params.configId,
    billingModel: params.billingModel,
    invoiceMode: params.invoiceMode,
    userId: params.userId,
  });
}

export function buildProjectBillingConfigUpdatedPayload(
  params: ProjectBillingConfigPayloadInput & { changes?: Record<string, unknown> },
) {
  return builtWorkflowPayload('PROJECT_BILLING_CONFIG_UPDATED', {
    projectId: params.projectId,
    configId: params.configId,
    billingModel: params.billingModel,
    invoiceMode: params.invoiceMode,
    userId: params.userId,
    changes: params.changes,
  });
}

export function buildProjectBillingConfigDeletedPayload(params: ProjectBillingConfigPayloadInput) {
  return builtWorkflowPayload('PROJECT_BILLING_CONFIG_DELETED', {
    projectId: params.projectId,
    configId: params.configId,
    billingModel: params.billingModel,
    invoiceMode: params.invoiceMode,
    userId: params.userId,
  });
}

type ProjectBillingScheduleEvents =
  | 'PROJECT_BILLING_SCHEDULE_ENTRY_CREATED'
  | 'PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED'
  | 'PROJECT_BILLING_SCHEDULE_STATUS_CHANGED'
  | 'PROJECT_BILLING_SCHEDULE_ENTRY_DELETED';

/**
 * Shared by PROJECT_BILLING_SCHEDULE_ENTRY_CREATED / _UPDATED / _STATUS_CHANGED / _ENTRY_DELETED.
 * `previousStatus` / `changes` / `userId` are present only on the flows that know them.
 */
export function buildProjectBillingSchedulePayload(params: {
  projectId: string;
  configId: string;
  entryId: string;
  description: string;
  status: string;
  previousStatus?: string | null;
  requiresPaymentBeforeWork: boolean;
  userId?: string;
  changes?: Record<string, unknown>;
}): Record<string, unknown> & BuiltWorkflowPayload<ProjectBillingScheduleEvents> {
  return builtWorkflowPayload<ProjectBillingScheduleEvents, Record<string, unknown>>(
    'PROJECT_BILLING_SCHEDULE_STATUS_CHANGED',
    {
      projectId: params.projectId,
      configId: params.configId,
      entryId: params.entryId,
      description: params.description,
      status: params.status,
      previousStatus: params.previousStatus,
      requiresPaymentBeforeWork: params.requiresPaymentBeforeWork,
      userId: params.userId,
      changes: params.changes,
    },
  );
}

export function buildProjectMilestoneReadyPayload(params: {
  projectId: string;
  entryId: string;
  description: string;
  computedAmount: number;
  trigger: 'date' | 'manual' | 'phase';
}) {
  return builtWorkflowPayload('PROJECT_MILESTONE_READY', {
    projectId: params.projectId,
    entryId: params.entryId,
    description: params.description,
    computedAmount: params.computedAmount,
    trigger: params.trigger,
  });
}

export function buildProjectBillingPaymentStatusChangedPayload(params: {
  projectId: string;
  configId: string;
  entryId: string;
  invoiceId: string;
  previousState: string;
  newState: string;
  previousInvoiceStatus?: string | null;
  newInvoiceStatus?: string | null;
  userId?: string;
}) {
  return builtWorkflowPayload('PROJECT_BILLING_PAYMENT_STATUS_CHANGED', {
    projectId: params.projectId,
    configId: params.configId,
    entryId: params.entryId,
    invoiceId: params.invoiceId,
    previousState: params.previousState,
    newState: params.newState,
    previousInvoiceStatus: params.previousInvoiceStatus,
    newInvoiceStatus: params.newInvoiceStatus,
    requiresPaymentBeforeWork: true,
    ...(params.userId ? { userId: params.userId } : {}),
  });
}

export function buildProjectBudgetThresholdReachedPayload(params: {
  projectId: string;
  threshold: number;
  billed: number;
  cap: number;
}) {
  return builtWorkflowPayload('PROJECT_BUDGET_THRESHOLD_REACHED', {
    projectId: params.projectId,
    threshold: params.threshold,
    billed: params.billed,
    cap: params.cap,
  });
}

export function buildProjectBudgetExceededPayload(params: {
  projectId: string;
  invoiceId: string;
  billed: number;
  attempted: number;
  cap: number;
  writtenDown: number;
}) {
  return builtWorkflowPayload('PROJECT_BUDGET_EXCEEDED', {
    projectId: params.projectId,
    invoiceId: params.invoiceId,
    billed: params.billed,
    attempted: params.attempted,
    cap: params.cap,
    writtenDown: params.writtenDown,
  });
}
