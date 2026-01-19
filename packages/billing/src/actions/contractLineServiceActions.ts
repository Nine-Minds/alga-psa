'use server';

import { withTransaction } from '@alga-psa/db';
import { IContractLineServiceRateTier, IUserTypeRate, IContractLineServiceConfiguration, IContractLineServiceFixedConfig, IContractLineServiceHourlyConfig, IContractLineServiceUsageConfig, IContractLineServiceBucketConfig } from '@alga-psa/types';
import { IContractLineService } from '@alga-psa/types';
import { IService } from '@alga-psa/types';
 
import { v4 as uuidv4 } from 'uuid';
import { ContractLineServiceConfigurationService } from '../services/contractLineServiceConfigurationService';
import * as planServiceConfigActions from './contractLineServiceConfigurationActions';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';

async function findTemplateLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string
) {
  return trx('contract_template_lines')
    .where({ tenant, template_line_id: contractLineId })
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
export async function getContractLineServices(contractLineId: string): Promise<IContractLineService[]> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const templateLine = await findTemplateLine(trx, tenant, contractLineId);
    if (templateLine) {
      const services = await trx('contract_template_line_services')
        .where({
          template_line_id: contractLineId,
          tenant
        })
        .select('*');

      return services.map(mapTemplateServiceRow);
    }

    const services = await trx('contract_line_services')
      .where({
        contract_line_id: contractLineId,
        tenant
      })
      .select('*');

    return services;
  });
}

/**
 * Get all services for a contract line with service names
 */
export async function getContractLineServicesWithNames(contractLineId: string): Promise<Array<IContractLineService & { service_name?: string }>> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const services = await trx('contract_line_services as cls')
      .leftJoin('service_catalog as sc', function() {
        this.on('cls.service_id', '=', 'sc.service_id')
          .andOn('cls.tenant', '=', 'sc.tenant');
      })
      .where({
        'cls.contract_line_id': contractLineId,
        'cls.tenant': tenant
      })
      .select(
        'cls.*',
        'sc.service_name'
      );

    return services;
  });
}

/**
 * Get a specific service in a plan
 */
