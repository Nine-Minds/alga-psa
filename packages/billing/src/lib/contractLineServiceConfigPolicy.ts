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

/** The catalog item a per-type default (and the mismatch guard) reads. */
export interface ContractLineServiceRateSource {
  service_name?: string;
  default_rate?: number | null;
  billing_method?: string | null;
  item_kind?: string | null;
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

const SERVICE_BILLING_METHOD_LABELS: Record<string, string> = {
  fixed: 'a fixed-fee',
  hourly: 'an hourly',
  usage: 'a usage-based',
};

const CONFIGURATION_TARGET_LABELS: Record<ContractLineServiceConfigurationType, string> = {
  Fixed: 'a fixed fee contract line',
  Hourly: 'an hourly contract line',
  Usage: 'a usage-based contract line',
  Bucket: 'a bucket contract line',
};

/**
 * Rejects a catalog item whose billing method does not match the configuration
 * it is being attached to — the rule Manage Services already applies when it
 * filters the add list, enforced here so the wizard pickers and the server
 * agree. Products are exempt on Fixed configurations: they carry 'usage' by
 * design and fixed fee lines are the only place they are allowed at all.
 */
export function assertServiceMatchesConfigurationType(
  configurationType: ContractLineServiceConfigurationType,
  service: ContractLineServiceRateSource,
): void {
  const billingMethod = service.billing_method ?? null;
  if (!billingMethod) {
    return;
  }

  const itemLabel = service.service_name ? `"${service.service_name}"` : 'This catalog item';
  const methodLabel = SERVICE_BILLING_METHOD_LABELS[billingMethod] ?? `a ${billingMethod}`;
  const targetLabel = CONFIGURATION_TARGET_LABELS[configurationType];

  if (configurationType === 'Fixed') {
    if (service.item_kind === 'product' || billingMethod === 'fixed') {
      return;
    }
    throw new Error(`${itemLabel} is ${methodLabel} service and cannot be added to ${targetLabel}.`);
  }

  if (billingMethod === 'fixed') {
    throw new Error(`${itemLabel} is ${methodLabel} service and cannot be added to ${targetLabel}.`);
  }
}

/**
 * Resolve the configuration type for a service on a contract line, reject a
 * service whose billing method the line cannot bill, and fill in the per-type
 * defaults that do not depend on the storage shape. Live contract lines and
 * contract template lines share this so a service added to either lands with
 * the same type, the same guard and the same defaulted rates.
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
  assertServiceMatchesConfigurationType(configurationType, service);

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
