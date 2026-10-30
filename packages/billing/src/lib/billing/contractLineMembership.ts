// Not a 'use server' module: these helpers take a caller-owned transaction and a
// tenant id, so they must never be reachable as action endpoints. The actions in
// ../../actions/contractLineServiceActions.ts own auth and wrap these.
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type {
  IContractLineServiceRateTier,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IService,
} from '@alga-psa/types';
import { deleteTemplateServicePrices } from '@alga-psa/shared/billingClients/templateAmounts';
import { ContractLineServiceConfigurationService } from '../../services/contractLineServiceConfigurationService';
import { resolveContractLineServiceConfig } from '../contractLineServiceConfigPolicy';
import { fetchCurrencyCatalogRates } from '../../repositories/contractLineRepository';
import type {
  ContractLineServiceMembershipChanges,
} from '../../actions/contractLineServiceActions';

type TenantScopedKnex = Knex | Knex.Transaction;

export const TEMPLATE_RATE_TIERS_UNSUPPORTED =
  'Rate tiers are not supported on contract template lines; remove the tiers or configure them on a live contract line.';

export function tenantScopedTable(
  conn: TenantScopedKnex,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function findTemplateLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string
) {
  return tenantScopedTable(trx, tenant, 'contract_template_lines')
    .where({ template_line_id: contractLineId })
    .first();
}

async function addServiceToTemplateLine(
  trx: Knex.Transaction,
  tenant: string,
  templateLine: any,
  serviceId: string,
  quantity?: number,
  customRate?: number,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<
    IContractLineServiceFixedConfig |
    IContractLineServiceHourlyConfig |
    IContractLineServiceUsageConfig |
    IContractLineServiceBucketConfig
  >,
  // Template schema has no rate-tier table; non-empty tiers are rejected rather than dropped.
  rateTiers?: IContractLineServiceRateTier[],
) {
  if (rateTiers && rateTiers.length > 0) {
    throw new Error(TEMPLATE_RATE_TIERS_UNSUPPORTED);
  }
  const service = await tenantScopedTable(trx, tenant, 'service_catalog')
    .where({ service_id: serviceId })
    .first() as IService | undefined;

  if (!service) {
    throw new Error(`Service ${serviceId} not found`);
  }
  if (service.is_active === false) {
    throw new Error(`"${service.service_name}" is inactive and cannot be attached to contract lines.`);
  }

  const lineType: string = templateLine.line_type || 'Fixed';
  if (service.item_kind === 'product' && lineType !== 'Fixed') {
    throw new Error('Products can only be added to fixed-fee contract lines.');
  }

  // Same policy resolver the live-line path uses: one place decides the
  // configuration type and the per-type defaults.
  const { configurationType, typeConfig: policyTypeConfig } = resolveContractLineServiceConfig(
    lineType,
    configType,
    service,
    typeConfig,
  );

  let resolvedTypeConfig: Record<string, any> = { ...policyTypeConfig };
  if (configurationType === 'Bucket') {
    // Template buckets have no pool row to inherit the period from.
    resolvedTypeConfig = {
      ...resolvedTypeConfig,
      billing_period: resolvedTypeConfig.billing_period ?? templateLine.billing_frequency ?? 'monthly',
    };
  }

  const now = trx.fn.now();
  // Hourly and usage services bill on reported work, not a quantity: the
  // template wizard stores no quantity for them, and neither does this path.
  const resolvedQuantity: number | null = configurationType === 'Usage' || configurationType === 'Hourly'
    ? null
    : typeof quantity === 'number' && quantity > 0 ? quantity : 1;
  // A template stores its member rates in its own base currency. Absent an
  // explicit rate, snapshot the catalog price IN THAT CURRENCY (mode default,
  // then the current service_prices row); never the currency-untagged
  // service_catalog.default_rate. No price in the currency leaves the member
  // rate null so it follows the catalog.
  let resolvedRate: number | null = null;
  if (typeof customRate === 'number') {
    resolvedRate = customRate;
  } else {
    const template = await tenantScopedTable(trx, tenant, 'contract_templates')
      .where({ template_id: templateLine.template_id })
      .first('currency_code') as { currency_code?: string } | undefined;
    if (template?.currency_code) {
      const catalog = await fetchCurrencyCatalogRates(trx, tenant, [serviceId], 'fixed', template.currency_code);
      resolvedRate = catalog.modeDefaults.get(serviceId) ?? catalog.currentPrices.get(serviceId) ?? null;
    }
  }

  if (configurationType === 'Usage' && resolvedTypeConfig.base_rate === undefined && resolvedRate !== null) {
    resolvedTypeConfig = { ...resolvedTypeConfig, base_rate: resolvedRate };
  }

  const existingService = await tenantScopedTable(trx, tenant, 'contract_template_line_services')
    .where({ template_line_id: templateLine.template_line_id, service_id: serviceId })
    .first();

  if (existingService) {
    await tenantScopedTable(trx, tenant, 'contract_template_line_services')
      .where({ template_line_id: templateLine.template_line_id, service_id: serviceId })
      .update({
        quantity: resolvedQuantity,
        custom_rate: resolvedRate,
        updated_at: now,
      });
  } else {
    await tenantScopedTable(trx, tenant, 'contract_template_line_services').insert({
      tenant,
      template_line_id: templateLine.template_line_id,
      service_id: serviceId,
      quantity: resolvedQuantity,
      custom_rate: resolvedRate,
      created_at: now,
      updated_at: now,
    });
  }

  const existingConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
    .where({ template_line_id: templateLine.template_line_id, service_id: serviceId })
    .first();

  const configId = existingConfig ? existingConfig.config_id : uuidv4();

  if (existingConfig) {
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
      .where({ config_id: existingConfig.config_id })
      .update({
        configuration_type: configurationType,
        custom_rate: resolvedRate,
        quantity: resolvedQuantity,
        updated_at: now,
      });
  } else {
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration').insert({
      tenant,
      config_id: configId,
      template_line_id: templateLine.template_line_id,
      service_id: serviceId,
      configuration_type: configurationType,
      custom_rate: resolvedRate,
      quantity: resolvedQuantity,
      created_at: now,
      updated_at: now,
    });
  }

  const templateConfigService = new ContractLineServiceConfigurationService(trx, tenant);
  await templateConfigService.clearStaleTemplateTypeRows(trx, configId, configurationType);
  if (configurationType !== 'Fixed') {
    await templateConfigService.upsertTemplateTypeConfig(trx, configId, configurationType, resolvedTypeConfig);
  }

  return configId;
}

