'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { IContractLineServiceRateTier, IUserTypeRate, IContractLineServiceConfiguration, IContractLineServiceFixedConfig, IContractLineServiceHourlyConfig, IContractLineServiceUsageConfig, IContractLineServiceBucketConfig } from '@alga-psa/types';
import { IContractLineService } from '@alga-psa/types';
import { IService } from '@alga-psa/types';

import { v4 as uuidv4 } from 'uuid';
import { ContractLineServiceConfigurationService } from '../services/contractLineServiceConfigurationService';
import * as planServiceConfigActions from './contractLineServiceConfigurationActions';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

type TenantScopedKnex = Knex | Knex.Transaction;
export type ContractLineServiceActionError = ActionMessageError | ActionPermissionError;

type ContractLineServiceWithConfiguration = {
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
  userTypeRates?: IUserTypeRate[];
  bucketConfig?: IContractLineServiceBucketConfig | null;
};

type TemplateLineServiceWithConfiguration = {
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
  bucketConfig?: IContractLineServiceBucketConfig | null;
};

function isReturnedActionError(value: unknown): value is ContractLineServiceActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function contractLineServiceActionErrorFrom(error: unknown): ContractLineServiceActionError | null {
  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }

  if (error instanceof Error) {
    if (
      error.message === 'Service management for template lines currently supports fixed fee lines only.' ||
      error.message === 'Products can only be added to fixed-fee contract lines.' ||
      error.message.includes('cannot be attached to contract lines') ||
      error.message.includes('does not have') ||
      error.message.includes('requires an hourly rate') ||
      error.message.includes('must be a numeric value') ||
      error.message.includes('Configuration type')
    ) {
      return actionError(error.message);
    }
    if (error.message.includes('not found')) {
      return actionError('The selected contract line service is no longer available. Please refresh and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected service values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required service field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected contract line or service no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This service is already associated with the selected contract line.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the service values is not allowed. Please review the form and try again.');
  }

  return null;
}

function tenantScopedTable(
  conn: TenantScopedKnex,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function findTemplateLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string
) {
  return tenantScopedTable(trx, tenant, 'contract_template_lines')
    .where({ template_line_id: contractLineId })
    .first();
}

function mapTemplateServiceRow(row: any): IContractLineService {
  return {
    tenant: row.tenant,
    contract_line_id: row.template_line_id,
    service_id: row.service_id,
    quantity: row.quantity != null ? Number(row.quantity) : undefined,
    custom_rate: row.custom_rate != null ? Number(row.custom_rate) : undefined,
  };
}

/**
 * Get all services for a plan
 */
