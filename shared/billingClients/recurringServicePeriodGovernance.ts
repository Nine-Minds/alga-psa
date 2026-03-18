import type {
  IRecurringServicePeriodGovernanceRequirement,
  IRecurringServicePeriodRecord,
  RecurringServicePeriodGovernanceAction,
} from '@alga-psa/types';
import { RECURRING_SERVICE_PERIOD_GOVERNANCE_ACTIONS } from '@alga-psa/types';
import { evaluateRecurringServicePeriodMutationPermission } from './recurringServicePeriodMutations';

function resolveGovernanceMetadata(action: RecurringServicePeriodGovernanceAction): Pick<
  IRecurringServicePeriodGovernanceRequirement,
  'permissionKey' | 'auditEvent' | 'auditRequired'
> {
  switch (action) {
    case 'view':
      return {
        permissionKey: 'billing.recurring_service_periods.view',
        auditEvent: 'recurring_service_period.viewed',
        auditRequired: false,
      };
    case 'edit_boundaries':
      return {
        permissionKey: 'billing.recurring_service_periods.manage_future',
        auditEvent: 'recurring_service_period.boundary_adjusted',
        auditRequired: true,
      };
    case 'skip':
      return {
        permissionKey: 'billing.recurring_service_periods.manage_future',
        auditEvent: 'recurring_service_period.skipped',
        auditRequired: true,
      };
    case 'defer':
      return {
        permissionKey: 'billing.recurring_service_periods.manage_future',
        auditEvent: 'recurring_service_period.deferred',
        auditRequired: true,
      };
    case 'regenerate':
      return {
        permissionKey: 'billing.recurring_service_periods.regenerate',
        auditEvent: 'recurring_service_period.regenerated',
        auditRequired: true,
      };
    case 'invoice_linkage_repair':
      return {
        permissionKey: 'billing.recurring_service_periods.correct_history',
        auditEvent: 'recurring_service_period.invoice_linkage_repaired',
        auditRequired: true,
      };
    case 'archive':
      return {
        permissionKey: 'billing.recurring_service_periods.correct_history',
        auditEvent: 'recurring_service_period.archived',
        auditRequired: true,
      };
  }
}

export function getRecurringServicePeriodGovernanceRequirement(
  record: IRecurringServicePeriodRecord,
  action: RecurringServicePeriodGovernanceAction,
): IRecurringServicePeriodGovernanceRequirement {
  const metadata = resolveGovernanceMetadata(action);

  if (action === 'view') {
    return {
      action,
      ...metadata,
      allowed: true,
      reason: 'Service-period rows remain inspectable across lifecycle states when the caller has view permission.',
    };
  }

  const mutationDecision = evaluateRecurringServicePeriodMutationPermission(record, action);
  return {
    action,
    ...metadata,
    allowed: mutationDecision.allowed,
    reason: mutationDecision.reason,
  };
}

export function listRecurringServicePeriodGovernanceRequirements(
  record: IRecurringServicePeriodRecord,
): IRecurringServicePeriodGovernanceRequirement[] {
  return RECURRING_SERVICE_PERIOD_GOVERNANCE_ACTIONS.map((action) =>
    getRecurringServicePeriodGovernanceRequirement(record, action),
  );
}