export async function getContractLineService(contractLineId: string, serviceId: string): Promise<IContractLineService | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const templateLine = await findTemplateLine(trx, tenant, contractLineId);
    if (templateLine) {
      const service = await trx('contract_template_line_services')
        .where({
          template_line_id: contractLineId,
          service_id: serviceId,
          tenant
        })
        .first();

      return service ? mapTemplateServiceRow(service) : null;
    }

    const service = await trx('contract_line_services')
      .where({
        contract_line_id: contractLineId,
        service_id: serviceId,
        tenant
      })
      .first();

    return service || null;
  });
}

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

  const service = await trx('service_catalog')
    .where({ service_id: serviceId, tenant })
    .first() as IService | undefined;

  if (!service) {
    throw new Error(`Service ${serviceId} not found`);
  }

  if (service.item_kind === 'service' && service.billing_method && service.billing_method !== 'fixed') {
    throw new Error('Only fixed billing method services can be attached to this template line.');
  }

  const now = trx.fn.now();
  const resolvedQuantity = typeof quantity === 'number' && quantity > 0 ? quantity : 1;
  const resolvedRate =
    typeof customRate === 'number'
      ? customRate
      : service.default_rate != null
        ? Number(service.default_rate)
        : null;

  const existingService = await trx('contract_template_line_services')
    .where({ tenant, template_line_id: templateLine.template_line_id, service_id: serviceId })
    .first();

  if (existingService) {
    await trx('contract_template_line_services')
      .where({ tenant, template_line_id: templateLine.template_line_id, service_id: serviceId })
      .update({
        quantity: resolvedQuantity,
        custom_rate: resolvedRate,
        updated_at: now,
      });
  } else {
    await trx('contract_template_line_services').insert({
      tenant,
      template_line_id: templateLine.template_line_id,
      service_id: serviceId,
      quantity: resolvedQuantity,
      custom_rate: resolvedRate,
      created_at: now,
      updated_at: now,
    });
  }

  const existingConfig = await trx('contract_template_line_service_configuration')
    .where({ tenant, template_line_id: templateLine.template_line_id, service_id: serviceId })
    .first();

  const configId = existingConfig ? existingConfig.config_id : uuidv4();

  if (existingConfig) {
    await trx('contract_template_line_service_configuration')
      .where({ tenant, config_id: existingConfig.config_id })
      .update({
        configuration_type: 'Fixed',
        custom_rate: resolvedRate,
        quantity: resolvedQuantity,
        updated_at: now,
      });
  } else {
    await trx('contract_template_line_service_configuration').insert({
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
export async function addServiceToContractLine(
  contractLineId: string,
  serviceId: string,
  quantity?: number,
  customRate?: number,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>
): Promise<string> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const templateLine = await findTemplateLine(trx, tenant, contractLineId);
    if (templateLine) {
      return addServiceToTemplateLine(trx, tenant, templateLine, serviceId, quantity, customRate);
    }

  // Get service details and join with service_types to get the type's billing_method
  const serviceWithType = await trx('service_catalog as sc')
    .leftJoin('service_types as st', function() {
      this.on('sc.custom_service_type_id', '=', 'st.id')
          .andOn('sc.tenant', '=', 'st.tenant');
    })
    .where({
      'sc.service_id': serviceId,
      'sc.tenant': tenant
    })
    .select('sc.*', 'st.billing_method as service_type_billing_method') // Select the billing_method from the type table
    .first() as IService & { service_type_billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' }; // Add type info

  if (!serviceWithType) {
    throw new Error(`Service ${serviceId} not found`);
  }
  // Use serviceWithType which includes service_type_billing_method for logic below
  const service = serviceWithType; // Keep using 'service' variable name for compatibility with validation block

  // Get plan details
  const plan = await trx('contract_lines')
    .where({
      contract_line_id: contractLineId,
      tenant
    })
    .first();

  if (!plan) {
    throw new Error(`Contract line ${contractLineId} not found`);
  }

  // --- BEGIN SERVER-SIDE VALIDATION ---
  // Prevent attaching inactive catalog items to new/updated contract lines.
  if (service.is_active === false) {
    throw new Error(`"${service.service_name}" is inactive and cannot be attached to contract lines.`);
  }

  // Products (per-unit items) are only supported on Fixed contract lines in V1.
  if (service.item_kind === 'product') {
    if (plan.contract_line_type !== 'Fixed') {
      throw new Error(`Products can only be added to fixed-fee contract lines.`);
    }

    // Validate that the product has pricing in the contract currency unless an override is provided.
    const contract = plan.contract_id
      ? await trx('contracts').where({ tenant, contract_id: plan.contract_id }).select('currency_code').first()
      : null;
    const currencyCode = contract?.currency_code ?? 'USD';

    const hasOverride = customRate !== undefined && customRate !== null;
    if (!hasOverride) {
      const priceRow = await trx('service_prices')
        .where({
          tenant,
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

  if (plan.contract_line_type === 'Hourly' && service.billing_method === 'fixed') {
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to an hourly contract line.`);
  } else if (plan.contract_line_type === 'Usage' && service.billing_method === 'fixed') {
    // Prevent adding fixed-price services to Usage-Based plans
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to a usage-based contract line.`);
  }
  // TODO: Add other validation rules as needed (e.g., prevent hourly services on fixed plans?)
  // --- END SERVER-SIDE VALIDATION ---

  // Determine configuration type based on standard service type's billing method, prioritizing explicit configType
  let determinedConfigType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket'; // Bucket might need separate logic

  // Determine configuration type: Prioritize explicit param, then plan type, then service type
  if (configType) {
    determinedConfigType = configType;
  } else if (serviceWithType?.service_type_billing_method === 'fixed') {
    determinedConfigType = 'Fixed';
  } else if (serviceWithType?.service_type_billing_method === 'hourly') {
    determinedConfigType = 'Hourly';
  } else if (serviceWithType?.service_type_billing_method === 'usage') {
    determinedConfigType = 'Usage';
  } else if (serviceWithType?.service_type_billing_method === 'per_unit') {
    // Per-unit items are persisted with Fixed configuration metadata, but billed as product charges.
    determinedConfigType = 'Fixed';
  } else {
    // Fallback for missing/unknown service billing method on non-Bucket plans
    console.warn(`Could not determine standard billing method for service type of ${serviceId} on a non-Bucket plan. Defaulting configuration type to 'Fixed'.`);
    determinedConfigType = 'Fixed';
  }

  const configurationType = determinedConfigType;
  let hourlyConfigPayload: Partial<IContractLineServiceHourlyConfig> | undefined;

  // If this is a Bucket configuration and overage_rate is not provided, set it to the service's default_rate
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

  // Check if the service is already in the plan
  const existingPlanService = await getContractLineService(contractLineId, serviceId);
  
  // If not, add it to the contract_line_services table
  if (!existingPlanService) {
    await trx('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant: tenant
    });
  }

  // Check if a configuration already exists for this plan-service combination
  const existingConfig = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);
  
  let configId: string;
  
  if (existingConfig) {
    // Update existing configuration instead of creating a new one
    await planServiceConfigActions.updateConfiguration(
      existingConfig.config_id,
      {
        configuration_type: configurationType,
        custom_rate: customRate,
        quantity: quantity || 1
      },
      typeConfig || {}
    );
    configId = existingConfig.config_id;
  } else {
    // Create new configuration if one doesn't exist
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
  }

  if (configurationType === 'Hourly' && hourlyConfigPayload) {
    await planServiceConfigActions.upsertPlanServiceHourlyConfiguration(
      contractLineId,
      serviceId,
      hourlyConfigPayload
    );
  }

    return configId;
  });
}

/**
 * Update a service in a plan
 */
export async function updateContractLineService(
  contractLineId: string,
  serviceId: string,
  updates: {
    quantity?: number;
    customRate?: number | null;
    typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>;
  },
  rateTiers?: IContractLineServiceRateTier[] // Add rateTiers here
): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);

  if (!config) {
    throw new Error(`Configuration for service ${serviceId} in contract line ${contractLineId} not found`);
  }

  // Update configuration
  const baseUpdates: Partial<IContractLineServiceConfiguration> = {};
  if (updates.quantity !== undefined) {
    baseUpdates.quantity = updates.quantity;
  }
  if (updates.customRate !== undefined) {
    baseUpdates.custom_rate = updates.customRate;
  }

  await planServiceConfigActions.updateConfiguration(
    config.config_id,
    Object.keys(baseUpdates).length > 0 ? baseUpdates : undefined,
    updates.typeConfig,
      // Pass rateTiers if they exist
      rateTiers // Pass the rateTiers variable directly
    );

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

    await planServiceConfigActions.upsertPlanServiceHourlyConfiguration(
      contractLineId,
      serviceId,
      hourlyPayload
    );
  }

    return true;
  });
}

