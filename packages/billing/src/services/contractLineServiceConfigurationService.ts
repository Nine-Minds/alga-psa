
import { resolveUnitOfMeasure, withUnitCode } from '@alga-psa/core/unitOfMeasure';
import { resolveUsageMeasurementRevision, setUsageMeasurementModeInTransaction } from '../lib/billing/usageMeasurementTransitions';
import { lockTenantBilling } from '../lib/billing/billingMutationLock';
import {
  resolveNextUnbilledSeatBoundary,
  resolveEffectiveRecurringUnitPricingInTransaction,
  scheduleRecurringUnitRevisionInTransaction,
  configurationDeletionGuard,
} from '../lib/billing/seatRevisions';
import { resolveRecurringUnitKind, type RecurringUnitKind } from '@alga-psa/shared/billingClients/recurringUnitPricing';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
  IUserTypeRate
} from '@alga-psa/types';
import ContractLineServiceConfiguration from '../models/contractLineServiceConfiguration';
import ContractLineServiceFixedConfig, { resolveFixedMemberRateWrite } from '../models/contractLineServiceFixedConfig';
import ContractLineServiceHourlyConfig from '../models/contractLineServiceHourlyConfig';
import ContractLineServiceUsageConfig from '../models/contractLineServiceUsageConfig';
import ContractLineServiceBucketConfig from '../models/contractLineServiceBucketConfig';