async function addServiceToLiveContractLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
  quantity?: number,
  customRate?: number | null,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<
    IContractLineServiceFixedConfig |
    IContractLineServiceHourlyConfig |
    IContractLineServiceUsageConfig |
    IContractLineServiceBucketConfig
  >,
  rateTiers?: IContractLineServiceRateTier[],
): Promise<string> {
  const service = await tenantScopedTable(trx, tenant, 'service_catalog')
    .where({ service_id: serviceId })
    .first() as IService | undefined;
  if (!service) {
    throw new Error(`Service ${serviceId} not found`);
  }

  const contractLine = await assertLiveContractLineIsAuthorable(trx, tenant, contractLineId);
  if (service.is_active === false) {
    throw new Error(`"${service.service_name}" is inactive and cannot be attached to contract lines.`);
  }

  if (service.item_kind === 'product') {
    if (contractLine.contract_line_type !== 'Fixed') {
      throw new Error('Products can only be added to fixed-fee contract lines.');
    }

    const contract = contractLine.contract_id
      ? await tenantScopedTable(trx, tenant, 'contracts')
          .where({ contract_id: contractLine.contract_id })
          .select('currency_code')
          .first()
      : null;
    const currencyCode = contract?.currency_code ?? 'USD';
    const hasOverride = customRate !== undefined && customRate !== null;
    if (!hasOverride) {
      const priceRow = await tenantScopedTable(trx, tenant, 'service_prices')
        .where({ service_id: serviceId, currency_code: currencyCode })
        .select('price_id')
        .first();
      if (!priceRow) {
        throw new Error(
          `Product "${service.service_name}" does not have ${currencyCode} pricing. Add a price in the catalog or enter a custom rate.`
        );
      }
    }
  }

  const { configurationType, typeConfig: policyTypeConfig } = resolveContractLineServiceConfig(
    contractLine.contract_line_type,
    configType,
    service,
    typeConfig,
  );

  let resolvedTypeConfig = policyTypeConfig;
  if (configurationType === 'Fixed') {
    // A stored fixed-member rate states its meaning. A per-unit service is
    // always per_unit; a bundle member's caller must say (the shared add-service
    // UIs snapshot a catalog unit price, so they stamp per_unit).
    const fixedTypeConfig = resolvedTypeConfig as Partial<IContractLineServiceFixedConfig>;
    if (fixedTypeConfig.base_rate != null && fixedTypeConfig.base_rate_basis == null && fixedTypeConfig.pricing_basis === 'unit') {
      resolvedTypeConfig = { ...fixedTypeConfig, base_rate_basis: 'per_unit' };
    }
  }

  const existingMembership = await tenantScopedTable(trx, tenant, 'contract_line_services')
    .where({ contract_line_id: contractLineId, service_id: serviceId })
    .first();
  if (!existingMembership) {
    await tenantScopedTable(trx, tenant, 'contract_line_services').insert({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
    });
  }

  const configurationService = new ContractLineServiceConfigurationService(trx, tenant);
  const existingConfig = await configurationService.getConfigurationForService(contractLineId, serviceId);
  if (existingConfig) {
    await configurationService.updateConfiguration(
      existingConfig.config_id,
      {
        configuration_type: configurationType,
        custom_rate: customRate,
        quantity: configurationType === 'Usage' ? undefined : quantity ?? 1,
      },
      resolvedTypeConfig,
      rateTiers,
    );
    return existingConfig.config_id;
  }

  return configurationService.createConfiguration(
    {
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: configurationType,
      custom_rate: customRate,
      quantity: configurationType === 'Usage' ? undefined : quantity ?? 1,
    },
    resolvedTypeConfig,
    rateTiers,
  );
}