/**
 * Remove a service from a plan
 */
export async function removeServiceFromContractLine(contractLineId: string, serviceId: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const templateLine = await findTemplateLine(trx, tenant, contractLineId);
    if (templateLine) {
      const templateConfigs = await trx('contract_template_line_service_configuration')
        .where({
          tenant,
          template_line_id: contractLineId,
          service_id: serviceId,
        })
        .select('config_id');

      if (templateConfigs.length > 0) {
        const configIds = templateConfigs.map((config) => config.config_id);

        await trx('contract_template_line_service_hourly_config')
          .where({ tenant })
          .whereIn('config_id', configIds)
          .delete();

        await trx('contract_template_line_service_usage_config')
          .where({ tenant })
          .whereIn('config_id', configIds)
          .delete();

        await trx('contract_template_line_service_bucket_config')
          .where({ tenant })
          .whereIn('config_id', configIds)
          .delete();

        await trx('contract_template_line_service_configuration')
          .where({ tenant })
          .whereIn('config_id', configIds)
          .delete();
      }

      await trx('contract_template_line_services')
        .where({
          tenant,
          template_line_id: contractLineId,
          service_id: serviceId,
        })
        .delete();

      return true;
    }

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);

  // Remove configuration if it exists
  if (config) {
    await planServiceConfigActions.deleteConfiguration(config.config_id);
  }

  // Remove the service from the contract_line_services table
  await trx('contract_line_services')
    .where({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant
    })
      .delete();

    return true;
  });
}

/**
 * Get all services in a plan with their configurations, service type name, and user type rates (for hourly).
 * Bucket configurations are merged into their parent Hourly/Usage configurations as a nested property.
 */