export class ContractLineServiceConfigurationService {
  private knex: Knex;
  private tenant: string;
  private planServiceConfigModel: ContractLineServiceConfiguration;
  private fixedConfigModel: ContractLineServiceFixedConfig;
  private hourlyConfigModel: ContractLineServiceHourlyConfig;
  private usageConfigModel: ContractLineServiceUsageConfig;
  private bucketConfigModel: ContractLineServiceBucketConfig;
  // Removed contractLineModel property

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
    if (knex) {
      this.planServiceConfigModel = new ContractLineServiceConfiguration(knex, tenant);
      this.fixedConfigModel = new ContractLineServiceFixedConfig(knex, tenant);
      this.hourlyConfigModel = new ContractLineServiceHourlyConfig(knex);
      this.usageConfigModel = new ContractLineServiceUsageConfig(knex);
      this.bucketConfigModel = new ContractLineServiceBucketConfig(knex, tenant);
    } else {
      // These will be initialized in initKnex
      this.planServiceConfigModel = {} as ContractLineServiceConfiguration;
      this.fixedConfigModel = {} as ContractLineServiceFixedConfig;
      this.hourlyConfigModel = {} as ContractLineServiceHourlyConfig;
      this.usageConfigModel = {} as ContractLineServiceUsageConfig;
      this.bucketConfigModel = {} as ContractLineServiceBucketConfig;
    }
    // Removed contractLineModel initialization
  }

  /**
   * Initialize knex connection if not provided in constructor
   */
  private async initKnex() {
    if (!this.knex) {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
      
      // Initialize models with knex connection
      this.planServiceConfigModel = new ContractLineServiceConfiguration(knex, tenant);
      this.fixedConfigModel = new ContractLineServiceFixedConfig(knex, tenant);
      this.hourlyConfigModel = new ContractLineServiceHourlyConfig(knex);
      this.usageConfigModel = new ContractLineServiceUsageConfig(knex);
      this.bucketConfigModel = new ContractLineServiceBucketConfig(knex, tenant);
      // Removed contractLineModel initialization
    }
  }

  /**
   * The neutral recurring-unit kind for a Fixed configuration, or null when the
   * member is neither a product nor an explicitly unit-priced service.
   */
  private async resolveRecurringUnitKindForConfig(
    serviceId: string,
    pricingBasis: IContractLineServiceFixedConfig['pricing_basis'] | undefined,
  ): Promise<RecurringUnitKind | null> {
    let itemKind: string | null = null;
    try {
      const item = await tenantDb(this.knex as Knex, this.tenant)
        .table('service_catalog')
        .where({ tenant: this.tenant, service_id: serviceId })
        .first<{ item_kind: string | null } | undefined>('item_kind');
      itemKind = item?.item_kind ?? null;
    } catch {
      itemKind = null;
    }
    return resolveRecurringUnitKind({
      configurationType: 'Fixed',
      pricingBasis: pricingBasis ?? null,
      itemKind,
    });
  }

  /**
   * Get a plan service configuration with its type-specific configuration
   */
  async getConfigurationWithDetails(configId: string, effectiveDate?: string): Promise<{
    baseConfig: IContractLineServiceConfiguration;
    typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
    rateTiers?: IContractLineServiceRateTier[];
    // userTypeRates removed as they are plan-wide for Hourly plans now
  }> {
    await this.initKnex();
    
    const baseConfig = await this.planServiceConfigModel.getById(configId);
    if (!baseConfig) {
      throw new Error(`Configuration with ID ${configId} not found`);
    }

    let typeConfig: IContractLineServiceBucketConfig | IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null = null;
    let rateTiers: IContractLineServiceRateTier[] | undefined = undefined;
    // let userTypeRates = undefined; // Removed

    // Use the configuration_type from the base config record
    switch (baseConfig.configuration_type) {
      case 'Fixed':
        typeConfig = await this.fixedConfigModel.getByConfigId(configId);
        break;

      case 'Hourly':
        typeConfig = await this.hourlyConfigModel.getByConfigId(configId);
        break;

      case 'Usage':
        typeConfig = await this.usageConfigModel.getByConfigId(configId);
        if (typeConfig && (typeConfig as IContractLineServiceUsageConfig).enable_tiered_pricing) {
          rateTiers = await this.usageConfigModel.getRateTiers(configId);
        }
        break;

      case 'Bucket':
        typeConfig = await this.bucketConfigModel.getByConfigId(configId);
        break;
    }
    
    if (effectiveDate && baseConfig.configuration_type === 'Fixed') {
      const fixedType = typeConfig as IContractLineServiceFixedConfig | null;
      const kind = await this.resolveRecurringUnitKindForConfig(
        baseConfig.service_id,
        fixedType?.pricing_basis,
      );
      if (kind) {
        const effective = await resolveEffectiveRecurringUnitPricingInTransaction({
          trx: this.knex as Knex.Transaction,
          tenant: this.tenant,
          contractLineId: baseConfig.contract_line_id,
          serviceId: baseConfig.service_id,
          configId,
          kind,
          boundary: effectiveDate,
        });
        baseConfig.quantity = effective.quantity;
        const rate =
          effective.pricePolicy === 'override' ? effective.unitRateCents : null;
        typeConfig = {
          ...fixedType,
          base_rate: rate,
          price_policy: effective.pricePolicy,
        } as IContractLineServiceFixedConfig;
      }
    }
    if (effectiveDate && baseConfig.configuration_type === 'Usage') {
      const revision = await resolveUsageMeasurementRevision(this.knex, this.tenant, configId, effectiveDate);
      if (revision) {
        Object.assign(baseConfig, revision.pricing?.baseConfig ?? {});
        typeConfig = {...typeConfig, ...revision.pricing?.typeConfig, measurement_mode: revision.measurement_mode} as IContractLineServiceUsageConfig;
        rateTiers = revision.pricing?.rateTiers ?? rateTiers;
      }
    }
    return {
      baseConfig,
      typeConfig,
      rateTiers,
      // userTypeRates // Removed
    };
  }

  /**
   * Create a new plan service configuration with its type-specific configuration
   */
  async createConfiguration(
    baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
    typeConfig: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>,
    rateTiers?: Omit<IContractLineServiceRateTier, 'tier_id' | 'config_id' | 'created_at' | 'updated_at'>[],
    userTypeRates?: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at'>[]
  ): Promise<string> {
    await this.initKnex();
    
    // Use transaction to ensure all operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new ContractLineServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);
      
      // Create base configuration
      const configId = await planServiceConfigModel.create(baseConfig);
      // Create type-specific configuration
      switch (baseConfig.configuration_type) {
        case 'Fixed':
          await fixedConfigModel.create({
            config_id: configId,
            // A stored base_rate must state its meaning; seats are per_unit.
            ...resolveFixedMemberRateWrite({
              base_rate: (typeConfig as IContractLineServiceFixedConfig)?.base_rate ?? null,
              base_rate_basis: (typeConfig as IContractLineServiceFixedConfig)?.base_rate_basis,
              pricing_basis: (typeConfig as IContractLineServiceFixedConfig)?.pricing_basis ?? 'bundle',
            }),
            rate_provenance: (typeConfig as IContractLineServiceFixedConfig)?.rate_provenance ?? undefined,
            pricing_basis: (typeConfig as IContractLineServiceFixedConfig)?.pricing_basis ?? 'bundle',
            // enable_proration: (typeConfig as IContractLineServiceFixedConfig)?.enable_proration ?? false, // Removed: Handled in contract_line_fixed_config
            // billing_cycle_alignment: (typeConfig as IContractLineServiceFixedConfig)?.billing_cycle_alignment ?? 'start', // Removed: Handled in contract_line_fixed_config
            tenant: this.tenant
          });
          break;
          
        case 'Hourly':
          // Ensure typeConfig has the required fields for the new hourly structure
          const hourlyData = typeConfig as Partial<IContractLineServiceHourlyConfig>;
          if (!hourlyData || typeof hourlyData.hourly_rate === 'undefined') {
             throw new Error('Hourly rate is required for Hourly configuration type.');
          }
          await hourlyConfigModel.create({
            config_id: configId,
            hourly_rate: hourlyData.hourly_rate, // Use new field
            minimum_billable_time: hourlyData.minimum_billable_time ?? 15, // Use new field
            round_up_to_nearest: hourlyData.round_up_to_nearest ?? 15 // Use new field
            // Removed plan-wide fields: enable_overtime, overtime_rate, etc.
          });
          
          // User type rates are plan-wide, not handled here anymore
          // if (userTypeRates && userTypeRates.length > 0) { ... }
          break;
          
        case 'Usage':
          await usageConfigModel.create({
            config_id: configId,
            unit_of_measure: (typeConfig as IContractLineServiceUsageConfig)?.unit_of_measure ?? resolveUnitOfMeasure({ fallback: 'C62' }).label,
            measurement_mode: (typeConfig as IContractLineServiceUsageConfig)?.measurement_mode ?? 'additive',
            enable_tiered_pricing: (typeConfig as IContractLineServiceUsageConfig)?.enable_tiered_pricing ?? false,
            minimum_usage: (typeConfig as IContractLineServiceUsageConfig)?.minimum_usage ?? 0,
            base_rate: (typeConfig as IContractLineServiceUsageConfig)?.base_rate ?? null,
          });
          
          // Add rate tiers if provided
          if (rateTiers && rateTiers.length > 0) {
            for (const tierData of rateTiers) {
              await usageConfigModel.addRateTier({
                config_id: configId,
                min_quantity: tierData.min_quantity,
                max_quantity: tierData.max_quantity,
                rate: tierData.rate
              });
            }
          }
          break;
          
        case 'Bucket':
          // Fetch service default rate for defaulting
          const service = await tenantDb(trx, this.tenant).table('service_catalog')
            .where({ service_id: baseConfig.service_id })
            .select('default_rate')
            .first();
          const serviceDefaultRate = service?.default_rate;

          // Fetch contract line to validate/set billing_period
          const ContractLine = (await import('../models/contractLine')).default;
          const contractLine = await ContractLine.findById(trx, baseConfig.contract_line_id);
          if (!contractLine) {
            throw new Error(`Contract line ${baseConfig.contract_line_id} not found`);
          }

          const bucketBillingPeriod = (typeConfig as IContractLineServiceBucketConfig)?.billing_period;
          // Validate billing_period matches contract line's billing_frequency
          if (bucketBillingPeriod && bucketBillingPeriod !== contractLine.billing_frequency) {
            throw new Error(
              `Bucket billing period (${bucketBillingPeriod}) must match contract line billing frequency (${contractLine.billing_frequency})`
            );
          }

          await bucketConfigModel.create({
            config_id: configId,
            total_minutes: (typeConfig as IContractLineServiceBucketConfig)?.total_minutes ?? 0,
            billing_period: bucketBillingPeriod ?? contractLine.billing_frequency,
            // Use provided rate, else service default, else 0
            overage_rate: (typeConfig as IContractLineServiceBucketConfig)?.overage_rate ?? serviceDefaultRate ?? 0,
            allow_rollover: (typeConfig as IContractLineServiceBucketConfig)?.allow_rollover ?? false,
            tenant: this.tenant
          });
          break;
      }
      
      return configId;
    });
  }

  /**
   * Update a plan service configuration with its type-specific configuration
   */
  async updateConfiguration(
    configId: string,
    baseConfig?: Partial<IContractLineServiceConfiguration>,
    typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>,
    rateTiers?: IContractLineServiceRateTier[], // Add rateTiers parameter
    // userTypeRates parameter removed as it's not used for hourly updates here
    /**
     * Compare-and-set expectation for a recurring-unit revision at the boundary.
     * Default `null` = create-only at an empty boundary (the legacy inline
     * editor). A number = replace only the revision at that version (the
     * single-transaction contract-line save reads it under the billing lock).
     * `undefined` = unconditional upsert with an audit-history row; avoid it.
     * Callers wanting this to run on a caller-owned transaction construct the
     * service with that trx: `this.knex.transaction` then nests as a savepoint.
     */
    expectedRevisionVersion: number | null | undefined = null,
  ): Promise<boolean> {
    await this.initKnex();
    
    return await this.knex.transaction(async (trx) => {
      await lockTenantBilling(trx, this.tenant);
      const currentConfig = await new ContractLineServiceConfiguration(trx, this.tenant).getById(configId);
      if (!currentConfig) throw new Error(`Configuration with ID ${configId} not found`);
      if (currentConfig.configuration_type === 'Usage' && (typeConfig !== undefined || baseConfig?.custom_rate !== undefined || rateTiers !== undefined)) {
        const incoming = (typeConfig ?? {}) as Partial<IContractLineServiceUsageConfig>;
        const transition = await setUsageMeasurementModeInTransaction({ trx, tenant: this.tenant, input: {
          config_id: configId, contract_line_id: currentConfig.contract_line_id, service_id: currentConfig.service_id,
          measurement_mode: incoming.measurement_mode ?? undefined, effective_period_start: incoming.effective_period_start,
          pricing: {
            typeConfig: {
              unit_of_measure: incoming.unit_of_measure,
              minimum_usage: incoming.minimum_usage,
              enable_tiered_pricing: incoming.enable_tiered_pricing,
              base_rate: incoming.base_rate,
            },
            baseConfig: {custom_rate: baseConfig?.custom_rate},
            rateTiers,
          },
        }});
        // `=== false` (not `!`): ee/server compiles with strictNullChecks off,
        // where truthiness checks do not narrow discriminated unions.
        if (transition.ok === false) throw new Error(transition.error);
        if (transition.effective_period_start) {
          // The dated revision owns the new price and mode; retain the baseline.
          return true;
        }
        const { measurement_mode, effective_period_start, ...rest } = incoming;
        typeConfig = rest;
      }
      if (currentConfig.configuration_type === 'Fixed') {
        const fixed = await tenantDb(trx, this.tenant).table('contract_line_service_fixed_config').where('config_id', configId).first();
        const incoming = typeConfig as Partial<IContractLineServiceFixedConfig> | undefined;
        const kind = await this.resolveRecurringUnitKindForConfig(currentConfig.service_id, fixed?.pricing_basis);
        const isPriceOrQuantityEdit =
          baseConfig?.quantity !== undefined ||
          baseConfig?.custom_rate !== undefined ||
          incoming?.base_rate !== undefined;
        if (kind && isPriceOrQuantityEdit) {
          const boundary = incoming?.effective_period_start ?? await resolveNextUnbilledSeatBoundary({ trx, tenant: this.tenant, contractLineId: currentConfig.contract_line_id });
          if (boundary) {
            const effective = await resolveEffectiveRecurringUnitPricingInTransaction({
              trx, tenant: this.tenant, contractLineId: currentConfig.contract_line_id,
              serviceId: currentConfig.service_id, configId, kind, boundary,
            });
            // An explicit rate (including null from a product "use catalog
            // price" control) sets the policy. A quantity-only edit preserves
            // the policy already in force, so an inherited product stays
            // inherited and does not pin today's catalog rate.
            const explicitRate =
              incoming?.base_rate !== undefined ? incoming.base_rate : baseConfig?.custom_rate;
            let pricePolicy: 'override' | 'catalog';
            let unitRateCents: number | null;
            if (explicitRate === null) {
              pricePolicy = kind === 'product' ? 'catalog' : effective.pricePolicy;
              unitRateCents = pricePolicy === 'override' ? effective.unitRateCents : null;
            } else if (explicitRate !== undefined) {
              pricePolicy = 'override';
              unitRateCents = Number(explicitRate);
            } else {
              pricePolicy = effective.pricePolicy;
              unitRateCents = pricePolicy === 'override' ? effective.unitRateCents : null;
            }
            const scheduled = await scheduleRecurringUnitRevisionInTransaction({
              trx, tenant: this.tenant, userId: null,
              contractLineId: currentConfig.contract_line_id, serviceId: currentConfig.service_id, configId,
              kind, quantity: Number(baseConfig?.quantity ?? effective.quantity),
              pricePolicy, unitRateCents, effectivePeriodStart: boundary,
              // Default (null): create-only at an empty boundary; replacing a
              // scheduled change then goes through the scheduling panel's
              // compare-and-set. The transactional line save passes the version
              // it read under the billing lock.
              expectedVersion: expectedRevisionVersion,
            });
            if (scheduled.ok === false) throw new Error(scheduled.error);
            const { quantity, custom_rate, ...restBase } = baseConfig ?? {};
            baseConfig = restBase;
            const { base_rate, base_rate_basis, effective_period_start, ...restFixed } = incoming ?? {};
            typeConfig = restFixed;
          }
        }
      }
      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new ContractLineServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);
      
      // Update base configuration if provided
      if (baseConfig) {
        await planServiceConfigModel.update(configId, baseConfig);
      }
      
      // Update type-specific configuration if provided
      if (typeConfig) {
        switch (currentConfig.configuration_type) {
          case 'Fixed':
            // Proration and alignment fields are no longer part of IContractLineServiceFixedConfig
            // The typeConfig passed in should already only contain allowed fields (like base_rate)
            const fixedUpdateData = { ...typeConfig } as Partial<IContractLineServiceFixedConfig>;
            delete fixedUpdateData.effective_period_start;
            // delete fixedUpdateData.enable_proration; // Removed as property no longer exists
            // delete fixedUpdateData.billing_cycle_alignment; // Removed as property no longer exists
            // Only update if there are other fields left (e.g., base_rate)
            if (Object.keys(fixedUpdateData).length > 0) {
              // Model.update recomputes basis + provenance with the rate and
              // keeps the stored basis when the patch does not state one.
              await fixedConfigModel.update(configId, fixedUpdateData as Parameters<typeof fixedConfigModel.update>[1]);
            }
            break;
            
          case 'Hourly':
            // Ensure only hourly-specific fields from the new schema are passed
            const hourlyUpdateData = typeConfig as Partial<IContractLineServiceHourlyConfig>;
            const updatePayload: Partial<IContractLineServiceHourlyConfig> = {};
            if (typeof hourlyUpdateData.hourly_rate !== 'undefined') {
              updatePayload.hourly_rate = hourlyUpdateData.hourly_rate;
            }
            if (typeof hourlyUpdateData.minimum_billable_time !== 'undefined') {
              updatePayload.minimum_billable_time = hourlyUpdateData.minimum_billable_time;
            }
            if (typeof hourlyUpdateData.round_up_to_nearest !== 'undefined') {
              updatePayload.round_up_to_nearest = hourlyUpdateData.round_up_to_nearest;
            }
            
            if (Object.keys(updatePayload).length > 0) {
               await hourlyConfigModel.update(configId, updatePayload);
            }
            break;
            
          case 'Usage':
            await usageConfigModel.update(configId, typeConfig as Partial<IContractLineServiceUsageConfig>);
            break;
            
          case 'Bucket':
            await bucketConfigModel.update(configId, typeConfig as Partial<IContractLineServiceBucketConfig>);
            break;
        }
      }
      // Handle rate tiers update if provided and config type is Usage
      if (rateTiers && currentConfig.configuration_type === 'Usage') {
        // Delete existing rate tiers for this configuration
        await usageConfigModel.deleteRateTiersByConfigId(configId); // Assuming this method exists or will be added

        // Insert new rate tiers
        for (const tierData of rateTiers) {
          // Ensure tenant is set correctly and only pass necessary fields
          await usageConfigModel.addRateTier({
            config_id: configId,
            min_quantity: tierData.min_quantity,
            max_quantity: tierData.max_quantity,
            rate: tierData.rate
          });
        }
      }
      // User type rates are plan-wide and not updated here.
      
      return true;
    });
  }

  /**
   * Delete a plan service configuration and its type-specific configuration
   */
  async deleteConfiguration(configId: string): Promise<boolean> {
    await this.initKnex();
    
    // Get current configuration to determine type
    const currentConfig = await this.planServiceConfigModel.getById(configId);
    if (!currentConfig) {
      throw new Error(`Configuration with ID ${configId} not found`);
    }
    
    // Use transaction to ensure all operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      // Serialize against billing writes and refuse to erase an item that has
      // issued-invoice provenance or scheduled effective history. The operator
      // stops such an item with a zero revision instead of deleting it.
      await lockTenantBilling(trx, this.tenant);
      const deletionGuard = await configurationDeletionGuard({
        trx,
        tenant: this.tenant,
        configId,
      });
      if (deletionGuard) {
        throw new Error(deletionGuard);
      }

      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new ContractLineServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);

      // Explicitly delete type-specific configuration first (no CASCADE)
      switch (currentConfig.configuration_type) {
        case 'Fixed':
          await fixedConfigModel.delete(configId);
          break;
        case 'Hourly':
          // Explicitly delete from contract_line_service_hourly_configs first
          await hourlyConfigModel.delete(configId);
          break;
        case 'Usage':
          // Also delete rate tiers if applicable
          await usageConfigModel.deleteRateTiersByConfigId(configId);
          await usageConfigModel.delete(configId);
          break;
        case 'Bucket':
          await bucketConfigModel.delete(configId);
          break;
      }
      
      // Delete base configuration
      await planServiceConfigModel.delete(configId);
      
      return true;
    });
  }

  /**
   * Get all configurations for a plan
   */
  async getConfigurationsForPlan(contractLineId: string): Promise<IContractLineServiceConfiguration[]> {
    await this.initKnex();
    
    return await this.planServiceConfigModel.getByContractLineId(contractLineId);
  }

  /**
   * Get configuration for a specific service within a plan
   */
  async getConfigurationForService(contractLineId: string, serviceId: string): Promise<IContractLineServiceConfiguration | null> {
    await this.initKnex();

    // LEVERAGE: pattern template-vs-live-branch — template lines live in separate tables keyed by template_line_id
    if (await this.findTemplateLine(this.knex, contractLineId)) {
      const row = await this.templateTable(this.knex, 'contract_template_line_service_configuration')
        .where({ template_line_id: contractLineId, service_id: serviceId })
        .orderByRaw(`CASE WHEN configuration_type = 'Bucket' THEN 1 ELSE 0 END`)
        .first();
      return row ? this.mapTemplateConfigRow(row) : null;
    }

    return await this.planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
  }

  private templateTable(conn: Knex | Knex.Transaction, table: string): Knex.QueryBuilder {
    return tenantDb(conn as Knex, this.tenant).table(table);
  }

  private async findTemplateLine(conn: Knex | Knex.Transaction, contractLineId: string) {
    return this.templateTable(conn, 'contract_template_lines')
      .where({ template_line_id: contractLineId })
      .first();
  }

  private mapTemplateConfigRow(row: any): IContractLineServiceConfiguration {
    const { template_line_id, ...rest } = row;
    return { ...rest, contract_line_id: template_line_id } as IContractLineServiceConfiguration;
  }

  /**
   * Writes the type-specific template config row (hourly/usage/bucket) for a template
   * service configuration, updating when it exists and inserting otherwise. Fixed
   * configurations have no template type-specific row and are ignored here.
   * Template schema has no rate-tier storage, so tiers are intentionally not handled.
   */
  async upsertTemplateTypeConfig(
    trx: Knex | Knex.Transaction,
    configId: string,
    configurationType: string,
    data: Record<string, any> | undefined,
  ): Promise<void> {
    await this.initKnex();
    const now = trx.fn.now();
    const pick = (keys: string[]) => {
      const out: Record<string, any> = {};
      for (const key of keys) {
        if (data && data[key] !== undefined) out[key] = data[key];
      }
      return out;
    };

    let table: string;
    let values: Record<string, any>;
    let createDefaults: Record<string, any>;
    if (configurationType === 'Hourly') {
      table = 'contract_template_line_service_hourly_config';
      values = pick([
        'hourly_rate', 'minimum_billable_time', 'round_up_to_nearest', 'enable_overtime',
        'overtime_rate', 'overtime_threshold', 'enable_after_hours_rate', 'after_hours_multiplier',
      ]);
      createDefaults = { minimum_billable_time: 15, round_up_to_nearest: 15 };
    } else if (configurationType === 'Usage') {
      table = 'contract_template_line_service_usage_config';
      values = pick(['unit_of_measure', 'enable_tiered_pricing', 'minimum_usage', 'base_rate']);
      if (values.unit_of_measure !== undefined) {
        values = withUnitCode(values as { unit_of_measure: string }) as Record<string, any>;
      }
      createDefaults = {
        ...withUnitCode({ unit_of_measure: resolveUnitOfMeasure({ fallback: 'C62' }).label }),
        enable_tiered_pricing: false,
      };
    } else if (configurationType === 'Bucket') {
      table = 'contract_template_line_service_bucket_config';
      values = pick(['total_minutes', 'billing_period', 'overage_rate', 'allow_rollover']);
      createDefaults = { total_minutes: 0, billing_period: 'monthly', overage_rate: 0, allow_rollover: false };
    } else {
      return;
    }

    const existing = await this.templateTable(trx, table).where({ config_id: configId }).first();
    if (existing) {
      if (Object.keys(values).length > 0) {
        await this.templateTable(trx, table)
          .where({ config_id: configId })
          .update({ ...values, updated_at: now });
      }
      return;
    }
    if (configurationType === 'Hourly' && values.hourly_rate === undefined) {
      throw new Error('Hourly rate is required when creating hourly configuration.');
    }
    await this.templateTable(trx, table).insert({
      tenant: this.tenant,
      config_id: configId,
      ...createDefaults,
      ...values,
      created_at: now,
      updated_at: now,
    });
  }

  /**
   * Deletes type-specific template rows that no longer apply once a configuration's type
   * changes (e.g. Hourly -> Fixed), so stale rows cannot be picked up by readers.
   * The bucket overlay is kept for Hourly/Usage/Bucket and dropped for Fixed.
   */
  async clearStaleTemplateTypeRows(
    trx: Knex | Knex.Transaction,
    configId: string,
    configurationType: string,
  ): Promise<void> {
    await this.initKnex();
    if (configurationType !== 'Hourly') {
      await this.templateTable(trx, 'contract_template_line_service_hourly_config').where({ config_id: configId }).delete();
    }
    if (configurationType !== 'Usage') {
      await this.templateTable(trx, 'contract_template_line_service_usage_config').where({ config_id: configId }).delete();
    }
    if (!['Hourly', 'Usage', 'Bucket'].includes(configurationType)) {
      await this.templateTable(trx, 'contract_template_line_service_bucket_config').where({ config_id: configId }).delete();
    }
  }

  /**
   * Template counterpart of updateConfiguration: updates the base template config row
   * (and the mirrored contract_template_line_services row) plus the type-specific row.
   */
  async updateTemplateConfiguration(
    configId: string,
    baseUpdates?: Partial<IContractLineServiceConfiguration>,
    typeConfig?: Record<string, any>,
  ): Promise<void> {
    await this.initKnex();
    await this.knex.transaction(async (trx) => {
      const base = await this.templateTable(trx, 'contract_template_line_service_configuration')
        .where({ config_id: configId })
        .first();
      if (!base) {
        throw new Error(`Configuration with ID ${configId} not found.`);
      }
      const previousType = base.configuration_type;
      const patch: Record<string, any> = {};
      if (baseUpdates?.quantity !== undefined) patch.quantity = baseUpdates.quantity;
      if (baseUpdates?.custom_rate !== undefined) patch.custom_rate = baseUpdates.custom_rate;
      if (baseUpdates?.configuration_type !== undefined) patch.configuration_type = baseUpdates.configuration_type;
      if (Object.keys(patch).length > 0) {
        patch.updated_at = trx.fn.now();
        await this.templateTable(trx, 'contract_template_line_service_configuration')
          .where({ config_id: configId })
          .update(patch);
        const membershipPatch: Record<string, any> = { updated_at: trx.fn.now() };
        if (patch.quantity !== undefined) membershipPatch.quantity = patch.quantity;
        if (patch.custom_rate !== undefined) membershipPatch.custom_rate = patch.custom_rate;
        await this.templateTable(trx, 'contract_template_line_services')
          .where({ template_line_id: base.template_line_id, service_id: base.service_id })
          .update(membershipPatch);
      }
      const effectiveType = patch.configuration_type ?? previousType;
      if (effectiveType !== previousType) {
        await this.clearStaleTemplateTypeRows(trx, configId, effectiveType);
      }
      await this.upsertTemplateTypeConfig(trx, configId, effectiveType, typeConfig);
    });
  }

  /**
   * Finds or creates the base template config row for (template line, service), forcing
   * its configuration_type. Returns the config id.
   */
  private async ensureTemplateBaseConfig(
    trx: Knex.Transaction,
    templateLineId: string,
    serviceId: string,
    configurationType: string,
    customRate?: number | null,
  ): Promise<string> {
    const existing = await this.templateTable(trx, 'contract_template_line_service_configuration')
      .where({ template_line_id: templateLineId, service_id: serviceId })
      .first();
    if (existing) {
      const patch: Record<string, any> = {};
      if (existing.configuration_type !== configurationType) {
        patch.configuration_type = configurationType;
        await this.clearStaleTemplateTypeRows(trx, existing.config_id, configurationType);
      }
      if (customRate !== undefined) patch.custom_rate = customRate;
      if (Object.keys(patch).length > 0) {
        await this.templateTable(trx, 'contract_template_line_service_configuration')
          .where({ config_id: existing.config_id })
          .update({ ...patch, updated_at: trx.fn.now() });
      }
      return existing.config_id;
    }
    const membership = await this.templateTable(trx, 'contract_template_line_services')
      .where({ template_line_id: templateLineId, service_id: serviceId })
      .first();
    if (!membership) {
      await this.templateTable(trx, 'contract_template_line_services').insert({
        tenant: this.tenant,
        template_line_id: templateLineId,
        service_id: serviceId,
        quantity: null,
        custom_rate: customRate ?? null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    }
    const configId = uuidv4();
    await this.templateTable(trx, 'contract_template_line_service_configuration').insert({
      tenant: this.tenant,
      config_id: configId,
      template_line_id: templateLineId,
      service_id: serviceId,
      configuration_type: configurationType,
      custom_rate: customRate ?? null,
      quantity: null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    return configId;
  }

  /**
   * Upserts the bucket-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Bucket'.
   */
  async upsertPlanServiceBucketConfiguration(
    contractLineId: string,
    serviceId: string,
    bucketConfigData: Partial<Omit<IContractLineServiceBucketConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      // LEVERAGE: pattern template-vs-live-branch — see getConfigurationForService
      const templateLine = await this.findTemplateLine(trx, contractLineId);
      if (templateLine) {
        // Template bucket rows are keyed by the config_id of the service's primary
        // (Hourly/Usage) configuration, matching the contract wizard. Only create a
        // standalone Bucket-typed base row when the service has no configuration yet.
        const primary = await this.templateTable(trx, 'contract_template_line_service_configuration')
          .where({ template_line_id: contractLineId, service_id: serviceId })
          .first();
        const configId = primary
          ? primary.config_id
          : await this.ensureTemplateBaseConfig(trx, contractLineId, serviceId, 'Bucket');
        await this.upsertTemplateTypeConfig(trx, configId, 'Bucket', {
          ...bucketConfigData,
          billing_period: bucketConfigData.billing_period ?? templateLine.billing_frequency ?? 'monthly',
        });
        return configId;
      }

      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);
      const ContractLine = (await import('../models/contractLine')).default;

      // 0. Fetch contract line and validate/set bucket billing_period
      const contractLine = await ContractLine.findById(trx, contractLineId);
      if (!contractLine) {
        throw new Error(`Contract line ${contractLineId} not found`);
      }

      // Validate or set billing_period to match contract line's billing_frequency
      if (bucketConfigData.billing_period) {
        if (bucketConfigData.billing_period !== contractLine.billing_frequency) {
          throw new Error(
            `Bucket billing period (${bucketConfigData.billing_period}) must match contract line billing frequency (${contractLine.billing_frequency})`
          );
        }
      } else {
        // Auto-set billing_period to match contract line's billing_frequency
        bucketConfigData.billing_period = contractLine.billing_frequency;
      }

      // 1. Find existing base configuration
      let baseConfig = await planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
      let configId: string;

      if (!baseConfig) {
        // 2. Create base configuration if it doesn't exist, force type to Bucket
        console.log(`No base config found for contract line ${contractLineId}, service ${serviceId}. Creating one with type Bucket.`);
        const newBaseConfigData: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          contract_line_id: contractLineId,
          service_id: serviceId,
          configuration_type: 'Bucket', // Force type to Bucket
          // is_enabled: true, // Removed: Field does not exist on base config interface
          tenant: this.tenant,
        };
        configId = await planServiceConfigModel.create(newBaseConfigData);
        console.log(`Created base config with ID: ${configId}`);
      } else {
        configId = baseConfig.config_id;
        // 3. Update base configuration type if it's not Bucket
        if (baseConfig.configuration_type !== 'Bucket') {
          console.log(`Base config ${configId} type is ${baseConfig.configuration_type}. Updating to Bucket.`);
          await planServiceConfigModel.update(configId, { configuration_type: 'Bucket' });
        }
      }

      // 4. Upsert bucket-specific configuration
      const dataToUpsert = {
        ...bucketConfigData,
        config_id: configId,
        tenant: this.tenant,
      };

      // Try updating first
      const updatedCount = await bucketConfigModel.update(configId, dataToUpsert);

      if (!updatedCount) { // Check if update returned false (no rows affected)
        // If update didn't affect any rows (meaning it didn't exist), create it
        console.log(`No existing bucket config for ${configId}. Creating.`);
        // Ensure all required fields for creation are present, potentially using defaults
        const createData: Omit<IContractLineServiceBucketConfig, 'created_at' | 'updated_at'> = {
            config_id: configId,
            total_minutes: bucketConfigData.total_minutes ?? 0, // Provide defaults if needed
            billing_period: bucketConfigData.billing_period ?? contractLine.billing_frequency,
            overage_rate: bucketConfigData.overage_rate ?? 0,
            allow_rollover: bucketConfigData.allow_rollover ?? false,
            tenant: this.tenant,
        };
        await bucketConfigModel.create(createData);
      } else {
         console.log(`Updated existing bucket config for ${configId}.`);
      }


      return configId;
    });
  }

  /**
   * Upserts the hourly-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Hourly'.
   */
  async upsertPlanServiceHourlyConfiguration(
    contractLineId: string,
    serviceId: string,
    hourlyConfigData: Partial<Omit<IContractLineServiceHourlyConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      // LEVERAGE: pattern template-vs-live-branch — see getConfigurationForService
      if (await this.findTemplateLine(trx, contractLineId)) {
        const configId = await this.ensureTemplateBaseConfig(trx, contractLineId, serviceId, 'Hourly');
        await this.upsertTemplateTypeConfig(trx, configId, 'Hourly', hourlyConfigData);
        return configId;
      }

      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);

      // 1. Find existing base configuration
      let baseConfig = await planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
      let configId: string;

      if (!baseConfig) {
        // 2. Create base configuration if it doesn't exist, force type to Hourly
        console.log(`No base config found for contract line ${contractLineId}, service ${serviceId}. Creating one with type Hourly.`);
        const newBaseConfigData: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          contract_line_id: contractLineId,
          service_id: serviceId,
          configuration_type: 'Hourly', // Force type to Hourly
          tenant: this.tenant,
        };
        configId = await planServiceConfigModel.create(newBaseConfigData);
        console.log(`Created base config with ID: ${configId}`);
      } else {
        configId = baseConfig.config_id;
        // 3. Update base configuration type if it's not Hourly
        if (baseConfig.configuration_type !== 'Hourly') {
          console.log(`Base config ${configId} type is ${baseConfig.configuration_type}. Updating to Hourly.`);
          await planServiceConfigModel.update(configId, { configuration_type: 'Hourly' });
        }
      }

      // 4. Upsert hourly-specific configuration
      const dataToUpsert = {
        ...hourlyConfigData,
        config_id: configId,
        tenant: this.tenant,
      };

      // Try updating first
      const updatedCount = await hourlyConfigModel.update(configId, dataToUpsert);

      if (!updatedCount) { // Check if update returned false (no rows affected)
        // If update didn't affect any rows (meaning it didn't exist), create it
        console.log(`No existing hourly config for ${configId}. Creating.`);
        // Ensure all required fields for creation are present
        if (typeof hourlyConfigData.hourly_rate === 'undefined') {
          throw new Error('Hourly rate is required when creating hourly configuration.');
        }
        const createData: Omit<IContractLineServiceHourlyConfig, 'created_at' | 'updated_at'> = {
            config_id: configId,
            hourly_rate: hourlyConfigData.hourly_rate,
            minimum_billable_time: hourlyConfigData.minimum_billable_time ?? 15, // Provide defaults
            round_up_to_nearest: hourlyConfigData.round_up_to_nearest ?? 15, // Provide defaults
            tenant: this.tenant,
        };
        await hourlyConfigModel.create(createData);
      } else {
         console.log(`Updated existing hourly config for ${configId}.`);
      }

      return configId;
    });
  }

  /**
   * Upserts the usage-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Usage'.
   */
  async upsertPlanServiceUsageConfiguration(
    contractLineId: string,
    serviceId: string,
    usageConfigData: {
      unit_rate?: number;
      unit_of_measure?: string;
      enable_tiered_pricing?: boolean;
      minimum_usage?: number | null;
    }
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      const normalizedUnitRate = Math.max(0, Math.round(usageConfigData.unit_rate ?? 0));

      // LEVERAGE: pattern template-vs-live-branch — see getConfigurationForService
      if (await this.findTemplateLine(trx, contractLineId)) {
        // Only touch the rate when the caller supplied one, so partial edits don't zero it.
        const rateProvided = usageConfigData.unit_rate !== undefined;
        const configId = await this.ensureTemplateBaseConfig(
          trx, contractLineId, serviceId, 'Usage', rateProvided ? normalizedUnitRate : undefined,
        );
        await this.upsertTemplateTypeConfig(trx, configId, 'Usage', {
          unit_of_measure: usageConfigData.unit_of_measure,
          enable_tiered_pricing: usageConfigData.enable_tiered_pricing,
          minimum_usage: usageConfigData.minimum_usage ?? undefined,
          base_rate: rateProvided ? normalizedUnitRate : undefined,
        });
        return configId;
      }

      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);

      let baseConfig = await planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
      let configId: string;

      if (!baseConfig) {
        const newBaseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          contract_line_id: contractLineId,
          service_id: serviceId,
          configuration_type: 'Usage',
          custom_rate: normalizedUnitRate,
          quantity: undefined,
          tenant: this.tenant,
        };
        configId = await planServiceConfigModel.create(newBaseConfig);
      } else {
        configId = baseConfig.config_id;
        const updatePayload: Partial<IContractLineServiceConfiguration> = {
          custom_rate: normalizedUnitRate,
        };
        if (baseConfig.configuration_type !== 'Usage') {
          updatePayload.configuration_type = 'Usage';
        }
        await planServiceConfigModel.update(configId, updatePayload);
      }

      const usagePayload = {
        unit_of_measure: usageConfigData.unit_of_measure ?? resolveUnitOfMeasure({ fallback: 'C62' }).label,
        enable_tiered_pricing: usageConfigData.enable_tiered_pricing ?? false,
        minimum_usage: usageConfigData.minimum_usage ?? 0,
        base_rate: normalizedUnitRate,
      };

      const existingUsage = await usageConfigModel.getByConfigId(configId);
      if (existingUsage) {
        await usageConfigModel.update(configId, usagePayload);
      } else {
        await usageConfigModel.create({
          config_id: configId,
          ...usagePayload,
        });
      }

      return configId;
    });
  }

  /**
   * Upserts (replaces) all user type rates for a specific hourly configuration.
   * Deletes existing rates and inserts the provided ones within a transaction.
   */
  async upsertUserTypeRates(
    configId: string,
    rates: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>[]
  ): Promise<void> {
    await this.initKnex();

    // Ensure the config exists and is of type 'Hourly' before proceeding
    const baseConfig = await this.planServiceConfigModel.getById(configId);
    if (!baseConfig) {
      throw new Error(`Configuration with ID ${configId} not found.`);
    }
    if (baseConfig.configuration_type !== 'Hourly') {
      throw new Error(`Configuration with ID ${configId} is not an Hourly configuration.`);
    }

    await this.knex.transaction(async (trx) => {
      // Create model with transaction
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);

      // 1. Delete existing rates for this config_id
      await hourlyConfigModel.deleteUserTypeRatesByConfigId(configId); // Assuming this method exists or will be added

      // 2. Insert new rates if provided
      if (rates && rates.length > 0) {
        const ratesToInsert = rates.map(rate => ({
          ...rate,
          config_id: configId,
          tenant: this.tenant,
        }));
        await hourlyConfigModel.addUserTypeRates(ratesToInsert); // Assuming addUserTypeRates can handle an array
      }
    });
  }
}
