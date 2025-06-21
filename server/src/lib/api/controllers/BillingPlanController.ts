/**
 * Billing Plan Controller
 * Comprehensive controller for billing plans API with full CRUD, service management, 
 * plan activation, templates, analytics, and bulk operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController, ListOptions } from './BaseController';
import { BillingPlanService, BillingPlanServiceOptions } from '../services/BillingPlanService';
import { 
  // Core schemas
  createBillingPlanSchema,
  updateBillingPlanSchema,
  billingPlanListQuerySchema,
  createFixedPlanConfigSchema,
  updateFixedPlanConfigSchema,
  
  // Service management schemas
  addServiceToPlanSchema,
  updatePlanServiceSchema,
  
  // Bundle management schemas
  createPlanBundleSchema,
  updatePlanBundleSchema,
  planBundleListQuerySchema,
  addPlanToBundleSchema,
  updatePlanInBundleSchema,
  
  // Company assignment schemas
  createCompanyBillingPlanSchema,
  updateCompanyBillingPlanSchema,
  companyBillingPlanListQuerySchema,
  createCompanyPlanBundleSchema,
  updateCompanyPlanBundleSchema,
  
  // Template and copying schemas
  copyBillingPlanSchema,
  createPlanTemplateSchema,
  createPlanFromTemplateSchema,
  
  // Activation schemas
  planActivationSchema,
  companyPlanActivationSchema,
  
  // Bulk operation schemas
  bulkCreateBillingPlansSchema,
  bulkUpdateBillingPlansSchema,
  bulkDeleteBillingPlansSchema,
  bulkAddServicesToPlanSchema,
  bulkRemoveServicesFromPlanSchema,
  bulkAssignPlansToCompanySchema,
  bulkUnassignPlansFromCompanySchema,
  
  // Type exports
  CreateBillingPlanData,
  UpdateBillingPlanData,
  BillingPlanResponse,
  CreateFixedPlanConfigData,
  UpdateFixedPlanConfigData,
  AddServiceToPlanData,
  UpdatePlanServiceData,
  CreatePlanBundleData,
  UpdatePlanBundleData,
  AddPlanToBundleData,
  UpdatePlanInBundleData,
  CreateCompanyBillingPlanData,
  UpdateCompanyBillingPlanData,
  CreateCompanyPlanBundleData,
  UpdateCompanyPlanBundleData,
  CopyBillingPlanData,
  CreatePlanTemplateData,
  CreatePlanFromTemplateData,
  PlanActivationData,
  CompanyPlanActivationData,
  BulkCreateBillingPlansData,
  BulkUpdateBillingPlansData,
  BulkDeleteBillingPlansData,
  BulkAddServicesToPlanData,
  BulkRemoveServicesFromPlanData,
  BulkAssignPlansToCompanyData,
  BulkUnassignPlansFromCompanyData
} from '../schemas/billingPlanSchemas';

import { 
  withAuth, 
  withPermission, 
  withValidation, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ValidationError,
  ConflictError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';

export class BillingPlanController extends BaseController {
  private billingPlanService: BillingPlanService;

  constructor() {
    const billingPlanService = new BillingPlanService();
    
    super(billingPlanService, {
      resource: 'billing-plan',
      createSchema: createBillingPlanSchema,
      updateSchema: updateBillingPlanSchema,
      querySchema: billingPlanListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.billingPlanService = billingPlanService;
    this.registerEndpoints();
  }

  /**
   * Register all endpoints with metadata system
   */
  private registerEndpoints(): void {
    // Core CRUD endpoints
    this.registerCrudEndpoints();
    
    // Service management endpoints
    this.registerServiceManagementEndpoints();
    
    // Bundle management endpoints
    this.registerBundleManagementEndpoints();
    
    // Company assignment endpoints
    this.registerCompanyAssignmentEndpoints();
    
    // Plan activation endpoints
    this.registerActivationEndpoints();
    
    // Template and copying endpoints
    this.registerTemplateEndpoints();
    
    // Analytics endpoints
    this.registerAnalyticsEndpoints();
    
    // Bulk operations endpoints
    this.registerBulkOperationEndpoints();
    
    // Usage tracking endpoints
    this.registerUsageTrackingEndpoints();
  }

  private registerCrudEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans',
      method: 'GET',
      resource: 'billing-plan',
      action: 'list',
      description: 'List billing plans with advanced filtering and analytics',
      permissions: { resource: 'billing-plan', action: 'read' },
      querySchema: billingPlanListQuerySchema,
      tags: ['billing-plans', 'core']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans',
      method: 'POST',
      resource: 'billing-plan',
      action: 'create',
      description: 'Create a new billing plan',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: createBillingPlanSchema,
      tags: ['billing-plans', 'core']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}',
      method: 'GET',
      resource: 'billing-plan',
      action: 'read',
      description: 'Get billing plan details with related data',
      permissions: { resource: 'billing-plan', action: 'read' },
      tags: ['billing-plans', 'core']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}',
      method: 'PUT',
      resource: 'billing-plan',
      action: 'update',
      description: 'Update billing plan information',
      permissions: { resource: 'billing-plan', action: 'update' },
      requestSchema: updateBillingPlanSchema,
      tags: ['billing-plans', 'core']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}',
      method: 'DELETE',
      resource: 'billing-plan',
      action: 'delete',
      description: 'Delete a billing plan',
      permissions: { resource: 'billing-plan', action: 'delete' },
      tags: ['billing-plans', 'core']
    });
  }

  private registerServiceManagementEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}/services',
      method: 'GET',
      resource: 'billing-plan',
      action: 'read',
      description: 'Get all services in a billing plan',
      permissions: { resource: 'billing-plan', action: 'read' },
      tags: ['billing-plans', 'services']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}/services',
      method: 'POST',
      resource: 'billing-plan',
      action: 'update',
      description: 'Add service to billing plan',
      permissions: { resource: 'billing-plan', action: 'update' },
      requestSchema: addServiceToPlanSchema,
      tags: ['billing-plans', 'services']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{planId}/services/{serviceId}',
      method: 'PUT',
      resource: 'billing-plan',
      action: 'update',
      description: 'Update service configuration in billing plan',
      permissions: { resource: 'billing-plan', action: 'update' },
      requestSchema: updatePlanServiceSchema,
      tags: ['billing-plans', 'services']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{planId}/services/{serviceId}',
      method: 'DELETE',
      resource: 'billing-plan',
      action: 'update',
      description: 'Remove service from billing plan',
      permissions: { resource: 'billing-plan', action: 'update' },
      tags: ['billing-plans', 'services']
    });
  }

  private registerBundleManagementEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/plan-bundles',
      method: 'GET',
      resource: 'plan-bundle',
      action: 'read',
      description: 'List plan bundles',
      permissions: { resource: 'billing-plan', action: 'read' },
      querySchema: planBundleListQuerySchema,
      tags: ['bundles']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/plan-bundles',
      method: 'POST',
      resource: 'plan-bundle',
      action: 'create',
      description: 'Create a new plan bundle',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: createPlanBundleSchema,
      tags: ['bundles']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/plan-bundles/{bundleId}/plans',
      method: 'POST',
      resource: 'plan-bundle',
      action: 'update',
      description: 'Add plan to bundle',
      permissions: { resource: 'billing-plan', action: 'update' },
      requestSchema: addPlanToBundleSchema,
      tags: ['bundles']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/plan-bundles/{bundleId}/plans/{planId}',
      method: 'DELETE',
      resource: 'plan-bundle',
      action: 'update',
      description: 'Remove plan from bundle',
      permissions: { resource: 'billing-plan', action: 'update' },
      tags: ['bundles']
    });
  }

  private registerCompanyAssignmentEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/company-billing-plans',
      method: 'GET',
      resource: 'company-billing-plan',
      action: 'read',
      description: 'List company billing plan assignments',
      permissions: { resource: 'billing-plan', action: 'read' },
      querySchema: companyBillingPlanListQuerySchema,
      tags: ['assignments']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/company-billing-plans',
      method: 'POST',
      resource: 'company-billing-plan',
      action: 'create',
      description: 'Assign billing plan to company',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: createCompanyBillingPlanSchema,
      tags: ['assignments']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/company-billing-plans/{id}',
      method: 'DELETE',
      resource: 'company-billing-plan',
      action: 'delete',
      description: 'Unassign billing plan from company',
      permissions: { resource: 'billing-plan', action: 'delete' },
      tags: ['assignments']
    });
  }

  private registerActivationEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}/activation',
      method: 'PUT',
      resource: 'billing-plan',
      action: 'update',
      description: 'Activate or deactivate billing plan',
      permissions: { resource: 'billing-plan', action: 'update' },
      requestSchema: planActivationSchema,
      tags: ['billing-plans', 'activation']
    });
  }

  private registerTemplateEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}/copy',
      method: 'POST',
      resource: 'billing-plan',
      action: 'create',
      description: 'Copy existing billing plan',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: copyBillingPlanSchema,
      tags: ['billing-plans', 'templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/plan-templates',
      method: 'POST',
      resource: 'plan-template',
      action: 'create',
      description: 'Create plan template',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: createPlanTemplateSchema,
      tags: ['templates']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/plan-templates/{id}/create-plan',
      method: 'POST',
      resource: 'billing-plan',
      action: 'create',
      description: 'Create plan from template',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: createPlanFromTemplateSchema,
      tags: ['templates']
    });
  }

  private registerAnalyticsEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}/analytics',
      method: 'GET',
      resource: 'billing-plan',
      action: 'read',
      description: 'Get billing plan analytics',
      permissions: { resource: 'billing-plan', action: 'read' },
      tags: ['billing-plans', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-analytics/overview',
      method: 'GET',
      resource: 'billing-plan',
      action: 'read',
      description: 'Get billing overview analytics',
      permissions: { resource: 'billing-plan', action: 'read' },
      tags: ['analytics']
    });
  }

  private registerBulkOperationEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/bulk/create',
      method: 'POST',
      resource: 'billing-plan',
      action: 'create',
      description: 'Bulk create billing plans',
      permissions: { resource: 'billing-plan', action: 'create' },
      requestSchema: bulkCreateBillingPlansSchema,
      tags: ['billing-plans', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/bulk/update',
      method: 'PUT',
      resource: 'billing-plan',
      action: 'update',
      description: 'Bulk update billing plans',
      permissions: { resource: 'billing-plan', action: 'update' },
      requestSchema: bulkUpdateBillingPlansSchema,
      tags: ['billing-plans', 'bulk']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/bulk/delete',
      method: 'DELETE',
      resource: 'billing-plan',
      action: 'delete',
      description: 'Bulk delete billing plans',
      permissions: { resource: 'billing-plan', action: 'delete' },
      requestSchema: bulkDeleteBillingPlansSchema,
      tags: ['billing-plans', 'bulk']
    });
  }

  private registerUsageTrackingEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/billing-plans/{id}/usage-metrics',
      method: 'GET',
      resource: 'billing-plan',
      action: 'read',
      description: 'Get usage metrics for billing plan',
      permissions: { resource: 'billing-plan', action: 'read' },
      tags: ['billing-plans', 'usage']
    });
  }

  // ============================================================================
  // ENHANCED CRUD OPERATIONS
  // ============================================================================

  /**
   * GET /api/v1/billing-plans - Enhanced list with analytics options
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      withQueryValidation(billingPlanListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'plan_name';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

      // Extract service options
      const includeAnalytics = url.searchParams.get('include_analytics') === 'true';
      const includeServices = url.searchParams.get('include_services') === 'true';
      const includeUsage = url.searchParams.get('include_usage') === 'true';
      const includeCompanies = url.searchParams.get('include_companies') === 'true';

      const serviceOptions: BillingPlanServiceOptions = {
        includeAnalytics,
        includeServices,
        includeUsage,
        includeCompanies
      };

      const filters = { ...validatedQuery };
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions: ListOptions = { page, limit, filters, sort, order };
      const result = await this.billingPlanService.list(listOptions, req.context!, serviceOptions);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters,
          resource: 'billing-plan',
          serviceOptions
        }
      );
    });
  }

  /**
   * GET /api/v1/billing-plans/{id} - Enhanced get with related data
   */
  getById() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.read || 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const url = new URL(req.url);
      
      // Parse service options from query parameters
      const serviceOptions: BillingPlanServiceOptions = {
        includeAnalytics: url.searchParams.get('include_analytics') === 'true',
        includeServices: url.searchParams.get('include_services') === 'true',
        includeUsage: url.searchParams.get('include_usage') === 'true',
        includeCompanies: url.searchParams.get('include_companies') === 'true'
      };

      const plan = await this.billingPlanService.getById(id, req.context!, serviceOptions);
      
      if (!plan) {
        throw new NotFoundError('Billing plan not found');
      }

      return createSuccessResponse(plan);
    });
  }

  /**
   * POST /api/v1/billing-plans - Enhanced create with validation
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(createBillingPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateBillingPlanData) => {
      try {
        const plan = await this.billingPlanService.create(validatedData, req.context!);
        return createSuccessResponse(plan, 201);
      } catch (error: any) {
        if (error.message.includes('already exists')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * PUT /api/v1/billing-plans/{id} - Enhanced update with validation
   */
  update() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(updateBillingPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateBillingPlanData) => {
      const id = this.extractIdFromPath(req);
      
      try {
        const plan = await this.billingPlanService.update(id, validatedData, req.context!);
        return createSuccessResponse(plan);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError('Billing plan not found');
        }
        if (error.message.includes('already exists')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/billing-plans/{id} - Enhanced delete with cascade validation
   */
  delete() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.delete || 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      
      try {
        await this.billingPlanService.delete(id, req.context!);
        return new NextResponse(null, { status: 204 });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError('Billing plan not found');
        }
        if (error.message.includes('Cannot delete plan')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  // ============================================================================
  // PLAN CONFIGURATION MANAGEMENT
  // ============================================================================

  /**
   * GET /api/v1/billing-plans/{id}/fixed-config - Get fixed plan configuration
   */
  getFixedPlanConfig() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const planId = this.extractIdFromPath(req);
      const config = await this.billingPlanService.getFixedPlanConfig(planId, req.context!);
      
      if (!config) {
        throw new NotFoundError('Fixed plan configuration not found');
      }

      return createSuccessResponse(config);
    });
  }

  /**
   * PUT /api/v1/billing-plans/{id}/fixed-config - Create or update fixed plan configuration
   */
  upsertFixedPlanConfig() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(createFixedPlanConfigSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateFixedPlanConfigData) => {
      const planId = this.extractIdFromPath(req);
      
      try {
        const config = await this.billingPlanService.upsertFixedPlanConfig(planId, validatedData, req.context!);
        return createSuccessResponse(config);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError('Billing plan not found');
        }
        if (error.message.includes('Fixed type')) {
          throw new ValidationError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/billing-plans/{planId}/services/{serviceId}/config - Get combined configuration
   */
  getCombinedFixedPlanConfig() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const planId = pathParts[4]; // /api/v1/billing-plans/{planId}/services/{serviceId}/config
      const serviceId = pathParts[6];

      const config = await this.billingPlanService.getCombinedFixedPlanConfig(planId, serviceId, req.context!);
      return createSuccessResponse(config);
    });
  }

  // ============================================================================
  // SERVICE MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/billing-plans/{id}/services - Get all services in a billing plan
   */
  getPlanServices() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const planId = this.extractIdFromPath(req);
      const services = await this.billingPlanService.getPlanServices(planId, req.context!);
      return createSuccessResponse(services);
    });
  }

  /**
   * POST /api/v1/billing-plans/{id}/services - Add service to billing plan
   */
  addServiceToPlan() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(addServiceToPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: AddServiceToPlanData) => {
      const planId = this.extractIdFromPath(req);
      
      try {
        const serviceConfig = await this.billingPlanService.addServiceToPlan(planId, validatedData, req.context!);
        return createSuccessResponse(serviceConfig, 201);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        if (error.message.includes('already exists')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * PUT /api/v1/billing-plans/{planId}/services/{serviceId} - Update service configuration
   */
  updatePlanService() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(updatePlanServiceSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdatePlanServiceData) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const planId = pathParts[4]; // /api/v1/billing-plans/{planId}/services/{serviceId}
      const serviceId = pathParts[6];

      try {
        const serviceConfig = await this.billingPlanService.updatePlanService(planId, serviceId, validatedData, req.context!);
        return createSuccessResponse(serviceConfig);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/billing-plans/{planId}/services/{serviceId} - Remove service from plan
   */
  removeServiceFromPlan() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const planId = pathParts[4];
      const serviceId = pathParts[6];

      try {
        await this.billingPlanService.removeServiceFromPlan(planId, serviceId, req.context!);
        return new NextResponse(null, { status: 204 });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    });
  }

  // ============================================================================
  // BUNDLE MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/plan-bundles - Create plan bundle
   */
  createBundle() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'create'),
      withValidation(createPlanBundleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreatePlanBundleData) => {
      const bundle = await this.billingPlanService.createBundle(validatedData, req.context!);
      return createSuccessResponse(bundle, 201);
    });
  }

  /**
   * POST /api/v1/plan-bundles/{bundleId}/plans - Add plan to bundle
   */
  addPlanToBundle() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(addPlanToBundleSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: AddPlanToBundleData) => {
      const bundleId = this.extractIdFromPath(req);
      
      try {
        const bundlePlan = await this.billingPlanService.addPlanToBundle(
          bundleId, 
          validatedData.plan_id, 
          validatedData.custom_rate, 
          req.context!
        );
        return createSuccessResponse(bundlePlan, 201);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        if (error.message.includes('already exists')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/plan-bundles/{bundleId}/plans/{planId} - Remove plan from bundle
   */
  removePlanFromBundle() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const bundleId = pathParts[4]; // /api/v1/plan-bundles/{bundleId}/plans/{planId}
      const planId = pathParts[6];

      try {
        await this.billingPlanService.removePlanFromBundle(bundleId, planId, req.context!);
        return new NextResponse(null, { status: 204 });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        if (error.message.includes('Cannot remove')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  // ============================================================================
  // COMPANY ASSIGNMENT ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/company-billing-plans - Assign plan to company
   */
  assignPlanToCompany() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'create'),
      withValidation(createCompanyBillingPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateCompanyBillingPlanData) => {
      try {
        const assignment = await this.billingPlanService.assignPlanToCompany(validatedData, req.context!);
        return createSuccessResponse(assignment, 201);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        if (error.message.includes('inactive plan') || error.message.includes('overlapping')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/company-billing-plans/{id} - Unassign plan from company
   */
  unassignPlanFromCompany() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const companyBillingPlanId = this.extractIdFromPath(req);
      
      try {
        await this.billingPlanService.unassignPlanFromCompany(companyBillingPlanId, req.context!);
        return new NextResponse(null, { status: 204 });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError(error.message);
        }
        if (error.message.includes('pending invoices') || error.message.includes('active usage')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  // ============================================================================
  // PLAN ACTIVATION ENDPOINTS
  // ============================================================================

  /**
   * PUT /api/v1/billing-plans/{id}/activation - Activate/deactivate plan
   */
  setPlanActivation() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(planActivationSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: PlanActivationData) => {
      const planId = this.extractIdFromPath(req);
      
      try {
        const plan = await this.billingPlanService.setPlanActivation(planId, validatedData, req.context!);
        return createSuccessResponse(plan);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError('Billing plan not found');
        }
        if (error.message.includes('Cannot deactivate')) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }

  // ============================================================================
  // TEMPLATE AND COPYING ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/billing-plans/{id}/copy - Copy existing plan
   */
  copyPlan() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'create'),
      withValidation(copyBillingPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CopyBillingPlanData) => {
      try {
        const newPlan = await this.billingPlanService.copyPlan(validatedData, req.context!);
        return createSuccessResponse(newPlan, 201);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError('Source billing plan not found');
        }
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/plan-templates - Create plan template
   */
  createTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'create'),
      withValidation(createPlanTemplateSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreatePlanTemplateData) => {
      const template = await this.billingPlanService.createTemplate(validatedData, req.context!);
      return createSuccessResponse(template, 201);
    });
  }

  /**
   * POST /api/v1/plan-templates/{id}/create-plan - Create plan from template
   */
  createFromTemplate() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'create'),
      withValidation(createPlanFromTemplateSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreatePlanFromTemplateData) => {
      try {
        const plan = await this.billingPlanService.createFromTemplate(validatedData, req.context!);
        return createSuccessResponse(plan, 201);
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new NotFoundError('Template not found');
        }
        throw error;
      }
    });
  }

  // ============================================================================
  // ANALYTICS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/billing-plans/{id}/analytics - Get plan analytics
   */
  getPlanAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const planId = this.extractIdFromPath(req);
      const analytics = await this.billingPlanService.getPlanAnalytics(planId, req.context!);
      return createSuccessResponse(analytics);
    });
  }

  /**
   * GET /api/v1/billing-analytics/overview - Get billing overview analytics
   */
  getBillingOverviewAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const analytics = await this.billingPlanService.getBillingOverviewAnalytics(req.context!);
      return createSuccessResponse(analytics);
    });
  }

  // ============================================================================
  // USAGE TRACKING ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/billing-plans/{id}/usage-metrics - Get usage metrics
   */
  getUsageMetrics() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const planId = this.extractIdFromPath(req);
      const url = new URL(req.url);
      
      const periodStart = new Date(url.searchParams.get('period_start') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      const periodEnd = new Date(url.searchParams.get('period_end') || new Date().toISOString());

      const metrics = await this.billingPlanService.getUsageMetrics(planId, periodStart, periodEnd, req.context!);
      return createSuccessResponse(metrics);
    });
  }

  // ============================================================================
  // BULK OPERATIONS ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/billing-plans/bulk/create - Bulk create plans
   */
  bulkCreatePlans() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'create'),
      withValidation(bulkCreateBillingPlansSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkCreateBillingPlansData) => {
      const plans = await this.billingPlanService.bulkCreate(validatedData, req.context!);
      return createSuccessResponse({ plans, count: plans.length }, 201);
    });
  }

  /**
   * PUT /api/v1/billing-plans/bulk/update - Bulk update plans
   */
  bulkUpdatePlans() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(bulkUpdateBillingPlansSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkUpdateBillingPlansData) => {
      const plans = await this.billingPlanService.bulkUpdate(validatedData, req.context!);
      return createSuccessResponse({ plans, count: plans.length });
    });
  }

  /**
   * DELETE /api/v1/billing-plans/bulk/delete - Bulk delete plans
   */
  bulkDeletePlans() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'delete'),
      withValidation(bulkDeleteBillingPlansSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkDeleteBillingPlansData) => {
      await this.billingPlanService.bulkDelete(validatedData, req.context!);
      return createSuccessResponse({ message: 'Plans deleted successfully', count: validatedData.plan_ids.length });
    });
  }

  /**
   * POST /api/v1/billing-plans/bulk/add-services - Bulk add services to plan
   */
  bulkAddServicesToPlan() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(bulkAddServicesToPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkAddServicesToPlanData) => {
      const results = [];
      for (const serviceData of validatedData.services) {
        try {
          const serviceConfig = await this.billingPlanService.addServiceToPlan(validatedData.plan_id, serviceData, req.context!);
          results.push({ success: true, service_id: serviceData.service_id, config: serviceConfig });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceData.service_id, error: error.message });
        }
      }
      
      return createSuccessResponse({ results, total: results.length });
    });
  }

  /**
   * DELETE /api/v1/billing-plans/bulk/remove-services - Bulk remove services from plan
   */
  bulkRemoveServicesFromPlan() {
    const middleware = compose(
      withAuth,
      withPermission('billing-plan', 'update'),
      withValidation(bulkRemoveServicesFromPlanSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkRemoveServicesFromPlanData) => {
      const results = [];
      for (const serviceId of validatedData.service_ids) {
        try {
          await this.billingPlanService.removeServiceFromPlan(validatedData.plan_id, serviceId, req.context!);
          results.push({ success: true, service_id: serviceId });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceId, error: error.message });
        }
      }
      
      return createSuccessResponse({ results, total: results.length });
    });
  }
}