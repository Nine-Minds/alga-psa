/**
 * Billing Plan API Controller V2
 * Handles HTTP requests for billing plan-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
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
import { z } from 'zod';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';
import { requireRequestContext } from '../utils/requestContext';

export class ApiBillingPlanController {
  private billingPlanService: BillingPlanService;

  constructor() {
    this.billingPlanService = new BillingPlanService();
  }

  /**
   * GET /api/v2/billing-plans - List billing plans
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = requireRequestContext(req);
      
      // Validate query parameters
      const validation = billingPlanListQuerySchema.safeParse(query);
      if (!validation.success) {
        return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const { page, limit, sort, order, ...filters } = validation.data;
      
      // Extract service options
      const includeAnalytics = query.include_analytics === 'true';
      const includeServices = query.include_services === 'true';
      const includeUsage = query.include_usage === 'true';
      const includeCompanies = query.include_companies === 'true';

      const serviceOptions: BillingPlanServiceOptions = {
        includeAnalytics,
        includeServices,
        includeUsage,
        includeCompanies
      };

      const listOptions = { 
        page: page ? parseInt(page) : 1, 
        limit: limit ? parseInt(limit) : 25, 
        sort: sort || 'plan_name', 
        order: (order || 'asc') as 'asc' | 'desc',
        filters
      };
      
      const result = await this.billingPlanService.listWithOptions(listOptions, context, serviceOptions);
      
      // Add HATEOAS links to each plan
      const plansWithLinks = result.data.map(plan => ({
        ...plan,
        _links: getHateoasLinks('billing-plan', plan.plan_id!)
      }));

      const response = createApiResponse({
        data: plansWithLinks,
        pagination: {
          page: listOptions.page,
          limit: listOptions.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / listOptions.limit)
        },
        _links: {
          self: { href: `/api/v2/billing-plans` },
          create: { href: `/api/v2/billing-plans`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/billing-plans/{id} - Get billing plan details
   */
  getById() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      const url = new URL(req.url);
      
      // Parse service options from query parameters
      const serviceOptions: BillingPlanServiceOptions = {
        includeAnalytics: url.searchParams.get('include_analytics') === 'true',
        includeServices: url.searchParams.get('include_services') === 'true',
        includeUsage: url.searchParams.get('include_usage') === 'true',
        includeCompanies: url.searchParams.get('include_companies') === 'true'
      };
      
      const plan = await this.billingPlanService.getByIdWithOptions(params.id, requestContext, serviceOptions);
      
      if (!plan) {
        return createErrorResponse('Billing plan not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('billing-plan', plan.plan_id!)
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/billing-plans - Create new billing plan
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createBillingPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plan = await this.billingPlanService.create(validation.data, context);
      
      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('billing-plan', plan.plan_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/billing-plans/{id} - Update billing plan
   */
  update() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = updateBillingPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plan = await this.billingPlanService.update(params.id, validation.data, requestContext);
      
      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('billing-plan', plan.plan_id!)
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/billing-plans/{id} - Delete billing plan
   */
  delete() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.billingPlanService.delete(params.id, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/billing-plans/{id}/services - Get plan services
   */
  getPlanServices() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const services = await this.billingPlanService.getPlanServices(params.id, requestContext);
      
      const response = createApiResponse({
        data: services,
        _links: {
          self: { href: `/api/v2/billing-plans/${params.id}/services` },
          create: { href: `/api/v2/billing-plans/${params.id}/services`, method: 'POST' },
          parent: { href: `/api/v2/billing-plans/${params.id}` }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/billing-plans/{id}/services - Add service to plan
   */
  addServiceToPlan() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = addServiceToPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const serviceConfig = await this.billingPlanService.addServiceToPlan(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: serviceConfig }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/billing-plans/{planId}/services/{serviceId} - Update service in plan
   */
  updatePlanService() {
    return async (req: NextRequest, context: { params: Promise<{ planId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = updatePlanServiceSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const serviceConfig = await this.billingPlanService.updatePlanService(params.planId, params.serviceId, validation.data, requestContext);
      
      const response = createApiResponse({ data: serviceConfig });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/billing-plans/{planId}/services/{serviceId} - Remove service from plan
   */
  removeServiceFromPlan() {
    return async (req: NextRequest, context: { params: Promise<{ planId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.billingPlanService.removeServiceFromPlan(params.planId, params.serviceId, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/billing-plans/{id}/fixed-config - Get fixed plan configuration
   */
  getFixedPlanConfig() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const config = await this.billingPlanService.getFixedPlanConfig(params.id, requestContext);
      
      if (!config) {
        return createErrorResponse('Fixed plan configuration not found', 404);
      }

      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/billing-plans/{id}/fixed-config - Update fixed plan configuration
   */
  upsertFixedPlanConfig() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = createFixedPlanConfigSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const config = await this.billingPlanService.upsertFixedPlanConfig(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/billing-plans/{planId}/services/{serviceId}/config - Get combined configuration
   */
  getCombinedFixedPlanConfig() {
    return async (req: NextRequest, context: { params: Promise<{ planId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const config = await this.billingPlanService.getCombinedFixedPlanConfig(params.planId, params.serviceId, requestContext);
      
      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/billing-plans/{id}/activation - Activate/deactivate plan
   */
  setPlanActivation() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = planActivationSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plan = await this.billingPlanService.setPlanActivation(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: plan });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/billing-plans/{id}/copy - Copy existing plan
   */
  copyPlan() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = copyBillingPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const newPlan = await this.billingPlanService.copyPlan(validation.data, requestContext);
      
      const response = createApiResponse({
        data: {
          ...newPlan,
          _links: getHateoasLinks('billing-plan', newPlan.plan_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/billing-plans/{id}/analytics - Get plan analytics
   */
  getPlanAnalytics() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const analytics = await this.billingPlanService.getPlanAnalytics(params.id, requestContext);
      
      const response = createApiResponse({ data: analytics });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/billing-plans/{id}/usage-metrics - Get usage metrics
   */
  getUsageMetrics() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      const url = new URL(req.url);
      
      const periodStart = new Date(url.searchParams.get('period_start') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      const periodEnd = new Date(url.searchParams.get('period_end') || new Date().toISOString());

      const metrics = await this.billingPlanService.getUsageMetrics(params.id, periodStart, periodEnd, requestContext);
      
      const response = createApiResponse({ data: metrics });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/plan-bundles - List plan bundles
   */
  listBundles() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = requireRequestContext(req);
      
      // Validate query parameters
      const validation = planBundleListQuerySchema.safeParse(query);
      if (!validation.success) {
        return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const { page, limit, sort, order, ...filters } = validation.data;
      const listOptions = { 
        page: page ? parseInt(page) : 1, 
        limit: limit ? parseInt(limit) : 25, 
        sort, 
        order: order as 'asc' | 'desc' | undefined,
        filters
      };
      
      // TODO: Implement listBundles in BillingPlanService
      const result = { data: [], total: 0 };
      
      const response = createApiResponse({
        data: result.data,
        pagination: {
          page: listOptions.page,
          limit: listOptions.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / listOptions.limit)
        },
        _links: {
          self: { href: `/api/v2/plan-bundles` },
          create: { href: `/api/v2/plan-bundles`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/plan-bundles - Create plan bundle
   */
  createBundle() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createPlanBundleSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const bundle = await this.billingPlanService.createBundle(validation.data, context);
      
      const response = createApiResponse({ data: bundle }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/plan-bundles/{bundleId}/plans - Add plan to bundle
   */
  addPlanToBundle() {
    return async (req: NextRequest, context: { params: Promise<{ bundleId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = addPlanToBundleSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const bundlePlan = await this.billingPlanService.addPlanToBundle(
        params.bundleId, 
        validation.data.plan_id, 
        validation.data.custom_rate, 
        requestContext
      );
      
      const response = createApiResponse({ data: bundlePlan }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/plan-bundles/{bundleId}/plans/{planId} - Remove plan from bundle
   */
  removePlanFromBundle() {
    return async (req: NextRequest, context: { params: Promise<{ bundleId: string; planId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.billingPlanService.removePlanFromBundle(params.bundleId, params.planId, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/company-billing-plans - List company billing plan assignments
   */
  listCompanyBillingPlans() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = requireRequestContext(req);
      
      // Validate query parameters
      const validation = companyBillingPlanListQuerySchema.safeParse(query);
      if (!validation.success) {
        return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const { page, limit, sort, order, ...filters } = validation.data;
      const listOptions = { 
        page: page ? parseInt(page) : 1, 
        limit: limit ? parseInt(limit) : 25, 
        sort, 
        order: order as 'asc' | 'desc' | undefined,
        filters
      };
      
      // TODO: Implement listCompanyBillingPlans in BillingPlanService
      const result = { data: [], total: 0 };
      
      const response = createApiResponse({
        data: result.data,
        pagination: {
          page: listOptions.page,
          limit: listOptions.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / listOptions.limit)
        },
        _links: {
          self: { href: `/api/v2/company-billing-plans` },
          create: { href: `/api/v2/company-billing-plans`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/company-billing-plans - Assign plan to company
   */
  assignPlanToCompany() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createCompanyBillingPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const assignment = await this.billingPlanService.assignPlanToCompany(validation.data, context);
      
      const response = createApiResponse({ data: assignment }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/company-billing-plans/{id} - Unassign plan from company
   */
  unassignPlanFromCompany() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.billingPlanService.unassignPlanFromCompany(params.id, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * POST /api/v2/plan-templates - Create plan template
   */
  createTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createPlanTemplateSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const template = await this.billingPlanService.createTemplate(validation.data, context);
      
      const response = createApiResponse({ data: template }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/plan-templates/{id}/create-plan - Create plan from template
   */
  createFromTemplate() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = createPlanFromTemplateSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plan = await this.billingPlanService.createFromTemplate(validation.data, requestContext);
      
      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('billing-plan', plan.plan_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/billing-analytics/overview - Get billing overview analytics
   */
  getBillingOverviewAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const context = requireRequestContext(req);
      
      const analytics = await this.billingPlanService.getBillingOverviewAnalytics(context);
      
      const response = createApiResponse({ data: analytics });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/billing-plans/bulk/create - Bulk create plans
   */
  bulkCreatePlans() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkCreateBillingPlansSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plans = await this.billingPlanService.bulkCreateBillingPlans(validation.data, context);
      
      const response = createApiResponse({ 
        data: plans, 
        count: plans.length 
      }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/billing-plans/bulk/update - Bulk update plans
   */
  bulkUpdatePlans() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkUpdateBillingPlansSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plans = await this.billingPlanService.bulkUpdateBillingPlans(validation.data, context);
      
      const response = createApiResponse({ 
        data: plans, 
        count: plans.length 
      });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/billing-plans/bulk/delete - Bulk delete plans
   */
  bulkDeletePlans() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkDeleteBillingPlansSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      await this.billingPlanService.bulkDeleteBillingPlans(validation.data, context);
      
      const response = createApiResponse({ 
        message: 'Plans deleted successfully', 
        count: validation.data.plan_ids.length 
      });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/billing-plans/bulk/add-services - Bulk add services to plan
   */
  bulkAddServicesToPlan() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkAddServicesToPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const results: { success: boolean; service_id: string; config?: any; error?: string }[] = [];
      for (const serviceData of validation.data.services) {
        try {
          const serviceConfig = await this.billingPlanService.addServiceToPlan(validation.data.plan_id, serviceData, context);
          results.push({ success: true, service_id: serviceData.service_id, config: serviceConfig });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceData.service_id, error: error.message });
        }
      }
      
      const response = createApiResponse({ results, total: results.length });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/billing-plans/bulk/remove-services - Bulk remove services from plan
   */
  bulkRemoveServicesFromPlan() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkRemoveServicesFromPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const results: { success: boolean; service_id: string; error?: string }[] = [];
      for (const serviceId of validation.data.service_ids) {
        try {
          await this.billingPlanService.removeServiceFromPlan(validation.data.plan_id, serviceId, context);
          results.push({ success: true, service_id: serviceId });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceId, error: error.message });
        }
      }
      
      const response = createApiResponse({ results, total: results.length });
      return NextResponse.json(response);
    };
  }
}