export const getContractLineServices = withAuth(async (
  user,
  { tenant },
  contractLineId: string
): Promise<IContractLineService[] | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex: db } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const templateLine = await findTemplateLine(trx, tenant, contractLineId);
      if (templateLine) {
        const services = await tenantScopedTable(trx, tenant, 'contract_template_line_services')
          .where({
            template_line_id: contractLineId,
          })
          .select('*');

        return services.map(mapTemplateServiceRow);
      }

      const services = await tenantScopedTable(trx, tenant, 'contract_line_services')
        .where({
          contract_line_id: contractLineId,
        })
        .select('*');

      return services as Array<IContractLineService & { service_name?: string }>;
    });
  } catch (error) {
    console.error(`Error fetching services for contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get all services for a contract line with service names
 */
export const getContractLineServicesWithNames = withAuth(async (
  user,
  { tenant },
  contractLineId: string
): Promise<Array<IContractLineService & { service_name?: string }> | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const facade = tenantDb(trx, tenant);
      const query = facade.table('contract_line_services as cls');
      facade.tenantJoin(query, 'service_catalog as sc', 'cls.service_id', 'sc.service_id', { type: 'left' });

      const services = await query
        .where({
          'cls.contract_line_id': contractLineId,
        })
        .select(
          'cls.*',
          'sc.service_name'
        );

      return services as unknown as Array<IContractLineService & { service_name?: string }>;
    });
  } catch (error) {
    console.error(`Error fetching named services for contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get a specific service in a plan
 */
export const getContractLineService = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string
): Promise<IContractLineService | ContractLineServiceActionError | null> => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex: db } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const templateLine = await findTemplateLine(trx, tenant, contractLineId);
      if (templateLine) {
        const service = await tenantScopedTable(trx, tenant, 'contract_template_line_services')
          .where({
            template_line_id: contractLineId,
            service_id: serviceId,
          })
          .first();

        return service ? mapTemplateServiceRow(service) : null;
      }

      const service = await tenantScopedTable(trx, tenant, 'contract_line_services')
        .where({
          contract_line_id: contractLineId,
          service_id: serviceId,
        })
        .first();

      return service || null;
    });
  } catch (error) {
    console.error(`Error fetching service ${serviceId} for contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

async function addServiceToTemplateLine(
  trx: Knex.Transaction,
  tenant: string,
  templateLine: any,
  serviceId: string,
  quantity?: number,
  customRate?: number
) {
  if (templateLine.line_type && templateLine.line_type !== 'Fixed') {
    throw new Error('Service management for template lines currently supports fixed fee lines only.');
  }

  const service = await tenantScopedTable(trx, tenant, 'service_catalog')
    .where({ service_id: serviceId })
    .first() as IService | undefined;

  if (!service) {
    throw new Error(`Service ${serviceId} not found`);
  }

  const now = trx.fn.now();
  const resolvedQuantity = typeof quantity === 'number' && quantity > 0 ? quantity : 1;
  const resolvedRate =
    typeof customRate === 'number'
      ? customRate
      : service.default_rate != null
        ? Number(service.default_rate)
        : null;

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
        configuration_type: 'Fixed',
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
      configuration_type: 'Fixed',
      custom_rate: resolvedRate,
      quantity: resolvedQuantity,
      created_at: now,
      updated_at: now,
    });
  }

  return configId;
}

/**
 * Add a service to a plan with configuration
 */
export const addServiceToContractLine = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  quantity?: number,
  customRate?: number,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>
): Promise<string | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: billing create required');
    }
    const { knex: db } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const templateLine = await findTemplateLine(trx, tenant, contractLineId);
      if (templateLine) {
        return addServiceToTemplateLine(trx, tenant, templateLine, serviceId, quantity, customRate);
      }

      const service = await tenantScopedTable(trx, tenant, 'service_catalog')
        .where({
          service_id: serviceId,
        })
        .first() as IService | undefined;

      if (!service) {
        throw new Error(`Service ${serviceId} not found`);
      }

      const plan = await tenantScopedTable(trx, tenant, 'contract_lines')
        .where({
          contract_line_id: contractLineId,
        })
        .first();

      if (!plan) {
        throw new Error(`Contract line ${contractLineId} not found`);
      }

      if (service.is_active === false) {
        throw new Error(`"${service.service_name}" is inactive and cannot be attached to contract lines.`);
      }

      if (service.item_kind === 'product') {
        if (plan.contract_line_type !== 'Fixed') {
          throw new Error(`Products can only be added to fixed-fee contract lines.`);
        }

        const contract = plan.contract_id
          ? await tenantScopedTable(trx, tenant, 'contracts').where({ contract_id: plan.contract_id }).select('currency_code').first()
          : null;
        const currencyCode = contract?.currency_code ?? 'USD';

        const hasOverride = customRate !== undefined && customRate !== null;
        if (!hasOverride) {
          const priceRow = await tenantScopedTable(trx, tenant, 'service_prices')
            .where({
              service_id: serviceId,
              currency_code: currencyCode
            })
            .select('price_id')
            .first();

          if (!priceRow) {
            throw new Error(
              `Product "${service.service_name}" does not have ${currencyCode} pricing. Add a price in the catalog or enter a custom rate.`
            );
          }
        }
      }

      const allowedConfigTypesByPlan: Record<'Fixed' | 'Hourly' | 'Usage', Array<'Fixed' | 'Hourly' | 'Usage' | 'Bucket'>> = {
        Fixed: ['Fixed', 'Bucket'],
        Hourly: ['Hourly', 'Bucket'],
        Usage: ['Usage', 'Bucket'],
      };

      if (configType) {
        const allowedConfigTypes = allowedConfigTypesByPlan[plan.contract_line_type as 'Fixed' | 'Hourly' | 'Usage'] ?? ['Fixed'];
        if (!allowedConfigTypes.includes(configType)) {
          throw new Error(
            `Configuration type ${configType} is not valid for ${plan.contract_line_type} contract lines. Allowed: ${allowedConfigTypes.join(', ')}.`
          );
        }
      }

      const determinedConfigType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' = configType
        ?? (
          plan.contract_line_type === 'Hourly'
            ? 'Hourly'
            : plan.contract_line_type === 'Usage'
              ? 'Usage'
              : 'Fixed'
        );

      const configurationType = determinedConfigType;
      let hourlyConfigPayload: Partial<IContractLineServiceHourlyConfig> | undefined;

      if (configurationType === 'Bucket') {
        typeConfig = typeConfig || {};
        if ((typeConfig as Partial<IContractLineServiceBucketConfig>)?.overage_rate === undefined) {
          (typeConfig as Partial<IContractLineServiceBucketConfig>).overage_rate = service.default_rate;
        }
      } else if (configurationType === 'Hourly') {
        const providedHourly = (typeConfig as Partial<IContractLineServiceHourlyConfig>) || {};
        const resolvedHourlyRate =
          typeof providedHourly.hourly_rate !== 'undefined'
            ? providedHourly.hourly_rate
            : service.default_rate;

        if (resolvedHourlyRate === undefined || resolvedHourlyRate === null) {
          throw new Error(`Service ${service.service_name} requires an hourly rate before it can be added to an hourly contract line.`);
        }

        const normalizedHourlyRate = Number(resolvedHourlyRate);
        if (Number.isNaN(normalizedHourlyRate)) {
          throw new Error(`Hourly rate for service ${service.service_name} must be a numeric value.`);
        }

        const minimumBillableCandidate = Number(
          typeof providedHourly.minimum_billable_time !== 'undefined'
            ? providedHourly.minimum_billable_time
            : 15
        );
        const roundUpCandidate = Number(
          typeof providedHourly.round_up_to_nearest !== 'undefined'
            ? providedHourly.round_up_to_nearest
            : 15
        );

        const minimumBillableTime = Number.isFinite(minimumBillableCandidate) && minimumBillableCandidate > 0
          ? minimumBillableCandidate
          : 15;
        const roundUpToNearest = Number.isFinite(roundUpCandidate) && roundUpCandidate > 0
          ? roundUpCandidate
          : 15;

        hourlyConfigPayload = {
          hourly_rate: normalizedHourlyRate,
          minimum_billable_time: minimumBillableTime,
          round_up_to_nearest: roundUpToNearest,
        };

        typeConfig = hourlyConfigPayload;
      }

      const existingPlanService = await getContractLineService(contractLineId, serviceId);
      if (isReturnedActionError(existingPlanService)) {
        return existingPlanService;
      }

      if (!existingPlanService) {
        await tenantScopedTable(trx, tenant, 'contract_line_services').insert({
          contract_line_id: contractLineId,
          service_id: serviceId,
          tenant: tenant
        });
      }

      const existingConfig = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);
      if (isReturnedActionError(existingConfig)) {
        return existingConfig;
      }

      let configId: string | ContractLineServiceActionError;

      if (existingConfig) {
        const updateResult = await planServiceConfigActions.updateConfiguration(
          existingConfig.config_id,
          {
            configuration_type: configurationType,
            custom_rate: customRate,
            quantity: quantity || 1
          },
          typeConfig || {}
        );
        if (isReturnedActionError(updateResult)) {
          return updateResult;
        }
        configId = existingConfig.config_id;
      } else {
        configId = await planServiceConfigActions.createConfiguration(
          {
            contract_line_id: contractLineId,
            service_id: serviceId,
            configuration_type: configurationType,
            custom_rate: customRate,
            quantity: quantity || 1,
            tenant: tenant!
          },
          typeConfig || {}
        );
        if (isReturnedActionError(configId)) {
          return configId;
        }
      }

      if (configurationType === 'Hourly' && hourlyConfigPayload) {
        const hourlyResult = await planServiceConfigActions.upsertPlanServiceHourlyConfiguration(
          contractLineId,
          serviceId,
          hourlyConfigPayload
        );
        if (isReturnedActionError(hourlyResult)) {
          return hourlyResult;
        }
      }

      return configId;
    });
  } catch (error) {
    console.error(`Error adding service ${serviceId} to contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Update a service in a plan
 */
export const updateContractLineService = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  updates: {
    quantity?: number;
    customRate?: number | null;
    typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>;
  },
  rateTiers?: IContractLineServiceRateTier[] // Add rateTiers here
): Promise<boolean | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'update')) {
      return permissionError('Permission denied: billing update required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const config = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);
      if (isReturnedActionError(config)) {
        return config;
      }

      if (!config) {
        throw new Error(`Configuration for service ${serviceId} in contract line ${contractLineId} not found`);
      }

      const baseUpdates: Partial<IContractLineServiceConfiguration> = {};
      if (updates.quantity !== undefined) {
        baseUpdates.quantity = updates.quantity;
      }
      if (updates.customRate !== undefined) {
        baseUpdates.custom_rate = updates.customRate;
      }

      const updateResult = await planServiceConfigActions.updateConfiguration(
        config.config_id,
        Object.keys(baseUpdates).length > 0 ? baseUpdates : undefined,
        updates.typeConfig,
        rateTiers
      );
      if (isReturnedActionError(updateResult)) {
        return updateResult;
      }

      if (
        config.configuration_type === 'Hourly' &&
        updates.typeConfig &&
        typeof (updates.typeConfig as IContractLineServiceHourlyConfig).hourly_rate !== 'undefined'
      ) {
        const hourlyPayload: Partial<IContractLineServiceHourlyConfig> = {
          hourly_rate: (updates.typeConfig as IContractLineServiceHourlyConfig).hourly_rate,
          minimum_billable_time: (updates.typeConfig as IContractLineServiceHourlyConfig).minimum_billable_time,
          round_up_to_nearest: (updates.typeConfig as IContractLineServiceHourlyConfig).round_up_to_nearest,
        };

        const hourlyResult = await planServiceConfigActions.upsertPlanServiceHourlyConfiguration(
          contractLineId,
          serviceId,
          hourlyPayload
        );
        if (isReturnedActionError(hourlyResult)) {
          return hourlyResult;
        }
      }

      return true;
    });
  } catch (error) {
    console.error(`Error updating service ${serviceId} for contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Remove a service from a plan
 */
export const removeServiceFromContractLine = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string
): Promise<boolean | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'delete')) {
      return permissionError('Permission denied: billing delete required');
    }
    const { knex: db } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const templateLine = await findTemplateLine(trx, tenant, contractLineId);
      if (templateLine) {
        const templateConfigs = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
          .where({
            template_line_id: contractLineId,
            service_id: serviceId,
          })
          .select('config_id');

        if (templateConfigs.length > 0) {
          const configIds = (templateConfigs as any[]).map((config: any) => config.config_id);

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
          .where({
            template_line_id: contractLineId,
            service_id: serviceId,
          })
          .delete();

        return true;
      }

      const config = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);
      if (isReturnedActionError(config)) {
        return config;
      }

      if (config) {
        const deleteResult = await planServiceConfigActions.deleteConfiguration(config.config_id);
        if (isReturnedActionError(deleteResult)) {
          return deleteResult;
        }
      }

      await tenantScopedTable(trx, tenant, 'contract_line_services')
        .where({
          contract_line_id: contractLineId,
          service_id: serviceId,
        })
        .delete();

      return true;
    });
  } catch (error) {
    console.error(`Error removing service ${serviceId} from contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get all services in a plan with their configurations, service type name, and user type rates (for hourly).
 * Bucket configurations are merged into their parent Hourly/Usage configurations as a nested property.
 */
export const getContractLineServicesWithConfigurations = withAuth(async (
  user,
  { tenant },
  contractLineId: string
): Promise<ContractLineServiceWithConfiguration[] | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex: db } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    return withTransaction(db, async (trx: Knex.Transaction) => {
    const templateLine = await findTemplateLine(trx, tenant, contractLineId);
    if (templateLine) {
      const configurations = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
        .where({
          template_line_id: contractLineId,
        })
        .select('*');

      const results: ContractLineServiceWithConfiguration[] = [];

      for (const config of configurations) {
        const facade = tenantDb(trx, tenant);
        const query = facade.table('service_catalog as sc');
        facade.tenantJoin(query, 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' });

        const service = await query
          .where({
            'sc.service_id': config.service_id,
          })
          .select('sc.*', 'st.name as service_type_name')
          .first() as IService & { service_type_name?: string } | undefined;

        if (!service) {
          continue;
        }

        let typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null =
          null;

        if (config.configuration_type === 'Bucket') {
          typeConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')
            .where({ config_id: config.config_id })
            .first();
        } else if (config.configuration_type === 'Hourly') {
          typeConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_hourly_config')
            .where({ config_id: config.config_id })
            .first();
        } else if (config.configuration_type === 'Usage') {
          typeConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_usage_config')
            .where({ config_id: config.config_id })
            .first();
        }

        results.push({
          service,
          configuration: {
            ...config,
            contract_line_id: config.template_line_id,
          },
          typeConfig,
        });
      }

      return results;
    }

  // Get all configurations for the plan
  const configurations = await planServiceConfigActions.getConfigurationsForPlan(contractLineId);
  if (isReturnedActionError(configurations)) {
    return configurations;
  }

  // Group configurations by service_id to merge bucket configs
  const configsByService = new Map<string, IContractLineServiceConfiguration[]>();
  for (const config of configurations) {
    if (!configsByService.has(config.service_id)) {
      configsByService.set(config.service_id, []);
    }
    configsByService.get(config.service_id)!.push(config);
  }

  // Build result with merged bucket configs
  const result: ContractLineServiceWithConfiguration[] = [];

  for (const [serviceId, serviceConfigs] of configsByService.entries()) {
    // Find primary config (Hourly, Usage, or Fixed) and bucket config
    const primaryConfig = serviceConfigs.find(c => c.configuration_type !== 'Bucket');
    const bucketConfigRecord = serviceConfigs.find(c => c.configuration_type === 'Bucket');

    // If no primary config exists, use bucket as primary (standalone bucket service)
    const configToUse = primaryConfig || bucketConfigRecord;

    if (!configToUse) {
      continue;
    }

    // Join service_catalog with service_types to get the name
    const facade = tenantDb(trx, tenant);
    const query = facade.table('service_catalog as sc');
    facade.tenantJoin(query, 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' });

    const service = await query
      .where({
        'sc.service_id': serviceId,
      })
      .select('sc.*', 'st.name as service_type_name')
      .first() as unknown as IService & { service_type_name?: string };

    if (!service) {
      continue;
    }

    const configDetails = await planServiceConfigActions.getConfigurationWithDetails(configToUse.config_id);
    if (isReturnedActionError(configDetails)) {
      return configDetails;
    }

    let userTypeRates: IUserTypeRate[] | undefined = undefined;

    // If it's an hourly config, fetch user type rates
    if (configToUse.configuration_type === 'Hourly') {
      const hourlyConfigModel = new (await import('../models/contractLineServiceHourlyConfig')).default(trx);
      userTypeRates = await hourlyConfigModel.getUserTypeRates(configToUse.config_id);
    }

    // Fetch bucket config details if it exists
    let bucketConfigDetails: IContractLineServiceBucketConfig | null = null;
    if (bucketConfigRecord) {
      const bucketDetails = await planServiceConfigActions.getConfigurationWithDetails(bucketConfigRecord.config_id);
      if (isReturnedActionError(bucketDetails)) {
        return bucketDetails;
      }
      bucketConfigDetails = bucketDetails.typeConfig as IContractLineServiceBucketConfig;
    }

    result.push({
      service,
      configuration: configToUse,
      typeConfig: configDetails.typeConfig,
      userTypeRates: userTypeRates,
      bucketConfig: bucketConfigDetails // Add the merged bucket config
      });
    }

    return result;
    });
  } catch (error) {
    console.error(`Error fetching services with configurations for contract line ${contractLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getTemplateLineServicesWithConfigurations = withAuth(async (
  user,
  { tenant },
  templateLineId: string
): Promise<TemplateLineServiceWithConfiguration[] | ContractLineServiceActionError> => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
    const configurations = await tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')
      .where({
        template_line_id: templateLineId,
      })
      .select('*');

    // Group configurations by service_id to merge bucket configs
    const configsByService = new Map<string, any[]>();
    for (const config of configurations) {
      if (!configsByService.has(config.service_id)) {
        configsByService.set(config.service_id, []);
      }
      configsByService.get(config.service_id)!.push(config);
    }

    const results: TemplateLineServiceWithConfiguration[] = [];

    for (const [serviceId, serviceConfigs] of configsByService.entries()) {
      // Find primary config (Hourly, Usage, or Fixed) and bucket config
      const primaryConfig = serviceConfigs.find(c => c.configuration_type !== 'Bucket');
      const bucketConfigRecord = serviceConfigs.find(c => c.configuration_type === 'Bucket');

      // If no primary config exists, use bucket as primary (standalone bucket service)
      const configToUse = primaryConfig || bucketConfigRecord;

      if (!configToUse) {
        continue;
      }

      const facade = tenantDb(trx, tenant);
      const query = facade.table('service_catalog as sc');
      facade.tenantJoin(query, 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' });

      const service = await query
        .where({
          'sc.service_id': serviceId,
        })
        .select('sc.*', 'st.name as service_type_name')
        .first() as (IService & { service_type_name?: string }) | undefined;

      if (!service) {
        continue;
      }

      let typeConfig:
        | IContractLineServiceHourlyConfig
        | IContractLineServiceUsageConfig
        | IContractLineServiceBucketConfig
        | null = null;

      if (configToUse.configuration_type === 'Bucket') {
        typeConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')
          .where({
            config_id: configToUse.config_id,
          })
          .first();
      } else if (configToUse.configuration_type === 'Hourly') {
        typeConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_hourly_config')
          .where({
            config_id: configToUse.config_id,
          })
          .first();
      } else if (configToUse.configuration_type === 'Usage') {
        typeConfig = await tenantScopedTable(trx, tenant, 'contract_template_line_service_usage_config')
          .where({
            config_id: configToUse.config_id,
          })
          .first();
      }

      // Template bucket configs are keyed by the primary config_id in current schema.
      // Support both models:
      // 1) dedicated Bucket configuration row (bucketConfigRecord.config_id), and
      // 2) bucket row attached directly to the primary Hourly/Usage config_id.
      const bucketConfigId = bucketConfigRecord?.config_id ?? configToUse.config_id;
      const bucketConfigDetails =
        (await tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')
          .where({
            config_id: bucketConfigId,
          })
          .first()) ?? null;

      const configuration: IContractLineServiceConfiguration = {
        ...configToUse,
        contract_line_id: configToUse.template_line_id,
      };

      results.push({
        service,
        configuration,
        typeConfig,
        bucketConfig: bucketConfigDetails, // Add the merged bucket config
      });
    }

    return results;
    });
  } catch (error) {
    console.error(`Error fetching services with configurations for template line ${templateLineId}:`, error);
    const expected = contractLineServiceActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
