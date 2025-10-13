'use server';

// Contract-line centric aliases for plan service configuration actions.
// Keeps backwards compatibility while moving callers to contract-line naming.

export {
  // Original names (back-compat)
  getConfigurationWithDetails,
  getConfigurationsForPlan,
  getConfigurationForService,
  createConfiguration,
  updateConfiguration,
  deleteConfiguration,
  upsertPlanServiceConfiguration,
  upsertPlanServiceHourlyConfiguration,
  upsertPlanServiceBucketConfigurationAction,
} from './planServiceConfigurationActions';

// New, contract-line-centric export aliases
export {
  getConfigurationsForPlan as getConfigurationsForContractLine,
  getConfigurationForService as getContractLineConfigurationForService,
  upsertPlanServiceConfiguration as upsertContractLineServiceConfiguration,
  upsertPlanServiceHourlyConfiguration as upsertContractLineServiceHourlyConfiguration,
  upsertPlanServiceBucketConfigurationAction as upsertContractLineServiceBucketConfigurationAction,
} from './planServiceConfigurationActions';