async function assertLiveContractLineIsAuthorable(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
) {
  const contractLine = await tenantScopedTable(trx, tenant, 'contract_lines')
    .where({ contract_line_id: contractLineId })
    .first();
  if (!contractLine) {
    throw new Error(`Contract line ${contractLineId} not found`);
  }

  if (contractLine.contract_id) {
    const contract = await tenantScopedTable(trx, tenant, 'contracts')
      .where({ contract_id: contractLine.contract_id })
      .select('is_system_managed_default')
      .first();
    if (contract?.is_system_managed_default === true) {
      throw new Error('System-managed default contracts are attribution-only; contract-line service configuration authoring is disabled.');
    }
  }
  return contractLine;
}

async function removeServiceFromTemplateLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
): Promise<void> {
  const templateConfigs = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
    .where({ template_line_id: contractLineId, service_id: serviceId })
    .select('config_id');
  if (templateConfigs.length > 0) {
    const configIds = (templateConfigs as Array<{ config_id: string }>).map((config) => config.config_id);
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_fixed_config')
      .whereIn('config_id', configIds)
      .delete();
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_hourly_config')
      .whereIn('config_id', configIds)
      .delete();
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_usage_config')
      .whereIn('config_id', configIds)
      .delete();
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')
      .whereIn('config_id', configIds)
      .delete();
    await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
      .whereIn('config_id', configIds)
      .delete();
  }
  await tenantScopedTable(trx, tenant, 'contract_template_line_services')
    .where({ template_line_id: contractLineId, service_id: serviceId })
    .delete();
  // The service's per-currency prices go with it (price rows carry no FK on service_id).
  await deleteTemplateServicePrices(trx, tenant, contractLineId, serviceId);
}

async function removeServiceFromLiveContractLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
): Promise<void> {
  await assertLiveContractLineIsAuthorable(trx, tenant, contractLineId);
  const configurationService = new ContractLineServiceConfigurationService(trx, tenant);
  const configurations = await configurationService.getConfigurationsForPlan(contractLineId);
  for (const configuration of configurations) {
    if (configuration.service_id === serviceId) {
      await configurationService.deleteConfiguration(configuration.config_id);
    }
  }
  await tenantScopedTable(trx, tenant, 'contract_line_services')
    .where({ contract_line_id: contractLineId, service_id: serviceId })
    .delete();
}

export async function addServiceToContractLineInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
  quantity?: number,
  customRate?: number | null,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<
    IContractLineServiceFixedConfig |
    IContractLineServiceHourlyConfig |
    IContractLineServiceUsageConfig |
    IContractLineServiceBucketConfig
  >,
  rateTiers?: IContractLineServiceRateTier[],
): Promise<string> {
  const templateLine = await findTemplateLine(trx, tenant, contractLineId);
  if (templateLine) {
    return addServiceToTemplateLine(
      trx,
      tenant,
      templateLine,
      serviceId,
      quantity,
      customRate ?? undefined,
      configType,
      typeConfig,
      rateTiers,
    );
  }
  return addServiceToLiveContractLine(
    trx,
    tenant,
    contractLineId,
    serviceId,
    quantity,
    customRate,
    configType,
    typeConfig,
    rateTiers,
  );
}

export async function removeServiceFromContractLineInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
): Promise<void> {
  const templateLine = await findTemplateLine(trx, tenant, contractLineId);
  if (templateLine) {
    await removeServiceFromTemplateLine(trx, tenant, contractLineId, serviceId);
    return;
  }
  await removeServiceFromLiveContractLine(trx, tenant, contractLineId, serviceId);
}


/**
 * Removals then additions on a caller-owned transaction. Writes only; callers own
 * validation, permission checks and rematerialization.
 */
export async function applyContractLineServiceMembershipChangesInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  changes: ContractLineServiceMembershipChanges,
): Promise<void> {
  for (const serviceId of changes.removals) {
    await removeServiceFromContractLineInTransaction(trx, tenant, contractLineId, serviceId);
  }
  for (const addition of changes.additions) {
    await addServiceToContractLineInTransaction(
      trx,
      tenant,
      contractLineId,
      addition.serviceId,
      addition.quantity,
      addition.customRate,
      addition.configurationType,
      addition.typeConfig,
      addition.rateTiers,
    );
  }
}
