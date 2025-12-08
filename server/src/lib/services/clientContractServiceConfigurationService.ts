import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';

type ClientConfigDetails = {
  clientContractServiceId: string;
  serviceId: string;
  baseConfig: IContractLineServiceConfiguration;
  typeConfig:
    | IContractLineServiceFixedConfig
    | (IContractLineServiceHourlyConfig & {
        hourly_rate?: number | null;
        enable_overtime?: boolean;
        overtime_rate?: number | null;
        overtime_threshold?: number | null;
        enable_after_hours_rate?: boolean;
        after_hours_multiplier?: number | null;
      })
    | (IContractLineServiceUsageConfig & { base_rate?: number | null })
    | IContractLineServiceBucketConfig
    | null;
  rateTiers?: IContractLineServiceRateTier[];
  userTypeRates?: IUserTypeRate[];
};

export class ClientContractServiceConfigurationService {
  private knex: Knex;
  private tenant: string;

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
  }

  private async initKnex() {
    if (!this.knex) {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('tenant context not found');
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  async getConfigurationsForClientContractLine(clientContractLineId: string): Promise<ClientConfigDetails[]> {
    await this.initKnex();

    // Use contract_line_services and contract_line_service_configuration tables
    // The clientContractLineId is now effectively a contract_line_id
    const rows = await this.knex('contract_line_services as cls')
      .join('contract_line_service_configuration as clsc', function () {
        this.on('clsc.contract_line_id', '=', 'cls.contract_line_id')
          .andOn('clsc.service_id', '=', 'cls.service_id')
          .andOn('clsc.tenant', '=', 'cls.tenant');
      })
      .where({
        'cls.contract_line_id': clientContractLineId,
        'cls.tenant': this.tenant
      })
      .select(
        'clsc.config_id',
        'clsc.configuration_type',
        'clsc.custom_rate',
        'clsc.quantity',
        'clsc.created_at',
        'clsc.updated_at',
        'cls.contract_line_id',
        'cls.service_id'
      );

    const results: ClientConfigDetails[] = [];

    for (const row of rows) {
      const baseConfig: IContractLineServiceConfiguration = {
        config_id: row.config_id,
        contract_line_id: clientContractLineId,
        service_id: row.service_id,
        configuration_type: row.configuration_type,
        custom_rate: row.custom_rate != null ? Number(row.custom_rate) : undefined,
        quantity: row.quantity != null ? Number(row.quantity) : undefined,
        instance_name: undefined,
        tenant: this.tenant,
        created_at: row.created_at,
        updated_at: row.updated_at
      };

      const detail = await this.materializeTypeSpecificConfig(baseConfig);
      results.push({
        clientContractServiceId: row.contract_line_id, // Use contract_line_id as the service identifier
        serviceId: row.service_id,
        ...detail
      });
    }

    return results;
  }

  async getConfigurationForService(
    clientContractLineId: string,
    serviceId: string
  ): Promise<ClientConfigDetails | null> {
    await this.initKnex();

    // Use contract_line_services and contract_line_service_configuration tables
    const row = await this.knex('contract_line_services as cls')
      .join('contract_line_service_configuration as clsc', function () {
        this.on('clsc.contract_line_id', '=', 'cls.contract_line_id')
          .andOn('clsc.service_id', '=', 'cls.service_id')
          .andOn('clsc.tenant', '=', 'cls.tenant');
      })
      .where({
        'cls.contract_line_id': clientContractLineId,
        'cls.service_id': serviceId,
        'cls.tenant': this.tenant
      })
      .first(
        'clsc.config_id',
        'clsc.configuration_type',
        'clsc.custom_rate',
        'clsc.quantity',
        'clsc.created_at',
        'clsc.updated_at',
        'cls.contract_line_id',
        'cls.service_id'
      );

    if (!row) {
      return null;
    }

    const baseConfig: IContractLineServiceConfiguration = {
      config_id: row.config_id,
      contract_line_id: clientContractLineId,
      service_id: row.service_id,
      configuration_type: row.configuration_type,
      custom_rate: row.custom_rate != null ? Number(row.custom_rate) : undefined,
      quantity: row.quantity != null ? Number(row.quantity) : undefined,
      instance_name: undefined,
      tenant: this.tenant,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    const detail = await this.materializeTypeSpecificConfig(baseConfig);
    return {
      clientContractServiceId: row.contract_line_id,
      serviceId: row.service_id,
      ...detail
    };
  }

  private async materializeTypeSpecificConfig(
    baseConfig: IContractLineServiceConfiguration
  ): Promise<Pick<ClientConfigDetails, 'baseConfig' | 'typeConfig' | 'rateTiers' | 'userTypeRates'>> {
    let typeConfig:
      | IContractLineServiceFixedConfig
      | (IContractLineServiceHourlyConfig & {
          hourly_rate?: number | null;
          enable_overtime?: boolean;
          overtime_rate?: number | null;
          overtime_threshold?: number | null;
          enable_after_hours_rate?: boolean;
          after_hours_multiplier?: number | null;
        })
      | (IContractLineServiceUsageConfig & { base_rate?: number | null })
      | IContractLineServiceBucketConfig
      | null = null;

    let rateTiers: IContractLineServiceRateTier[] | undefined;
    let userTypeRates: IUserTypeRate[] | undefined;

    // Use contract_line_service_* tables instead of client_contract_service_* tables
    switch (baseConfig.configuration_type) {
      case 'Fixed': {
        const fixedConfig = await this.knex('contract_line_service_fixed_config')
          .where({
            config_id: baseConfig.config_id,
            tenant: this.tenant
          })
          .first();
        if (fixedConfig) {
          typeConfig = {
            config_id: baseConfig.config_id,
            base_rate: fixedConfig.base_rate != null ? Number(fixedConfig.base_rate) : null,
            tenant: this.tenant,
            created_at: fixedConfig.created_at,
            updated_at: fixedConfig.updated_at
          };
        }
        break;
      }
      case 'Hourly': {
        const hourlyCore = await this.knex('contract_line_service_hourly_configs')
          .where({
            config_id: baseConfig.config_id,
            tenant: this.tenant
          })
          .first();

        const hourlyMeta = await this.knex('contract_line_service_hourly_config')
          .where({
            config_id: baseConfig.config_id,
            tenant: this.tenant
          })
          .first();

        typeConfig = {
          config_id: baseConfig.config_id,
          minimum_billable_time: (hourlyCore?.minimum_billable_time ?? hourlyMeta?.minimum_billable_time) ?? 0,
          round_up_to_nearest: (hourlyCore?.round_up_to_nearest ?? hourlyMeta?.round_up_to_nearest) ?? 0,
          hourly_rate: hourlyCore?.hourly_rate != null ? Number(hourlyCore.hourly_rate) : null,
          enable_overtime: Boolean(hourlyMeta?.enable_overtime),
          overtime_rate: hourlyMeta?.overtime_rate != null ? Number(hourlyMeta.overtime_rate) : null,
          overtime_threshold: hourlyMeta?.overtime_threshold ?? null,
          enable_after_hours_rate: Boolean(hourlyMeta?.enable_after_hours_rate),
          after_hours_multiplier:
            hourlyMeta?.after_hours_multiplier != null ? Number(hourlyMeta.after_hours_multiplier) : null,
          tenant: this.tenant,
          created_at: hourlyCore?.created_at ?? hourlyMeta?.created_at ?? new Date(),
          updated_at: hourlyCore?.updated_at ?? hourlyMeta?.updated_at ?? new Date()
        } as IContractLineServiceHourlyConfig & {
          hourly_rate?: number | null;
          enable_overtime?: boolean;
          overtime_rate?: number | null;
          overtime_threshold?: number | null;
          enable_after_hours_rate?: boolean;
          after_hours_multiplier?: number | null;
        };

        userTypeRates = await this.knex('user_type_rates')
          .where({
            config_id: baseConfig.config_id,
            tenant: this.tenant
          })
          .select('*');
        break;
      }
      case 'Usage': {
        const usageConfig = await this.knex('contract_line_service_usage_config')
          .where({
            config_id: baseConfig.config_id,
            tenant: this.tenant
          })
          .first();
        if (usageConfig) {
          typeConfig = {
            config_id: baseConfig.config_id,
            unit_of_measure: usageConfig.unit_of_measure,
            enable_tiered_pricing: Boolean(usageConfig.enable_tiered_pricing),
            minimum_usage: usageConfig.minimum_usage,
            base_rate: usageConfig.base_rate != null ? Number(usageConfig.base_rate) : null,
            tenant: this.tenant,
            created_at: usageConfig.created_at,
            updated_at: usageConfig.updated_at
          } as IContractLineServiceUsageConfig & { base_rate?: number | null };
        }

        if (usageConfig?.enable_tiered_pricing) {
          rateTiers = await this.knex('contract_line_service_rate_tiers')
            .where({
              config_id: baseConfig.config_id,
              tenant: this.tenant
            })
            .orderBy('min_quantity', 'asc')
            .select('*');
        }
        break;
      }
      case 'Bucket': {
        const bucketConfig = await this.knex('contract_line_service_bucket_config')
          .where({
            config_id: baseConfig.config_id,
            tenant: this.tenant
          })
          .first();

        if (bucketConfig) {
          typeConfig = {
            config_id: baseConfig.config_id,
            total_minutes: bucketConfig.total_minutes,
            billing_period: bucketConfig.billing_period,
            overage_rate: bucketConfig.overage_rate != null ? Number(bucketConfig.overage_rate) : 0,
            allow_rollover: Boolean(bucketConfig.allow_rollover),
            tenant: this.tenant,
            created_at: bucketConfig.created_at,
            updated_at: bucketConfig.updated_at
          };
        }
        break;
      }
    }

    return {
      baseConfig,
      typeConfig,
      rateTiers,
      userTypeRates
    };
  }
}

export type ClientContractServiceConfigDetails = ClientConfigDetails;