export async function getContractLineServicesWithConfigurations(contractLineId: string): Promise<{
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
  userTypeRates?: IUserTypeRate[];
  bucketConfig?: IContractLineServiceBucketConfig | null; // Add bucketConfig to the return type
}[]> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const templateLine = await findTemplateLine(trx, tenant, contractLineId);
    if (templateLine) {
      const configurations = await trx('contract_template_line_service_configuration')
        .where({
          tenant,
          template_line_id: contractLineId,
        })
        .select('*');

      const results: Array<{
        service: IService & { service_type_name?: string };
        configuration: IContractLineServiceConfiguration;
        typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
        userTypeRates?: IUserTypeRate[];
      }> = [];

      for (const config of configurations) {
        const service = await trx('service_catalog as sc')
          .leftJoin('service_types as st', function () {
            this.on('sc.custom_service_type_id', '=', 'st.id').andOn('sc.tenant', '=', 'st.tenant');
          })
          .where({
            'sc.service_id': config.service_id,
            'sc.tenant': tenant,
          })
          .select('sc.*', 'st.name as service_type_name')
          .first() as IService & { service_type_name?: string } | undefined;

        if (!service) {
          continue;
        }

        let typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null =
          null;

        if (config.configuration_type === 'Bucket') {
          typeConfig = await trx('contract_template_line_service_bucket_config')
            .where({ tenant, config_id: config.config_id })
            .first();
        } else if (config.configuration_type === 'Hourly') {
          typeConfig = await trx('contract_template_line_service_hourly_config')
            .where({ tenant, config_id: config.config_id })
            .first();
        } else if (config.configuration_type === 'Usage') {
          typeConfig = await trx('contract_template_line_service_usage_config')
            .where({ tenant, config_id: config.config_id })
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

  // Group configurations by service_id to merge bucket configs
  const configsByService = new Map<string, IContractLineServiceConfiguration[]>();
  for (const config of configurations) {
    if (!configsByService.has(config.service_id)) {
      configsByService.set(config.service_id, []);
    }
    configsByService.get(config.service_id)!.push(config);
  }

  // Build result with merged bucket configs
  const result: Array<{
    service: IService & { service_type_name?: string };
    configuration: IContractLineServiceConfiguration;
    typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
    userTypeRates?: IUserTypeRate[];
    bucketConfig?: IContractLineServiceBucketConfig | null;
  }> = [];

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
    const service = await trx('service_catalog as sc')
      .leftJoin('service_types as st', function() {
        this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
      })
      .where({
        'sc.service_id': serviceId,
        'sc.tenant': tenant
      })
      .select('sc.*', 'st.name as service_type_name')
      .first() as IService & { service_type_name?: string };

    if (!service) {
      continue;
    }

    const configDetails = await planServiceConfigActions.getConfigurationWithDetails(configToUse.config_id);

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
}

export async function getTemplateLineServicesWithConfigurations(templateLineId: string): Promise<{
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
  bucketConfig?: IContractLineServiceBucketConfig | null; // Add bucketConfig to the return type
}[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const configurations = await trx('contract_template_line_service_configuration')
      .where({
        tenant,
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

    const results: Array<{
      service: IService & { service_type_name?: string };
      configuration: IContractLineServiceConfiguration;
      typeConfig:
        | IContractLineServiceHourlyConfig
        | IContractLineServiceUsageConfig
        | IContractLineServiceBucketConfig
        | null;
      bucketConfig?: IContractLineServiceBucketConfig | null;
    }> = [];

    for (const [serviceId, serviceConfigs] of configsByService.entries()) {
      // Find primary config (Hourly, Usage, or Fixed) and bucket config
      const primaryConfig = serviceConfigs.find(c => c.configuration_type !== 'Bucket');
      const bucketConfigRecord = serviceConfigs.find(c => c.configuration_type === 'Bucket');

      // If no primary config exists, use bucket as primary (standalone bucket service)
      const configToUse = primaryConfig || bucketConfigRecord;

      if (!configToUse) {
        continue;
      }

      const service = await trx('service_catalog as sc')
        .leftJoin('service_types as st', function joinTypes() {
          this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
        })
        .where({
          'sc.service_id': serviceId,
          'sc.tenant': tenant,
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
        typeConfig = await trx('contract_template_line_service_bucket_config')
          .where({
            tenant,
            config_id: configToUse.config_id,
          })
          .first();
      } else if (configToUse.configuration_type === 'Hourly') {
        typeConfig = await trx('contract_template_line_service_hourly_config')
          .where({
            tenant,
            config_id: configToUse.config_id,
          })
          .first();
      } else if (configToUse.configuration_type === 'Usage') {
        typeConfig = await trx('contract_template_line_service_usage_config')
          .where({
            tenant,
            config_id: configToUse.config_id,
          })
          .first();
      }

      // Fetch bucket config details if it exists
      let bucketConfigDetails: IContractLineServiceBucketConfig | null = null;
      if (bucketConfigRecord) {
        bucketConfigDetails = await trx('contract_template_line_service_bucket_config')
          .where({
            tenant,
            config_id: bucketConfigRecord.config_id,
          })
          .first();
      }

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
}
