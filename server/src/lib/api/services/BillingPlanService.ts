/**
 * Billing Plan Service
 * Comprehensive service layer for billing plan operations with validation, business logic, and API integration
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { withTransaction } from '@shared/db';
import { IBillingPlan, IBillingPlanFixedConfig, ICompanyBillingPlan, IBucketUsage } from 'server/src/interfaces/billing.interfaces';
import { IPlanBundle, IBundleBillingPlan, ICompanyPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { IPlanServiceConfiguration } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';

// Import existing models and actions for integration
import BillingPlan from 'server/src/lib/models/billingPlan';
import BillingPlanFixedConfig from 'server/src/lib/models/billingPlanFixedConfig';
import BundleBillingPlan from 'server/src/lib/models/bundleBillingPlan';
import { PlanServiceConfigurationService } from 'server/src/lib/services/planServiceConfigurationService';

// Import schema types for validation
import {
  CreateBillingPlanData,
  UpdateBillingPlanData,
  BillingPlanResponse,
  BillingPlanFilterData,
  CreateFixedPlanConfigData,
  UpdateFixedPlanConfigData,
  CreatePlanBundleData,
  UpdatePlanBundleData,
  PlanBundleResponse,
  CreateCompanyBillingPlanData,
  UpdateCompanyBillingPlanData,
  CompanyBillingPlanResponse,
  AddServiceToPlanData,
  UpdatePlanServiceData,
  CopyBillingPlanData,
  CreatePlanTemplateData,
  PlanTemplateResponse,
  CreatePlanFromTemplateData,
  PlanActivationData,
  CompanyPlanActivationData,
  BulkCreateBillingPlansData,
  BulkUpdateBillingPlansData,
  BulkDeleteBillingPlansData,
  BulkAddServicesToPlanData,
  BulkRemoveServicesFromPlanData,
  PlanAnalyticsResponse,
  BundleAnalyticsResponse,
  BillingOverviewAnalytics,
  UsageMetricsResponse
} from '../schemas/billingPlanSchemas';

import { ListOptions } from '../controllers/BaseController';
import { generateResourceLinks, addHateoasLinks } from '../utils/responseHelpers';

export interface BillingPlanServiceOptions {
  includeAnalytics?: boolean;
  includeServices?: boolean;
  includeUsage?: boolean;
  includeCompanies?: boolean;
}

export interface PlanTemplate {
  template_id: string;
  template_name: string;
  template_description?: string;
  plan_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  billing_frequency: string;
  default_services?: Array<{
    service_id: string;
    service_name: string;
    configuration_type: string;
    default_rate?: number;
    quantity: number;
  }>;
  is_public: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  tenant: string;
}

export class BillingPlanService extends BaseService<IBillingPlan> {
  private planServiceConfigService: PlanServiceConfigurationService;

  constructor() {
    super({
      tableName: 'billing_plans',
      primaryKey: 'plan_id',
      tenantColumn: 'tenant',
      searchableFields: ['plan_name', 'service_category'],
      defaultSort: 'plan_name',
      defaultOrder: 'asc'
    });
    this.planServiceConfigService = new PlanServiceConfigurationService();
  }

  // ============================================================================
  // BASIC CRUD OPERATIONS WITH VALIDATION
  // ============================================================================

  /**
   * List billing plans with enhanced filtering and analytics
   */
  async list(
    options: ListOptions, 
    context: ServiceContext, 
    serviceOptions: BillingPlanServiceOptions = {}
  ): Promise<ListResult<BillingPlanResponse>> {
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      filters = {} as BillingPlanFilterData,
      sort,
      order
    } = options;

    // Build enhanced query with analytics if requested
    let dataQuery = this.buildBillingPlanQuery(knex, context, serviceOptions);
    dataQuery = this.applyBillingPlanFilters(dataQuery, filters);
    dataQuery = this.applySorting(dataQuery, sort, order);
    dataQuery = this.applyPagination(dataQuery, page, limit);

    // Build count query
    let countQuery = this.buildBaseQuery(knex, context);
    countQuery = this.applyBillingPlanFilters(countQuery, filters);

    // Execute queries
    const [plans, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    // Add HATEOAS links
    const plansWithLinks = plans.map((plan: IBillingPlan) => 
      addHateoasLinks(plan, this.generatePlanLinks(plan.plan_id!, context))
    );

    return {
      data: plansWithLinks as BillingPlanResponse[],
      total: parseInt(count as string)
    };
  }

  /**
   * Get billing plan by ID with related data
   */
  async getById(
    id: string, 
    context: ServiceContext, 
    options: BillingPlanServiceOptions = {}
  ): Promise<BillingPlanResponse | null> {
    const { knex } = await this.getKnex();
    
    const query = this.buildBillingPlanQuery(knex, context, options)
      .where('bp.plan_id', id)
      .first();

    const plan = await query;
    
    if (!plan) {
      return null;
    }

    // Add HATEOAS links
    return addHateoasLinks(plan, this.generatePlanLinks(id, context)) as BillingPlanResponse;
  }

  /**
   * Create new billing plan with validation and audit trail
   */
  async create(data: CreateBillingPlanData, context: ServiceContext): Promise<BillingPlanResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Validate business rules
      await this.validatePlanCreation(data, context, trx);
      
      // Create the plan
      const planData = this.addCreateAuditFields(data, context);
      planData.plan_id = uuidv4();
      
      const [plan] = await trx('billing_plans').insert(planData).returning('*');
      
      // Create type-specific configuration if needed
      if (data.plan_type === 'Fixed' && data.base_rate !== undefined) {
        await this.createFixedPlanConfig(plan.plan_id, {
          base_rate: data.base_rate,
          enable_proration: false,
          billing_cycle_alignment: 'start'
        }, context, trx);
      }
      
      // Add HATEOAS links
      return addHateoasLinks(plan, this.generatePlanLinks(plan.plan_id, context)) as BillingPlanResponse;
    });
  }

  /**
   * Update billing plan with validation
   */
  async update(
    id: string, 
    data: UpdateBillingPlanData, 
    context: ServiceContext
  ): Promise<BillingPlanResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if plan exists and get current state
      const existingPlan = await this.getExistingPlan(id, context, trx);
      
      // Validate business rules
      await this.validatePlanUpdate(id, data, existingPlan, context, trx);
      
      // Prepare update data
      const updateData = this.addUpdateAuditFields(data, context);
      
      // Handle plan type specific logic
      if (existingPlan.plan_type === 'Hourly') {
        // Remove per-service fields for hourly plans
        delete updateData.hourly_rate;
        delete updateData.minimum_billable_time;
        delete updateData.round_up_to_nearest;
      }
      
      // Update the plan
      const [updatedPlan] = await trx('billing_plans')
        .where('plan_id', id)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');
      
      if (!updatedPlan) {
        throw new Error('Plan not found or permission denied');
      }
      
      return addHateoasLinks(updatedPlan, this.generatePlanLinks(id, context)) as BillingPlanResponse;
    });
  }

  /**
   * Delete billing plan with cascade checks
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if plan is in use
      const isInUse = await this.isPlanInUse(id, context, trx);
      if (isInUse.inUse) {
        throw new Error(`Cannot delete plan: ${isInUse.reason}`);
      }
      
      // Remove associated services first
      await this.removeAllServicesFromPlan(id, context, trx);
      
      // Remove from bundles
      await this.removePlanFromAllBundles(id, context, trx);
      
      // Delete the plan
      const deletedCount = await trx('billing_plans')
        .where('plan_id', id)
        .where('tenant', context.tenant)
        .delete();
      
      if (deletedCount === 0) {
        throw new Error('Plan not found or permission denied');
      }
    });
  }

  // ============================================================================
  // PLAN CONFIGURATION MANAGEMENT
  // ============================================================================

  /**
   * Get fixed plan configuration
   */
  async getFixedPlanConfig(
    planId: string, 
    context: ServiceContext
  ): Promise<IBillingPlanFixedConfig | null> {
    const { knex } = await this.getKnex();
    
    const config = await knex('billing_plan_fixed_config')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .first();
    
    return config || null;
  }

  /**
   * Create or update fixed plan configuration
   */
  async upsertFixedPlanConfig(
    planId: string,
    data: CreateFixedPlanConfigData,
    context: ServiceContext
  ): Promise<IBillingPlanFixedConfig> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Verify plan exists and is Fixed type
      const plan = await this.getExistingPlan(planId, context, trx);
      if (plan.plan_type !== 'Fixed') {
        throw new Error('Can only add fixed configuration to Fixed type plans');
      }
      
      // Upsert configuration
      const configData = {
        plan_id: planId,
        ...data,
        tenant: context.tenant,
        updated_at: new Date()
      };
      
      const [config] = await trx('billing_plan_fixed_config')
        .insert(configData)
        .onConflict(['plan_id', 'tenant'])
        .merge(configData)
        .returning('*');
      
      return config;
    });
  }

  /**
   * Get combined fixed plan configuration (plan-level + service-level)
   */
  async getCombinedFixedPlanConfig(
    planId: string,
    serviceId: string,
    context: ServiceContext
  ): Promise<any> {
    const { knex } = await this.getKnex();
    
    // Get plan-level config
    const planConfig = await this.getFixedPlanConfig(planId, context);
    
    // Get service-level config
    this.planServiceConfigService = new PlanServiceConfigurationService(knex, context.tenant);
    const serviceConfig = await this.planServiceConfigService.getConfigurationForService(planId, serviceId);
    
    return {
      base_rate: planConfig?.base_rate || null,
      enable_proration: planConfig?.enable_proration || false,
      billing_cycle_alignment: planConfig?.billing_cycle_alignment || 'start',
      config_id: serviceConfig?.config_id
    };
  }

  // ============================================================================
  // SERVICE MANAGEMENT
  // ============================================================================

  /**
   * Add service to billing plan
   */
  async addServiceToPlan(
    planId: string,
    data: AddServiceToPlanData,
    context: ServiceContext
  ): Promise<IPlanServiceConfiguration> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Validate plan exists
      const plan = await this.getExistingPlan(planId, context, trx);
      
      // Validate service exists
      const service = await this.getServiceById(data.service_id, context, trx);
      if (!service) {
        throw new Error('Service not found');
      }
      
      // Check if service already exists in plan
      const existingConfig = await trx('plan_service_configuration')
        .where('plan_id', planId)
        .where('service_id', data.service_id)
        .where('tenant', context.tenant)
        .first();
      
      if (existingConfig) {
        throw new Error('Service already exists in this plan');
      }
      
      // Create service configuration
      this.planServiceConfigService = new PlanServiceConfigurationService(trx, context.tenant);
      
      const baseConfigData = {
        plan_id: planId,
        service_id: data.service_id,
        configuration_type: data.configuration_type || plan.plan_type,
        custom_rate: data.custom_rate,
        quantity: data.quantity || 1,
        tenant: context.tenant
      };
      
      const configId = await this.planServiceConfigService.createConfiguration(
        baseConfigData,
        data.type_config || {}
      );
      
      // Return the created configuration
      return await this.planServiceConfigService.getConfigurationWithDetails(configId);
    });
  }

  /**
   * Remove service from billing plan
   */
  async removeServiceFromPlan(
    planId: string,
    serviceId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get configuration to delete
      const config = await trx('plan_service_configuration')
        .where('plan_id', planId)
        .where('service_id', serviceId)
        .where('tenant', context.tenant)
        .first();
      
      if (!config) {
        throw new Error('Service configuration not found in plan');
      }
      
      // Use service to delete configuration and related data
      this.planServiceConfigService = new PlanServiceConfigurationService(trx, context.tenant);
      await this.planServiceConfigService.deleteConfiguration(config.config_id);
    });
  }

  /**
   * Update service configuration in plan
   */
  async updatePlanService(
    planId: string,
    serviceId: string,
    data: UpdatePlanServiceData,
    context: ServiceContext
  ): Promise<IPlanServiceConfiguration> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get existing configuration
      const config = await trx('plan_service_configuration')
        .where('plan_id', planId)
        .where('service_id', serviceId)
        .where('tenant', context.tenant)
        .first();
      
      if (!config) {
        throw new Error('Service configuration not found in plan');
      }
      
      // Update configuration
      this.planServiceConfigService = new PlanServiceConfigurationService(trx, context.tenant);
      
      const baseConfigUpdates = {
        custom_rate: data.custom_rate,
        quantity: data.quantity
      };
      
      await this.planServiceConfigService.updateConfiguration(
        config.config_id,
        baseConfigUpdates,
        data.type_config
      );
      
      // Return updated configuration
      return await this.planServiceConfigService.getConfigurationWithDetails(config.config_id);
    });
  }

  /**
   * Get all services in a billing plan
   */
  async getPlanServices(
    planId: string,
    context: ServiceContext
  ): Promise<Array<any>> {
    const { knex } = await this.getKnex();
    
    const services = await knex('plan_service_configuration as psc')
      .join('services as s', function() {
        this.on('psc.service_id', '=', 's.service_id')
            .andOn('psc.tenant', '=', 's.tenant');
      })
      .where('psc.plan_id', planId)
      .where('psc.tenant', context.tenant)
      .select(
        'psc.*',
        's.service_name',
        's.default_rate',
        's.unit_of_measure',
        's.billing_method'
      );
    
    // Add configuration details for each service
    const servicesWithConfig = await Promise.all(
      services.map(async (service) => {
        this.planServiceConfigService = new PlanServiceConfigurationService(knex, context.tenant);
        const details = await this.planServiceConfigService.getConfigurationWithDetails(service.config_id);
        return {
          service: {
            service_id: service.service_id,
            service_name: service.service_name,
            default_rate: service.default_rate,
            unit_of_measure: service.unit_of_measure,
            billing_method: service.billing_method
          },
          configuration: service,
          type_config: details.typeConfig,
          rate_tiers: details.rateTiers || []
        };
      })
    );
    
    return servicesWithConfig;
  }

  // ============================================================================
  // BUNDLE MANAGEMENT
  // ============================================================================

  /**
   * Create a new plan bundle
   */
  async createBundle(
    data: CreatePlanBundleData,
    context: ServiceContext
  ): Promise<PlanBundleResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const bundleData = this.addCreateAuditFields({
        bundle_id: uuidv4(),
        ...data
      }, context);
      
      const [bundle] = await trx('plan_bundles').insert(bundleData).returning('*');
      
      return addHateoasLinks(bundle, this.generateBundleLinks(bundle.bundle_id, context)) as PlanBundleResponse;
    });
  }

  /**
   * Add plan to bundle
   */
  async addPlanToBundle(
    bundleId: string,
    planId: string,
    customRate: number | undefined,
    context: ServiceContext
  ): Promise<IBundleBillingPlan> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Validate bundle and plan exist
      await this.validateBundleExists(bundleId, context, trx);
      await this.getExistingPlan(planId, context, trx);
      
      // Check if plan is already in bundle
      const existing = await trx('bundle_billing_plans')
        .where('bundle_id', bundleId)
        .where('plan_id', planId)
        .where('tenant', context.tenant)
        .first();
      
      if (existing) {
        throw new Error('Plan already exists in this bundle');
      }
      
      // Add plan to bundle
      const bundlePlanData = {
        bundle_id: bundleId,
        plan_id: planId,
        custom_rate: customRate,
        tenant: context.tenant,
        created_at: new Date()
      };
      
      const [bundlePlan] = await trx('bundle_billing_plans')
        .insert(bundlePlanData)
        .returning('*');
      
      return bundlePlan;
    });
  }

  /**
   * Remove plan from bundle
   */
  async removePlanFromBundle(
    bundleId: string,
    planId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if bundle plan is assigned to companies
      const companyAssignments = await trx('company_billing_plans')
        .where('plan_id', planId)
        .where('company_bundle_id', bundleId)
        .where('tenant', context.tenant)
        .where('is_active', true);
      
      if (companyAssignments.length > 0) {
        throw new Error('Cannot remove plan from bundle: it is currently assigned to companies');
      }
      
      // Remove plan from bundle
      const deletedCount = await trx('bundle_billing_plans')
        .where('bundle_id', bundleId)
        .where('plan_id', planId)
        .where('tenant', context.tenant)
        .delete();
      
      if (deletedCount === 0) {
        throw new Error('Plan not found in bundle');
      }
    });
  }

  // ============================================================================
  // COMPANY ASSIGNMENT OPERATIONS
  // ============================================================================

  /**
   * Assign billing plan to company
   */
  async assignPlanToCompany(
    data: CreateCompanyBillingPlanData,
    context: ServiceContext
  ): Promise<CompanyBillingPlanResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Validate plan exists and is active
      const plan = await this.getExistingPlan(data.plan_id, context, trx);
      if (!plan.is_active) {
        throw new Error('Cannot assign inactive plan to company');
      }
      
      // Validate company exists
      await this.validateCompanyExists(data.company_id, context, trx);
      
      // Check for overlapping assignments
      await this.validateNoOverlappingAssignments(data, context, trx);
      
      // Create assignment
      const assignmentData = this.addCreateAuditFields({
        company_billing_plan_id: uuidv4(),
        ...data
      }, context);
      
      const [assignment] = await trx('company_billing_plans')
        .insert(assignmentData)
        .returning('*');
      
      return addHateoasLinks(assignment, this.generateCompanyPlanLinks(assignment.company_billing_plan_id, context)) as CompanyBillingPlanResponse;
    });
  }

  /**
   * Unassign billing plan from company
   */
  async unassignPlanFromCompany(
    companyBillingPlanId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if there are pending invoices or active usage
      await this.validateSafeUnassignment(companyBillingPlanId, context, trx);
      
      // Soft delete by setting end_date and is_active = false
      const updateData = this.addUpdateAuditFields({
        end_date: new Date().toISOString(),
        is_active: false
      }, context);
      
      const result = await trx('company_billing_plans')
        .where('company_billing_plan_id', companyBillingPlanId)
        .where('tenant', context.tenant)
        .update(updateData);
      
      if (result === 0) {
        throw new Error('Company billing plan assignment not found');
      }
    });
  }

  // ============================================================================
  // PLAN ACTIVATION AND LIFECYCLE
  // ============================================================================

  /**
   * Activate or deactivate billing plan
   */
  async setPlanActivation(
    planId: string,
    data: PlanActivationData,
    context: ServiceContext
  ): Promise<BillingPlanResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const plan = await this.getExistingPlan(planId, context, trx);
      
      // Validate deactivation is safe
      if (!data.is_active) {
        const usage = await this.isPlanInUse(planId, context, trx);
        if (usage.inUse && !data.reason) {
          throw new Error('Cannot deactivate plan that is in use without providing a reason');
        }
      }
      
      // Update plan activation status
      const updateData = this.addUpdateAuditFields({
        is_active: data.is_active
      }, context);
      
      const [updatedPlan] = await trx('billing_plans')
        .where('plan_id', planId)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');
      
      // If deactivating, also deactivate company assignments if requested
      if (!data.is_active && data.effective_date) {
        await trx('company_billing_plans')
          .where('plan_id', planId)
          .where('tenant', context.tenant)
          .where('is_active', true)
          .update({
            is_active: false,
            end_date: data.effective_date,
            updated_at: new Date(),
            updated_by: context.userId
          });
      }
      
      return addHateoasLinks(updatedPlan, this.generatePlanLinks(planId, context)) as BillingPlanResponse;
    });
  }

  // ============================================================================
  // TEMPLATE AND COPYING OPERATIONS
  // ============================================================================

  /**
   * Copy existing billing plan
   */
  async copyPlan(
    data: CopyBillingPlanData,
    context: ServiceContext
  ): Promise<BillingPlanResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get source plan
      const sourcePlan = await this.getExistingPlan(data.source_plan_id, context, trx);
      
      // Create new plan
      const newPlanData = {
        ...sourcePlan,
        plan_id: uuidv4(),
        plan_name: data.new_plan_name,
        is_custom: true,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: context.userId,
        updated_by: context.userId
      };
      
      delete newPlanData.tenant; // Will be set by addCreateAuditFields
      const auditedData = this.addCreateAuditFields(newPlanData, context);
      
      const [newPlan] = await trx('billing_plans').insert(auditedData).returning('*');
      
      // Copy services if requested
      if (data.copy_services) {
        await this.copyPlanServices(data.source_plan_id, newPlan.plan_id, data.modify_rates, context, trx);
      }
      
      // Copy configurations if requested
      if (data.copy_configurations) {
        await this.copyPlanConfigurations(data.source_plan_id, newPlan.plan_id, context, trx);
      }
      
      return addHateoasLinks(newPlan, this.generatePlanLinks(newPlan.plan_id, context)) as BillingPlanResponse;
    });
  }

  /**
   * Create plan template
   */
  async createTemplate(
    data: CreatePlanTemplateData,
    context: ServiceContext
  ): Promise<PlanTemplateResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const templateData = this.addCreateAuditFields({
        template_id: uuidv4(),
        ...data,
        created_by: context.userId
      }, context);
      
      const [template] = await trx('plan_templates').insert(templateData).returning('*');
      
      // Add default services if provided
      if (data.default_services && data.default_services.length > 0) {
        const serviceData = data.default_services.map(service => ({
          template_id: template.template_id,
          service_id: service.service_id,
          configuration_type: service.configuration_type,
          default_rate: service.default_rate,
          quantity: service.quantity || 1,
          tenant: context.tenant,
          created_at: new Date()
        }));
        
        await trx('template_services').insert(serviceData);
      }
      
      return template as PlanTemplateResponse;
    });
  }

  /**
   * Create plan from template
   */
  async createFromTemplate(
    data: CreatePlanFromTemplateData,
    context: ServiceContext
  ): Promise<BillingPlanResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get template
      const template = await trx('plan_templates')
        .where('template_id', data.template_id)
        .where('tenant', context.tenant)
        .first();
      
      if (!template) {
        throw new Error('Template not found');
      }
      
      // Create plan from template
      const planData = this.addCreateAuditFields({
        plan_id: uuidv4(),
        plan_name: data.plan_name,
        plan_type: template.plan_type,
        billing_frequency: template.billing_frequency,
        is_custom: true
      }, context);
      
      const [newPlan] = await trx('billing_plans').insert(planData).returning('*');
      
      // Add template services
      const templateServices = await trx('template_services')
        .where('template_id', data.template_id)
        .where('tenant', context.tenant);
      
      for (const templateService of templateServices) {
        let rate = templateService.default_rate;
        
        // Apply rate modifications if specified
        if (data.modify_rates) {
          if (data.modify_rates.percentage_change) {
            rate = rate * (1 + data.modify_rates.percentage_change / 100);
          }
          if (data.modify_rates.fixed_adjustment) {
            rate = rate + data.modify_rates.fixed_adjustment;
          }
        }
        
        // Check for service overrides
        const override = data.override_services?.find(o => o.service_id === templateService.service_id);
        if (override) {
          rate = override.custom_rate || rate;
        }
        
        // Add service to plan
        await this.addServiceToPlan(newPlan.plan_id, {
          service_id: templateService.service_id,
          configuration_type: templateService.configuration_type,
          custom_rate: rate,
          quantity: override?.quantity || templateService.quantity
        }, context);
      }
      
      return addHateoasLinks(newPlan, this.generatePlanLinks(newPlan.plan_id, context)) as BillingPlanResponse;
    });
  }

  // ============================================================================
  // USAGE TRACKING AND METERING
  // ============================================================================

  /**
   * Get usage metrics for a plan
   */
  async getUsageMetrics(
    planId: string,
    periodStart: Date,
    periodEnd: Date,
    context: ServiceContext
  ): Promise<UsageMetricsResponse> {
    const { knex } = await this.getKnex();
    
    // Get bucket usage data
    const bucketUsage = await knex('bucket_usage')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .whereBetween('period_start', [periodStart, periodEnd])
      .sum('minutes_used as total_usage')
      .sum('overage_minutes as overage_usage')
      .first();
    
    // Get time entries for billable usage
    const timeEntries = await knex('time_entries as te')
      .join('company_billing_plans as cbp', function() {
        this.on('te.company_id', '=', 'cbp.company_id')
            .andOn('te.tenant', '=', 'cbp.tenant');
      })
      .where('cbp.plan_id', planId)
      .where('te.tenant', context.tenant)
      .whereBetween('te.start_time', [periodStart, periodEnd])
      .where('te.is_billable', true)
      .sum('te.duration as billable_minutes')
      .groupBy('te.service_id', 'te.user_id')
      .select('te.service_id', 'te.user_id', knex.raw('SUM(te.duration) as minutes'));
    
    // Calculate usage by service and user
    const usageByService: Record<string, number> = {};
    const usageByUser: Record<string, number> = {};
    
    timeEntries.forEach((entry: any) => {
      usageByService[entry.service_id] = (usageByService[entry.service_id] || 0) + entry.minutes;
      usageByUser[entry.user_id] = (usageByUser[entry.user_id] || 0) + entry.minutes;
    });
    
    // Calculate costs (simplified - would need rate information)
    const baseCost = 0; // Would calculate based on plan rates
    const overageCost = (bucketUsage?.overage_usage || 0) * 1.5; // Example overage rate
    
    return {
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      total_usage: (bucketUsage?.total_usage || 0) + Object.values(usageByService).reduce((a, b) => a + b, 0),
      billable_usage: Object.values(usageByService).reduce((a, b) => a + b, 0),
      overage_usage: bucketUsage?.overage_usage || 0,
      usage_by_service: usageByService,
      usage_by_user: usageByUser,
      cost_breakdown: {
        base_cost: baseCost,
        overage_cost: overageCost,
        total_cost: baseCost + overageCost
      }
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk create billing plans
   */
  async bulkCreate(
    data: BulkCreateBillingPlansData,
    context: ServiceContext
  ): Promise<BillingPlanResponse[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: BillingPlanResponse[] = [];
      
      for (const planData of data.plans) {
        // Validate each plan
        await this.validatePlanCreation(planData, context, trx);
        
        // Create plan
        const auditedData = this.addCreateAuditFields({
          plan_id: uuidv4(),
          ...planData
        }, context);
        
        const [plan] = await trx('billing_plans').insert(auditedData).returning('*');
        results.push(addHateoasLinks(plan, this.generatePlanLinks(plan.plan_id, context)) as BillingPlanResponse);
      }
      
      return results;
    });
  }

  /**
   * Bulk update billing plans
   */
  async bulkUpdate(
    data: BulkUpdateBillingPlansData,
    context: ServiceContext
  ): Promise<BillingPlanResponse[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: BillingPlanResponse[] = [];
      
      for (const update of data.plans) {
        const updatedPlan = await this.update(update.plan_id, update.data, context);
        results.push(updatedPlan);
      }
      
      return results;
    });
  }

  /**
   * Bulk delete billing plans
   */
  async bulkDelete(
    data: BulkDeleteBillingPlansData,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      for (const planId of data.plan_ids) {
        await this.delete(planId, context);
      }
    });
  }

  // ============================================================================
  // ANALYTICS AND REPORTING
  // ============================================================================

  /**
   * Get plan analytics
   */
  async getPlanAnalytics(
    planId: string,
    context: ServiceContext
  ): Promise<PlanAnalyticsResponse> {
    const { knex } = await this.getKnex();
    
    // Get basic plan info
    const plan = await this.getExistingPlan(planId, context);
    
    // Get company assignments
    const companyStats = await knex('company_billing_plans')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .select(
        knex.raw('COUNT(*) as total_companies'),
        knex.raw('COUNT(CASE WHEN is_active = true THEN 1 END) as active_companies')
      )
      .first();
    
    // Get revenue data (simplified)
    const revenueStats = {
      monthly: 0,
      quarterly: 0,
      yearly: 0,
      average_per_company: 0
    };
    
    // Get service usage stats
    const serviceStats = await knex('plan_service_configuration as psc')
      .join('services as s', 'psc.service_id', 's.service_id')
      .where('psc.plan_id', planId)
      .where('psc.tenant', context.tenant)
      .select('s.service_name', 'psc.service_id')
      .count('* as usage_count');
    
    return {
      plan_id: planId,
      plan_name: plan.plan_name,
      plan_type: plan.plan_type,
      total_companies: parseInt(companyStats?.total_companies || '0'),
      active_companies: parseInt(companyStats?.active_companies || '0'),
      revenue: revenueStats,
      usage_stats: {
        total_services: serviceStats.length,
        most_used_services: serviceStats.map((s: any) => ({
          service_id: s.service_id,
          service_name: s.service_name,
          usage_count: parseInt(s.usage_count)
        })),
        average_services_per_company: serviceStats.length / (parseInt(companyStats?.total_companies || '1'))
      },
      growth_metrics: {
        new_companies_this_month: 0,
        churn_rate: 0,
        revenue_growth_rate: 0
      }
    };
  }

  /**
   * Get billing overview analytics
   */
  async getBillingOverviewAnalytics(context: ServiceContext): Promise<BillingOverviewAnalytics> {
    const { knex } = await this.getKnex();
    
    // Get basic counts
    const [planCount, bundleCount, assignmentCount] = await Promise.all([
      knex('billing_plans').where('tenant', context.tenant).count('* as count').first(),
      knex('plan_bundles').where('tenant', context.tenant).count('* as count').first(),
      knex('company_billing_plans').where('tenant', context.tenant).where('is_active', true).count('* as count').first()
    ]);
    
    // Get plans by type
    const plansByType = await knex('billing_plans')
      .where('tenant', context.tenant)
      .groupBy('plan_type')
      .select('plan_type')
      .count('* as count');
    
    const planTypeDistribution: Record<string, number> = {};
    plansByType.forEach((item: any) => {
      planTypeDistribution[item.plan_type] = parseInt(item.count);
    });
    
    // Get billing frequency distribution
    const frequencyDistribution = await knex('billing_plans')
      .where('tenant', context.tenant)
      .groupBy('billing_frequency')
      .select('billing_frequency')
      .count('* as count');
    
    const billingFrequencyDistribution: Record<string, number> = {};
    frequencyDistribution.forEach((item: any) => {
      billingFrequencyDistribution[item.billing_frequency] = parseInt(item.count);
    });
    
    return {
      total_plans: parseInt(planCount?.count || '0'),
      total_bundles: parseInt(bundleCount?.count || '0'),
      total_assignments: parseInt(assignmentCount?.count || '0'),
      plans_by_type: planTypeDistribution,
      revenue_summary: {
        total_monthly_revenue: 0,
        average_revenue_per_plan: 0,
        top_revenue_plans: []
      },
      usage_trends: {
        most_popular_plan_types: Object.entries(planTypeDistribution).map(([type, count]) => ({
          plan_type: type as any,
          count,
          percentage: (count / parseInt(planCount?.count || '1')) * 100
        })),
        billing_frequency_distribution: billingFrequencyDistribution
      }
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private buildBillingPlanQuery(
    knex: Knex, 
    context: ServiceContext, 
    options: BillingPlanServiceOptions
  ): Knex.QueryBuilder {
    let query = knex('billing_plans as bp')
      .where('bp.tenant', context.tenant);
    
    // Add analytics if requested
    if (options.includeAnalytics) {
      query = query
        .leftJoin('company_billing_plans as cbp', function() {
          this.on('bp.plan_id', '=', 'cbp.plan_id')
              .andOn('bp.tenant', '=', 'cbp.tenant')
              .andOn('cbp.is_active', '=', knex.raw('true'));
        })
        .groupBy('bp.plan_id')
        .select(
          'bp.*',
          knex.raw('COUNT(cbp.company_id) as companies_using_plan'),
          knex.raw('AVG(cbp.custom_rate) as average_monthly_revenue')
        );
    } else {
      query = query.select('bp.*');
    }
    
    // Add service count if requested
    if (options.includeServices) {
      query = query
        .leftJoin('plan_service_configuration as psc', function() {
          this.on('bp.plan_id', '=', 'psc.plan_id')
              .andOn('bp.tenant', '=', 'psc.tenant');
        })
        .select(knex.raw('COUNT(DISTINCT psc.service_id) as total_services'));
    }
    
    return query;
  }

  private applyBillingPlanFilters(
    query: Knex.QueryBuilder, 
    filters: BillingPlanFilterData
  ): Knex.QueryBuilder {
    // Apply base filters
    query = this.applyFilters(query, filters);
    
    // Apply specific billing plan filters
    if (filters.has_services !== undefined) {
      if (filters.has_services) {
        query = query.whereExists(function() {
          this.select(1)
              .from('plan_service_configuration as psc')
              .whereRaw('psc.plan_id = bp.plan_id')
              .whereRaw('psc.tenant = bp.tenant');
        });
      } else {
        query = query.whereNotExists(function() {
          this.select(1)
              .from('plan_service_configuration as psc')
              .whereRaw('psc.plan_id = bp.plan_id')
              .whereRaw('psc.tenant = bp.tenant');
        });
      }
    }
    
    if (filters.companies_count_min !== undefined) {
      query = query.havingRaw('COUNT(cbp.company_id) >= ?', [filters.companies_count_min]);
    }
    
    if (filters.companies_count_max !== undefined) {
      query = query.havingRaw('COUNT(cbp.company_id) <= ?', [filters.companies_count_max]);
    }
    
    return query;
  }

  private async validatePlanCreation(
    data: CreateBillingPlanData,
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<void> {
    const knex = trx || await this.getKnex().then(({ knex }) => knex);
    
    // Check for duplicate plan names
    const existingPlan = await knex('billing_plans')
      .where('plan_name', data.plan_name)
      .where('tenant', context.tenant)
      .first();
    
    if (existingPlan) {
      throw new Error('A plan with this name already exists');
    }
    
    // Validate plan type specific requirements
    if (data.plan_type === 'Fixed' && data.base_rate && data.base_rate < 0) {
      throw new Error('Base rate must be non-negative for Fixed plans');
    }
    
    // Add more validation rules as needed
  }

  private async validatePlanUpdate(
    planId: string,
    data: UpdateBillingPlanData,
    existingPlan: IBillingPlan,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Check if plan name conflicts (if changing)
    if (data.plan_name && data.plan_name !== existingPlan.plan_name) {
      const conflictingPlan = await trx('billing_plans')
        .where('plan_name', data.plan_name)
        .where('tenant', context.tenant)
        .whereNot('plan_id', planId)
        .first();
      
      if (conflictingPlan) {
        throw new Error('A plan with this name already exists');
      }
    }
    
    // Validate plan type changes are not allowed if plan is in use
    if (data.plan_type && data.plan_type !== existingPlan.plan_type) {
      const usage = await this.isPlanInUse(planId, context, trx);
      if (usage.inUse) {
        throw new Error('Cannot change plan type when plan is in use');
      }
    }
  }

  private async getExistingPlan(
    planId: string,
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<IBillingPlan> {
    const knex = trx || await this.getKnex().then(({ knex }) => knex);
    
    const plan = await knex('billing_plans')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .first();
    
    if (!plan) {
      throw new Error('Billing plan not found');
    }
    
    return plan;
  }

  private async isPlanInUse(
    planId: string,
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<{ inUse: boolean; reason?: string }> {
    const knex = trx || await this.getKnex().then(({ knex }) => knex);
    
    // Check company assignments
    const companyAssignments = await knex('company_billing_plans')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .where('is_active', true)
      .count('* as count')
      .first();
    
    const companyCount = parseInt(companyAssignments?.count || '0');
    if (companyCount > 0) {
      return {
        inUse: true,
        reason: `Plan is currently assigned to ${companyCount} ${companyCount === 1 ? 'company' : 'companies'}`
      };
    }
    
    // Check if plan is in bundles that are assigned to companies
    const bundleAssignments = await knex('bundle_billing_plans as bbp')
      .join('company_plan_bundles as cpb', 'bbp.bundle_id', 'cpb.bundle_id')
      .where('bbp.plan_id', planId)
      .where('bbp.tenant', context.tenant)
      .where('cpb.is_active', true)
      .count('* as count')
      .first();
    
    const bundleCount = parseInt(bundleAssignments?.count || '0');
    if (bundleCount > 0) {
      return {
        inUse: true,
        reason: `Plan is in bundles assigned to ${bundleCount} ${bundleCount === 1 ? 'company' : 'companies'}`
      };
    }
    
    return { inUse: false };
  }

  private async removeAllServicesFromPlan(
    planId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Get all service configurations for the plan
    const configs = await trx('plan_service_configuration')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .select('config_id');
    
    // Delete each configuration (which should cascade to type-specific configs)
    for (const config of configs) {
      this.planServiceConfigService = new PlanServiceConfigurationService(trx, context.tenant);
      await this.planServiceConfigService.deleteConfiguration(config.config_id);
    }
  }

  private async removePlanFromAllBundles(
    planId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    await trx('bundle_billing_plans')
      .where('plan_id', planId)
      .where('tenant', context.tenant)
      .delete();
  }

  private async createFixedPlanConfig(
    planId: string,
    data: CreateFixedPlanConfigData,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<IBillingPlanFixedConfig> {
    const configData = {
      plan_id: planId,
      ...data,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const [config] = await trx('billing_plan_fixed_config')
      .insert(configData)
      .returning('*');
    
    return config;
  }

  private async validateBundleExists(
    bundleId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const bundle = await trx('plan_bundles')
      .where('bundle_id', bundleId)
      .where('tenant', context.tenant)
      .first();
    
    if (!bundle) {
      throw new Error('Bundle not found');
    }
  }

  private async validateCompanyExists(
    companyId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const company = await trx('companies')
      .where('company_id', companyId)
      .where('tenant', context.tenant)
      .first();
    
    if (!company) {
      throw new Error('Company not found');
    }
  }

  private async validateNoOverlappingAssignments(
    data: CreateCompanyBillingPlanData,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const overlapping = await trx('company_billing_plans')
      .where('company_id', data.company_id)
      .where('plan_id', data.plan_id)
      .where('tenant', context.tenant)
      .where('is_active', true)
      .where(function() {
        this.whereNull('end_date')
            .orWhere('end_date', '>', data.start_date);
      })
      .first();
    
    if (overlapping) {
      throw new Error('Company already has an active assignment for this plan in the specified period');
    }
  }

  private async validateSafeUnassignment(
    companyBillingPlanId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Check for pending invoices
    const pendingInvoices = await trx('invoices')
      .where('company_billing_plan_id', companyBillingPlanId)
      .where('tenant', context.tenant)
      .where('status', 'pending')
      .count('* as count')
      .first();
    
    if (parseInt(pendingInvoices?.count || '0') > 0) {
      throw new Error('Cannot unassign plan: there are pending invoices');
    }
    
    // Check for active usage tracking
    const activeUsage = await trx('bucket_usage')
      .join('company_billing_plans as cbp', function() {
        this.on('bucket_usage.company_id', '=', 'cbp.company_id')
            .andOn('bucket_usage.tenant', '=', 'cbp.tenant');
      })
      .where('cbp.company_billing_plan_id', companyBillingPlanId)
      .where('bucket_usage.period_end', '>', new Date())
      .count('* as count')
      .first();
    
    if (parseInt(activeUsage?.count || '0') > 0) {
      throw new Error('Cannot unassign plan: there is active usage tracking');
    }
  }

  private async getServiceById(
    serviceId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<IService | null> {
    const service = await trx('services')
      .where('service_id', serviceId)
      .where('tenant', context.tenant)
      .first();
    
    return service || null;
  }

  private async copyPlanServices(
    sourcePlanId: string,
    targetPlanId: string,
    modifyRates: CopyBillingPlanData['modify_rates'],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Get source plan services
    const sourceServices = await trx('plan_service_configuration')
      .where('plan_id', sourcePlanId)
      .where('tenant', context.tenant);
    
    // Copy each service with modifications
    for (const sourceService of sourceServices) {
      let customRate = sourceService.custom_rate;
      
      // Apply rate modifications
      if (modifyRates && customRate) {
        if (modifyRates.percentage_change) {
          customRate = customRate * (1 + modifyRates.percentage_change / 100);
        }
        if (modifyRates.fixed_adjustment) {
          customRate = customRate + modifyRates.fixed_adjustment;
        }
      }
      
      // Create new service configuration
      await this.addServiceToPlan(targetPlanId, {
        service_id: sourceService.service_id,
        configuration_type: sourceService.configuration_type,
        custom_rate: customRate,
        quantity: sourceService.quantity
      }, context);
    }
  }

  private async copyPlanConfigurations(
    sourcePlanId: string,
    targetPlanId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Copy fixed plan configuration if exists
    const fixedConfig = await trx('billing_plan_fixed_config')
      .where('plan_id', sourcePlanId)
      .where('tenant', context.tenant)
      .first();
    
    if (fixedConfig) {
      await this.createFixedPlanConfig(targetPlanId, {
        base_rate: fixedConfig.base_rate,
        enable_proration: fixedConfig.enable_proration,
        billing_cycle_alignment: fixedConfig.billing_cycle_alignment
      }, context, trx);
    }
  }

  private generatePlanLinks(planId: string, context: ServiceContext): Record<string, string> {
    const baseUrl = '/api/v1/billing-plans';
    return generateResourceLinks('billing-plans', planId, baseUrl, ['read', 'update', 'delete']);
  }

  private generateBundleLinks(bundleId: string, context: ServiceContext): Record<string, string> {
    const baseUrl = '/api/v1/plan-bundles';
    return generateResourceLinks('plan-bundles', bundleId, baseUrl, ['read', 'update', 'delete']);
  }

  private generateCompanyPlanLinks(companyBillingPlanId: string, context: ServiceContext): Record<string, string> {
    const baseUrl = '/api/v1/company-billing-plans';
    return generateResourceLinks('company-billing-plans', companyBillingPlanId, baseUrl, ['read', 'update', 'delete']);
  }
}