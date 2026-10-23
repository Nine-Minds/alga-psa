import type {
  IContractLineServiceBucketConfig,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
} from '@alga-psa/types';

export type ContractLineType = 'Fixed' | 'Hourly' | 'Usage';
export type ContractLineServiceConfigurationType = ContractLineType | 'Bucket';

export type ContractLineServiceTypeConfig = Partial<
  IContractLineServiceFixedConfig |
  IContractLineServiceHourlyConfig |
  IContractLineServiceUsageConfig |
  IContractLineServiceBucketConfig
>;

/** The catalog item a per-type default reads. */
export interface ContractLineServiceRateSource {
  service_name?: string;
  default_rate?: number | null;
}

export const allowedConfigTypesByLine: Record<
  ContractLineType,
  ContractLineServiceConfigurationType[]
> = {
  Fixed: ['Fixed', 'Bucket'],
  Hourly: ['Hourly', 'Bucket'],
  Usage: ['Usage', 'Bucket'],
};

export function resolveContractLineServiceConfigurationType(
  lineType: string,
  requestedConfigType?: ContractLineServiceConfigurationType,
): ContractLineServiceConfigurationType {
  const configurationType =
    requestedConfigType ?? (lineType as ContractLineServiceConfigurationType);
  const allowedConfigTypes =
    allowedConfigTypesByLine[lineType as ContractLineType] ?? ['Fixed'];
  if (!allowedConfigTypes.includes(configurationType)) {
    throw new Error(
      `Configuration type ${configurationType} is not valid for ${lineType} contract lines. Allowed: ${allowedConfigTypes.join(', ')}.`
    );
  }
  return configurationType;
}

/**
 * Resolve the configuration type for a service on a contract line and fill in
 * the per-type defaults that do not depend on the storage shape. Live contract
 * lines and contract template lines share this so a service added to either
 * lands with the same type and the same defaulted rates.
 *
 * The line's own type is the billing mode: any catalog service may be added
 * under Fixed, Hourly or Usage regardless of its catalog billing_method (see
 * ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling).
 */
export function resolveContractLineServiceConfig(
  lineType: string,
  requestedConfigType: ContractLineServiceConfigurationType | undefined,
  service: ContractLineServiceRateSource,
  typeConfig?: ContractLineServiceTypeConfig,
): {
  configurationType: ContractLineServiceConfigurationType;
  typeConfig: ContractLineServiceTypeConfig;
} {
  const configurationType = resolveContractLineServiceConfigurationType(lineType, requestedConfigType);

  let resolvedTypeConfig: ContractLineServiceTypeConfig = typeConfig || {};
  if (configurationType === 'Bucket') {
    resolvedTypeConfig = {
      ...resolvedTypeConfig,
      overage_rate:
        (resolvedTypeConfig as Partial<IContractLineServiceBucketConfig>).overage_rate
        ?? service.default_rate
        ?? undefined,
    };
  } else if (configurationType === 'Hourly') {
    const providedHourly = resolvedTypeConfig as Partial<IContractLineServiceHourlyConfig>;
    const hourlyRateValue = providedHourly.hourly_rate ?? service.default_rate;
    if (hourlyRateValue === undefined || hourlyRateValue === null) {
      throw new Error(`Service ${service.service_name} requires an hourly rate before it can be added to an hourly contract line.`);
    }
    const hourlyRate = Number(hourlyRateValue);
    if (!Number.isFinite(hourlyRate)) {
      throw new Error(`Hourly rate for service ${service.service_name} must be a numeric value.`);
    }
    resolvedTypeConfig = {
      ...providedHourly,
      hourly_rate: hourlyRate,
      minimum_billable_time:
        Number(providedHourly.minimum_billable_time) > 0
          ? Number(providedHourly.minimum_billable_time)
          : 15,
      round_up_to_nearest:
        Number(providedHourly.round_up_to_nearest) > 0
          ? Number(providedHourly.round_up_to_nearest)
          : 15,
    };
  }

  return { configurationType, typeConfig: resolvedTypeConfig };
}
