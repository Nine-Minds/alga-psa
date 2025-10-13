'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { IContractLineServiceRateTier, IUserTypeRate } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { IContractLineService } from 'server/src/interfaces/billing.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import * as contractLineServiceConfigActions from 'server/src/lib/actions/contractLineServiceConfigurationActions';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

/**
 * Get all services for a contract line
 */
export async function getContractLineServices(contractLineId: string): Promise<IContractLineService[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
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
 * Get a specific service in a contract line
 */
export async function getContractLineService(contractLineId: string, serviceId: string): Promise<IContractLineService | null> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
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

/**
 * Add a service to a contract line with configuration
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
  return withTransaction(db, async (trx: Knex.Transaction) => {

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
    .first() as IService & { service_type_billing_method?: 'fixed' | 'per_unit' }; // Add type info

  if (!serviceWithType) {
    throw new Error(`Service ${serviceId} not found`);
  }
  // Use serviceWithType which includes service_type_billing_method for logic below
  const service = serviceWithType; // Keep using 'service' variable name for compatibility with validation block

  // Get contract line details
  const contractLine = await trx('contract_lines')
    .where({
      contract_line_id: contractLineId,
      tenant
    })
    .first();

  if (!contractLine) {
    throw new Error(`Contract line ${contractLineId} not found`);
  }

  // --- BEGIN SERVER-SIDE VALIDATION ---
  if (contractLine.contract_line_type === 'Hourly' && service.billing_method === 'fixed') {
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to an hourly contract line.`);
  } else if (contractLine.contract_line_type === 'Usage' && service.billing_method === 'fixed') {
    // Prevent adding fixed-price services to Usage-Based contract lines
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to a usage-based contract line.`);
  }
  // TODO: Add other validation rules as needed (e.g., prevent hourly services on fixed contract lines?)
  // --- END SERVER-SIDE VALIDATION ---

  // Determine configuration type based on standard service type's billing method, prioritizing explicit configType
  let determinedConfigType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket'; // Bucket might need separate logic

  // Determine configuration type: Prioritize explicit param, then contract line type, then service type
  if (configType) {
    determinedConfigType = configType;
  } else if (contractLine.contract_line_type === 'Bucket') { // Check if the contract line itself is a Bucket
    determinedConfigType = 'Bucket';
  } else if (serviceWithType?.service_type_billing_method === 'fixed') {
    determinedConfigType = 'Fixed';
  } else if (serviceWithType?.service_type_billing_method === 'per_unit') {
    // Use the service's specific unit_of_measure for per_unit services on non-Bucket contract lines
    if (serviceWithType.unit_of_measure?.toLowerCase().includes('hour')) {
       determinedConfigType = 'Hourly';
    } else {
       determinedConfigType = 'Usage'; // Default for other per_unit types
    }
  } else {
    // Fallback for missing/unknown service billing method on non-Bucket contract lines
    console.warn(`Could not determine standard billing method for service type of ${serviceId} on a non-Bucket contract line. Defaulting configuration type to 'Fixed'.`);
    determinedConfigType = 'Fixed';
  }

  const configurationType = determinedConfigType;

  // If this is a Bucket configuration and overage_rate is not provided, set it to the service's default_rate
  if (configurationType === 'Bucket') {
    typeConfig = typeConfig || {};
    if ((typeConfig as Partial<IContractLineServiceBucketConfig>)?.overage_rate === undefined) {
      (typeConfig as Partial<IContractLineServiceBucketConfig>).overage_rate = service.default_rate;
    }
  }

  // Check if the service is already in the contract line
  const existingContractLineService = await getContractLineService(contractLineId, serviceId);

  // If not, add it to the contract_line_services table
  if (!existingContractLineService) {
    await trx('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant: tenant
    });
  }

  // Check if a configuration already exists for this contract line-service combination
  const existingConfig = await contractLineServiceConfigActions.getConfigurationForService(contractLineId, serviceId);
  
  let configId: string;
  
  if (existingConfig) {
    // Update existing configuration instead of creating a new one
    await contractLineServiceConfigActions.updateConfiguration(
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
    configId = await contractLineServiceConfigActions.createConfiguration(
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

    return configId;
  });
}

/**
 * Update a service in a contract line
 */
export async function updateContractLineService(
  contractLineId: string,
  serviceId: string,
  updates: {
    quantity?: number;
    customRate?: number;
    typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>;
  },
  rateTiers?: IContractLineServiceRateTier[] // Add rateTiers here
): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await contractLineServiceConfigActions.getConfigurationForService(contractLineId, serviceId);

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

  await contractLineServiceConfigActions.updateConfiguration(
    config.config_id,
    Object.keys(baseUpdates).length > 0 ? baseUpdates : undefined,
    updates.typeConfig,
      // Pass rateTiers if they exist
      rateTiers // Pass the rateTiers variable directly
    );

    return true;
  });
}

/**
 * Remove a service from a contract line
 */
export async function removeServiceFromContractLine(contractLineId: string, serviceId: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await contractLineServiceConfigActions.getConfigurationForService(contractLineId, serviceId);

  // Remove configuration if it exists
  if (config) {
    await contractLineServiceConfigActions.deleteConfiguration(config.config_id);
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
 * Get all services in a contract line with their configurations, service type name, and user type rates (for hourly).
 */
export async function getContractLineServicesWithConfigurations(contractLineId: string): Promise<{
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
  userTypeRates?: IUserTypeRate[]; // Add userTypeRates to the return type
}[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get all configurations for the contract line
  const configurations = await contractLineServiceConfigActions.getConfigurationsForContractLine(contractLineId);

  // Get service details including service type name for each configuration
  const result: Array<{ service: IService & { service_type_name?: string }; configuration: IContractLineServiceConfiguration; typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null; userTypeRates?: IUserTypeRate[] }> = [];
  for (const config of configurations) {
    // Join service_catalog with service_types to get the name
    const service = await trx('service_catalog as sc')
      .leftJoin('service_types as st', function() {
        this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
      })
      .where({
        'sc.service_id': config.service_id,
        'sc.tenant': tenant
      })
      .select('sc.*', 'st.name as service_type_name')
      .first() as IService & { service_type_name?: string }; // Cast to include the new field

    if (!service) {
      continue;
    }

    const configDetails = await contractLineServiceConfigActions.getConfigurationWithDetails(config.config_id);

    let userTypeRates: IUserTypeRate[] | undefined = undefined;

    // If it's an hourly config, fetch user type rates
    if (config.configuration_type === 'Hourly') {
      // Assuming ContractLineServiceHourlyConfig model is accessible or we use an action
      // For simplicity, let's assume we can access the model instance via the service
      // This might need adjustment based on actual service/model structure
      const hourlyConfigModel = new (await import('server/src/lib/models/contractLineServiceHourlyConfig')).default(trx);
      userTypeRates = await hourlyConfigModel.getUserTypeRates(config.config_id);
    }

    result.push({
      service,
      configuration: config,
      typeConfig: configDetails.typeConfig,
      userTypeRates: userTypeRates // Add the fetched rates
      });
    }

    return result;
  });
}
