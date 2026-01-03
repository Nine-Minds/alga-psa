/**
 * Contract Lines API Schemas
 * Comprehensive validation schemas for contract line-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema,
  numberTransform,
  bulkDeleteSchema,
  bulkUpdateSchema
} from './common';

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

export const planTypeSchema = z.enum(['Fixed', 'Hourly', 'Usage']);
export const billingFrequencySchema = z.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']);
export const configurationTypeSchema = z.enum(['Fixed', 'Hourly', 'Usage', 'Bucket']);
export const billingCycleAlignmentSchema = z.enum(['start', 'end', 'prorated']);
export const billingMethodSchema = z.enum(['fixed', 'hourly', 'usage', 'per_unit']);

// ============================================================================
// CORE CONTRACT LINE SCHEMAS
// ============================================================================

// Base contract line schema (without refinements)
const baseContractLineSchema = z.object({
  contract_line_name: z.string().min(1, 'Plan name is required').max(255),
  billing_frequency: billingFrequencySchema,
  is_custom: z.boolean().optional().default(false),
  service_category: z.string().optional(),
  contract_line_type: planTypeSchema,
  
  // Hourly plan specific fields (deprecated for Hourly type)
  hourly_rate: z.number().min(0).optional(),
  minimum_billable_time: z.number().min(0).optional(),
  round_up_to_nearest: z.number().min(1).optional(),
  
  // Plan-wide overtime and after-hours settings
  enable_overtime: z.boolean().optional(),
  overtime_rate: z.number().min(0).optional(),
  overtime_threshold: z.number().min(0).optional(),
  enable_after_hours_rate: z.boolean().optional(),
  after_hours_multiplier: z.number().min(0).optional(),
  
  // Additional features and settings
  is_active: z.boolean().optional().default(true),
  features: z.array(z.string()).optional()
});

// Create contract line schema
export const createContractLineSchema = baseContractLineSchema.refine(data => {
  // Validation: If overtime is enabled, rate and threshold must be provided
  if (data.enable_overtime && (!data.overtime_rate || !data.overtime_threshold)) {
    return false;
  }
  // Validation: If after hours is enabled, multiplier must be provided
  if (data.enable_after_hours_rate && !data.after_hours_multiplier) {
    return false;
  }
  return true;
}, {
  message: "When overtime or after-hours features are enabled, all related fields must be provided"
});

// Update contract line schema
export const updateContractLineSchema = createUpdateSchema(baseContractLineSchema);

// Contract Line response schema
export const contractLineResponseSchema = z.object({
  contract_line_id: uuidSchema,
  contract_line_name: z.string(),
  billing_frequency: billingFrequencySchema,
  is_custom: z.boolean(),
  service_category: z.string().nullable(),
  contract_line_type: planTypeSchema,
  hourly_rate: z.number().nullable(),
  minimum_billable_time: z.number().nullable(),
  round_up_to_nearest: z.number().nullable(),
  enable_overtime: z.boolean().nullable(),
  overtime_rate: z.number().nullable(),
  overtime_threshold: z.number().nullable(),
  enable_after_hours_rate: z.boolean().nullable(),
  after_hours_multiplier: z.number().nullable(),
  is_active: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Additional computed fields
  total_services: z.number().optional()
});

// ============================================================================
// CONTRACT LINE CONFIGURATION SCHEMAS
// ============================================================================

// Fixed plan configuration
export const createFixedPlanConfigSchema = z.object({
  base_rate: z.number().min(0).optional(),
  enable_proration: z.boolean().default(false),
  billing_cycle_alignment: billingCycleAlignmentSchema.default('start')
});

export const updateFixedPlanConfigSchema = createUpdateSchema(createFixedPlanConfigSchema);

export const fixedPlanConfigResponseSchema = z.object({
  contract_line_id: uuidSchema,
  base_rate: z.number().nullable(),
  enable_proration: z.boolean(),
  billing_cycle_alignment: billingCycleAlignmentSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

// Combined fixed plan configuration (plan-level + service-level)
export const combinedFixedPlanConfigResponseSchema = z.object({
  base_rate: z.number().nullable(),
  enable_proration: z.boolean(),
  billing_cycle_alignment: billingCycleAlignmentSchema,
  config_id: uuidSchema.optional()
});

// ============================================================================
// SERVICE CONFIGURATION SCHEMAS
// ============================================================================

// Base service configuration
export const planServiceConfigurationSchema = z.object({
  config_id: uuidSchema,
  contract_line_id: uuidSchema,
  service_id: uuidSchema,
  configuration_type: configurationTypeSchema,
  custom_rate: z.number().min(0).optional(),
  quantity: z.number().min(1).optional(),
  instance_name: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

// Fixed service configuration
export const planServiceFixedConfigSchema = z.object({
  config_id: uuidSchema,
  base_rate: z.number().min(0).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

export const createPlanServiceFixedConfigSchema = z.object({
  base_rate: z.number().min(0).optional()
});

// Hourly service configuration
export const planServiceHourlyConfigSchema = z.object({
  config_id: uuidSchema,
  hourly_rate: z.number().min(0),
  minimum_billable_time: z.number().min(0),
  round_up_to_nearest: z.number().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

export const createPlanServiceHourlyConfigSchema = z.object({
  hourly_rate: z.number().min(0),
  minimum_billable_time: z.number().min(0).default(0),
  round_up_to_nearest: z.number().min(1).default(15)
});

// Usage service configuration
export const planServiceUsageConfigSchema = z.object({
  config_id: uuidSchema,
  unit_of_measure: z.string().min(1),
  enable_tiered_pricing: z.boolean(),
  minimum_usage: z.number().min(0).optional(),
  base_rate: z.number().min(0).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

export const createPlanServiceUsageConfigSchema = z.object({
  unit_of_measure: z.string().min(1),
  enable_tiered_pricing: z.boolean().default(false),
  minimum_usage: z.number().min(0).optional(),
  base_rate: z.number().min(0).optional()
});

// Bucket service configuration
export const planServiceBucketConfigSchema = z.object({
  config_id: uuidSchema,
  total_minutes: z.number().min(1),
  billing_period: z.string().min(1),
  overage_rate: z.number().min(0),
  allow_rollover: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

export const createPlanServiceBucketConfigSchema = z.object({
  total_minutes: z.number().min(1),
  billing_period: billingFrequencySchema.default('monthly'),
  overage_rate: z.number().min(0),
  allow_rollover: z.boolean().default(false)
});

// Rate tier schema for tiered pricing
export const rateTierSchema = z.object({
  tier_id: uuidSchema,
  config_id: uuidSchema,
  min_quantity: z.number().min(0),
  max_quantity: z.number().min(0).optional(),
  rate: z.number().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

export const createRateTierSchema = z.object({
  min_quantity: z.number().min(0),
  max_quantity: z.number().min(0).optional(),
  rate: z.number().min(0)
}).refine(data => {
  if (data.max_quantity && data.max_quantity <= data.min_quantity) {
    return false;
  }
  return true;
}, {
  message: "Max quantity must be greater than min quantity"
});

// User type rate schema
export const userTypeRateSchema = z.object({
  rate_id: uuidSchema,
  config_id: uuidSchema,
  user_type: z.string().min(1),
  rate: z.number().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

export const createUserTypeRateSchema = z.object({
  user_type: z.string().min(1),
  rate: z.number().min(0)
});

// ============================================================================
// SERVICE MANAGEMENT SCHEMAS
// ============================================================================

// Add service to plan
export const addServiceToPlanSchema = z.object({
  service_id: uuidSchema,
  quantity: z.number().min(1).optional().default(1),
  custom_rate: z.number().min(0).optional(),
  configuration_type: configurationTypeSchema.optional(),
  type_config: z.union([
    createPlanServiceFixedConfigSchema,
    createPlanServiceHourlyConfigSchema,
    createPlanServiceUsageConfigSchema,
    createPlanServiceBucketConfigSchema
  ]).optional()
});

// Update service in plan
export const updatePlanServiceSchema = z.object({
  quantity: z.number().min(1).optional(),
  custom_rate: z.number().min(0).optional(),
  type_config: z.union([
    createPlanServiceFixedConfigSchema.partial(),
    createPlanServiceHourlyConfigSchema.partial(),
    createPlanServiceUsageConfigSchema.partial(),
    createPlanServiceBucketConfigSchema.partial()
  ]).optional(),
  rate_tiers: z.array(createRateTierSchema).optional(),
  user_type_rates: z.array(createUserTypeRateSchema).optional()
});

// Service with configuration response
export const planServiceWithConfigResponseSchema = z.object({
  service: z.object({
    service_id: uuidSchema,
    service_name: z.string(),
    default_rate: z.number(),
    unit_of_measure: z.string(),
    billing_method: billingMethodSchema,
    service_type_name: z.string().optional(),
    item_kind: z.enum(['service', 'product']).optional(),
    is_license: z.boolean().optional()
  }),
  configuration: planServiceConfigurationSchema,
  type_config: z.union([
    planServiceFixedConfigSchema,
    planServiceHourlyConfigSchema,
    planServiceUsageConfigSchema,
    planServiceBucketConfigSchema
  ]).nullable(),
  rate_tiers: z.array(rateTierSchema).optional(),
  user_type_rates: z.array(userTypeRateSchema).optional()
});

// ============================================================================
// CONTRACT MANAGEMENT SCHEMAS
// ============================================================================

// Contract
export const createContractSchema = z.object({
  contract_name: z.string().min(1, 'Contract name is required').max(255),
  contract_description: z.string().optional(),
  billing_frequency: billingFrequencySchema,
  is_active: z.boolean().optional().default(true)
});

export const updateContractSchema = createUpdateSchema(createContractSchema);

export const contractResponseSchema = z.object({
  contract_id: uuidSchema,
  contract_name: z.string(),
  contract_description: z.string().nullable(),
  billing_frequency: billingFrequencySchema,
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed fields
  total_plans: z.number().optional(),
  clients_using_contract: z.number().optional()
});

// Contract line mapping response
export const contractLineMappingResponseSchema = z.object({
  contract_id: uuidSchema,
  contract_line_id: uuidSchema,
  display_order: z.number().optional(),
  custom_rate: z.number().optional(),
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Plan details
  contract_line_name: z.string().optional(),
  billing_frequency: billingFrequencySchema.optional(),
  is_custom: z.boolean().optional(),
  contract_line_type: planTypeSchema.optional()
});

// Associate contract line to contract
export const addContractLineSchema = z.object({
  contract_line_id: uuidSchema,
  custom_rate: z.number().min(0).optional(),
  display_order: z.number().min(0).optional()
});

// Update contract line relationship
export const updateContractAssociationSchema = z.object({
  custom_rate: z.number().min(0).optional(),
  display_order: z.number().min(0).optional()
});

// ============================================================================
// COMPANY CONTRACT LINE ASSIGNMENT SCHEMAS
// ============================================================================

// Client contract line assignment
export const createClientContractLineSchema = z.object({
  client_id: uuidSchema,
  contract_line_id: uuidSchema,
  service_category: z.string().optional(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().optional(),
  is_active: z.boolean().optional().default(true),
  custom_rate: z.number().min(0).optional(),
  client_contract_id: uuidSchema.optional()
});

export const updateClientContractLineSchema = createUpdateSchema(createClientContractLineSchema);

export const clientContractLineResponseSchema = z.object({
  client_contract_line_id: uuidSchema,
  client_id: uuidSchema,
  contract_line_id: uuidSchema,
  template_contract_line_id: uuidSchema.optional(),
  service_category: z.string().nullable(),
  service_category_name: z.string().nullable(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().nullable(),
  is_active: z.boolean(),
  custom_rate: z.number().nullable(),
  client_contract_id: uuidSchema.nullable(),
  template_contract_id: uuidSchema.optional().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Joined data
  contract_line_name: z.string().optional(),
  billing_frequency: billingFrequencySchema.optional(),
  contract_name: z.string().optional(),
  client_name: z.string().optional()
});

// Client plan contract assignment
export const createClientContractSchema = z.object({
  client_id: uuidSchema,
  contract_id: uuidSchema,
  start_date: z.string().datetime(),
  end_date: z.string().datetime().optional(),
  is_active: z.boolean().optional().default(true)
});

export const updateClientContractSchema = createUpdateSchema(createClientContractSchema);

export const clientContractResponseSchema = z.object({
  client_contract_id: uuidSchema,
  client_id: uuidSchema,
  contract_id: uuidSchema,
  start_date: z.string().datetime(),
  end_date: z.string().datetime().nullable(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Joined data
  contract_name: z.string().optional(),
  client_name: z.string().optional(),
  total_plans: z.number().optional()
});

// ============================================================================
// USAGE TRACKING AND METERING SCHEMAS
// ============================================================================

// Bucket usage tracking
export const bucketUsageResponseSchema = z.object({
  usage_id: uuidSchema,
  contract_line_id: uuidSchema.optional(),
  client_id: uuidSchema,
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  minutes_used: z.number(),
  overage_minutes: z.number(),
  service_catalog_id: uuidSchema,
  rolled_over_minutes: z.number(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed fields
  total_minutes_available: z.number().optional(),
  usage_percentage: z.number().optional(),
  overage_cost: z.number().optional()
});

// Usage metrics
export const usageMetricsResponseSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  total_usage: z.number(),
  billable_usage: z.number(),
  overage_usage: z.number(),
  usage_by_service: z.record(z.number()),
  usage_by_user: z.record(z.number()),
  cost_breakdown: z.object({
    base_cost: z.number(),
    overage_cost: z.number(),
    total_cost: z.number()
  })
});

// ============================================================================
// SEARCH AND FILTERING SCHEMAS
// ============================================================================

// Contract Line filters
export const contractLineFilterSchema = baseFilterSchema.extend({
  contract_line_name: z.string().optional(),
  contract_line_type: planTypeSchema.optional(),
  billing_frequency: billingFrequencySchema.optional(),
  is_custom: booleanTransform.optional(),
  is_active: booleanTransform.optional(),
  service_category: z.string().optional(),
  has_services: booleanTransform.optional(),
  clients_count_min: numberTransform.optional(),
  clients_count_max: numberTransform.optional(),
  revenue_min: numberTransform.optional(),
  revenue_max: numberTransform.optional()
});

// Contract filters
export const contractFilterSchema = baseFilterSchema.extend({
  contract_name: z.string().optional(),
  is_active: booleanTransform.optional(),
  has_plans: booleanTransform.optional(),
  clients_count_min: numberTransform.optional(),
  clients_count_max: numberTransform.optional()
});

// Client contract line filters
export const clientContractLineFilterSchema = baseFilterSchema.extend({
  client_id: uuidSchema.optional(),
  contract_line_id: uuidSchema.optional(),
  service_category: z.string().optional(),
  is_active: booleanTransform.optional(),
  has_custom_rate: booleanTransform.optional(),
  is_contractd: booleanTransform.optional(),
  start_date_from: dateSchema.optional(),
  start_date_to: dateSchema.optional(),
  end_date_from: dateSchema.optional(),
  end_date_to: dateSchema.optional()
});

// List query schemas
export const contractLineListQuerySchema = createListQuerySchema(contractLineFilterSchema);
export const contractListQuerySchema = createListQuerySchema(contractFilterSchema);
export const clientContractLineListQuerySchema = createListQuerySchema(clientContractLineFilterSchema);

// ============================================================================
// ANALYTICS AND REPORTING SCHEMAS
// ============================================================================

// Plan analytics
export const planAnalyticsResponseSchema = z.object({
  contract_line_id: uuidSchema,
  contract_line_name: z.string(),
  contract_line_type: planTypeSchema,
  total_clients: z.number(),
  active_clients: z.number(),
  revenue: z.object({
    monthly: z.number(),
    quarterly: z.number(),
    yearly: z.number(),
    average_per_client: z.number()
  }),
  usage_stats: z.object({
    total_services: z.number(),
    most_used_services: z.array(z.object({
      service_id: uuidSchema,
      service_name: z.string(),
      usage_count: z.number()
    })),
    average_services_per_client: z.number()
  }),
  growth_metrics: z.object({
    new_clients_this_month: z.number(),
    churn_rate: z.number(),
    revenue_growth_rate: z.number()
  })
});

// Contract analytics
export const contractAnalyticsResponseSchema = z.object({
  contract_id: uuidSchema,
  contract_name: z.string(),
  total_plans: z.number(),
  total_clients: z.number(),
  active_clients: z.number(),
  revenue: z.object({
    monthly: z.number(),
    quarterly: z.number(),
    yearly: z.number(),
    average_per_client: z.number()
  }),
  plan_utilization: z.array(z.object({
    contract_line_id: uuidSchema,
    contract_line_name: z.string(),
    clients_using: z.number(),
    utilization_percentage: z.number()
  }))
});

// Billing overview analytics
export const billingOverviewAnalyticsSchema = z.object({
  total_plans: z.number(),
  total_contracts: z.number(),
  total_assignments: z.number(),
  plans_by_type: z.record(z.number()),
  revenue_summary: z.object({
    total_monthly_revenue: z.number(),
    average_revenue_per_plan: z.number(),
    top_revenue_plans: z.array(z.object({
      contract_line_id: uuidSchema,
      contract_line_name: z.string(),
      monthly_revenue: z.number()
    }))
  }),
  usage_trends: z.object({
    most_popular_contract_line_types: z.array(z.object({
      contract_line_type: planTypeSchema,
      count: z.number(),
      percentage: z.number()
    })),
    billing_frequency_distribution: z.record(z.number())
  })
});

// ============================================================================
// BULK OPERATIONS SCHEMAS
// ============================================================================

// Bulk plan operations
export const bulkCreateContractLinesSchema = z.object({
  plans: z.array(createContractLineSchema).min(1).max(50)
});

export const bulkUpdateContractLinesSchema = z.object({
  plans: z.array(z.object({
    contract_line_id: uuidSchema,
    data: updateContractLineSchema
  })).min(1).max(50)
});

export const bulkDeleteContractLinesSchema = z.object({
  contract_line_ids: z.array(uuidSchema).min(1).max(50)
});

// Bulk service operations
export const bulkAddServicesToPlanSchema = z.object({
  contract_line_id: uuidSchema,
  services: z.array(addServiceToPlanSchema).min(1).max(20)
});

export const bulkRemoveServicesFromPlanSchema = z.object({
  contract_line_id: uuidSchema,
  service_ids: z.array(uuidSchema).min(1).max(20)
});

// Bulk client assignments
export const bulkAssignPlansToClientSchema = z.object({
  client_id: uuidSchema,
  assignments: z.array(createClientContractLineSchema.omit({ client_id: true })).min(1).max(10)
});

export const bulkUnassignPlansFromClientSchema = z.object({
  client_id: uuidSchema,
  contract_line_ids: z.array(uuidSchema).min(1).max(10)
});

// ============================================================================
// TEMPLATE AND COPYING SCHEMAS
// ============================================================================

// Copy plan
export const copyContractLineSchema = z.object({
  source_contract_line_id: uuidSchema,
  new_contract_line_name: z.string().min(1).max(255),
  copy_services: z.boolean().optional().default(true),
  copy_configurations: z.boolean().optional().default(true),
  modify_rates: z.object({
    percentage_change: z.number().optional(),
    fixed_adjustment: z.number().optional()
  }).optional()
});

// Plan template
export const createPlanTemplateSchema = z.object({
  template_name: z.string().min(1).max(255),
  template_description: z.string().optional(),
  contract_line_type: planTypeSchema,
  billing_frequency: billingFrequencySchema,
  default_services: z.array(z.object({
    service_id: uuidSchema,
    configuration_type: configurationTypeSchema,
    default_rate: z.number().min(0).optional(),
    quantity: z.number().min(1).optional().default(1)
  })).optional(),
  is_public: z.boolean().optional().default(false)
});

export const planTemplateResponseSchema = z.object({
  template_id: uuidSchema,
  template_name: z.string(),
  template_description: z.string().nullable(),
  contract_line_type: planTypeSchema,
  billing_frequency: billingFrequencySchema,
  default_services: z.array(z.object({
    service_id: uuidSchema,
    service_name: z.string(),
    configuration_type: configurationTypeSchema,
    default_rate: z.number().nullable(),
    quantity: z.number()
  })).optional(),
  is_public: z.boolean(),
  created_by: uuidSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

// Create plan from template
export const createPlanFromTemplateSchema = z.object({
  template_id: uuidSchema,
  contract_line_name: z.string().min(1).max(255),
  modify_rates: z.object({
    percentage_change: z.number().optional(),
    fixed_adjustment: z.number().optional()
  }).optional(),
  override_services: z.array(z.object({
    service_id: uuidSchema,
    custom_rate: z.number().min(0).optional(),
    quantity: z.number().min(1).optional()
  })).optional()
});

// ============================================================================
// ACTIVATION AND DEACTIVATION SCHEMAS
// ============================================================================

// Plan activation/deactivation
export const planActivationSchema = z.object({
  is_active: z.boolean(),
  effective_date: z.string().datetime().optional(),
  reason: z.string().optional(),
  notify_clients: z.boolean().optional().default(false)
});

// Client plan activation/deactivation
export const clientPlanActivationSchema = z.object({
  client_contract_line_id: uuidSchema,
  is_active: z.boolean(),
  effective_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  reason: z.string().optional(),
  notify_client: z.boolean().optional().default(false)
});

// ============================================================================
// EXPORT TYPES FOR TYPESCRIPT
// ============================================================================

export type CreateContractLineData = z.infer<typeof createContractLineSchema>;
export type UpdateContractLineData = z.infer<typeof updateContractLineSchema>;
export type ContractLineResponse = z.infer<typeof contractLineResponseSchema>;
export type ContractLineFilterData = z.infer<typeof contractLineFilterSchema>;

export type CreateFixedPlanConfigData = z.infer<typeof createFixedPlanConfigSchema>;
export type UpdateFixedPlanConfigData = z.infer<typeof updateFixedPlanConfigSchema>;
export type FixedPlanConfigResponse = z.infer<typeof fixedPlanConfigResponseSchema>;
export type CombinedFixedPlanConfigResponse = z.infer<typeof combinedFixedPlanConfigResponseSchema>;

export type PlanServiceConfigurationResponse = z.infer<typeof planServiceConfigurationSchema>;
export type CreatePlanServiceFixedConfigData = z.infer<typeof createPlanServiceFixedConfigSchema>;
export type CreatePlanServiceHourlyConfigData = z.infer<typeof createPlanServiceHourlyConfigSchema>;
export type CreatePlanServiceUsageConfigData = z.infer<typeof createPlanServiceUsageConfigSchema>;
export type CreatePlanServiceBucketConfigData = z.infer<typeof createPlanServiceBucketConfigSchema>;

export type AddServiceToPlanData = z.infer<typeof addServiceToPlanSchema>;
export type UpdatePlanServiceData = z.infer<typeof updatePlanServiceSchema>;
export type PlanServiceWithConfigResponse = z.infer<typeof planServiceWithConfigResponseSchema>;

export type CreateRateTierData = z.infer<typeof createRateTierSchema>;
export type RateTierResponse = z.infer<typeof rateTierSchema>;
export type CreateUserTypeRateData = z.infer<typeof createUserTypeRateSchema>;
export type UserTypeRateResponse = z.infer<typeof userTypeRateSchema>;

export type CreateContractData = z.infer<typeof createContractSchema>;
export type UpdateContractData = z.infer<typeof updateContractSchema>;
export type ContractResponse = z.infer<typeof contractResponseSchema>;
export type ContractLineMappingResponse = z.infer<typeof contractLineMappingResponseSchema>;
export type AddContractLineData = z.infer<typeof addContractLineSchema>;
export type UpdateContractAssociationData = z.infer<typeof updateContractAssociationSchema>;

export type CreateClientContractLineData = z.infer<typeof createClientContractLineSchema>;
export type UpdateClientContractLineData = z.infer<typeof updateClientContractLineSchema>;
export type ClientContractLineResponse = z.infer<typeof clientContractLineResponseSchema>;
export type CreateClientContractData = z.infer<typeof createClientContractSchema>;
export type UpdateClientContractData = z.infer<typeof updateClientContractSchema>;
export type ClientContractResponse = z.infer<typeof clientContractResponseSchema>;

export type BucketUsageResponse = z.infer<typeof bucketUsageResponseSchema>;
export type UsageMetricsResponse = z.infer<typeof usageMetricsResponseSchema>;

export type ContractFilterData = z.infer<typeof contractFilterSchema>;
export type ClientContractLineFilterData = z.infer<typeof clientContractLineFilterSchema>;

export type PlanAnalyticsResponse = z.infer<typeof planAnalyticsResponseSchema>;
export type ContractAnalyticsResponse = z.infer<typeof contractAnalyticsResponseSchema>;
export type BillingOverviewAnalytics = z.infer<typeof billingOverviewAnalyticsSchema>;

export type BulkCreateContractLinesData = z.infer<typeof bulkCreateContractLinesSchema>;
export type BulkUpdateContractLinesData = z.infer<typeof bulkUpdateContractLinesSchema>;
export type BulkDeleteContractLinesData = z.infer<typeof bulkDeleteContractLinesSchema>;
export type BulkAddServicesToPlanData = z.infer<typeof bulkAddServicesToPlanSchema>;
export type BulkRemoveServicesFromPlanData = z.infer<typeof bulkRemoveServicesFromPlanSchema>;
export type BulkAssignPlansToClientData = z.infer<typeof bulkAssignPlansToClientSchema>;
export type BulkUnassignPlansFromClientData = z.infer<typeof bulkUnassignPlansFromClientSchema>;

export type CopyContractLineData = z.infer<typeof copyContractLineSchema>;
export type CreatePlanTemplateData = z.infer<typeof createPlanTemplateSchema>;
export type PlanTemplateResponse = z.infer<typeof planTemplateResponseSchema>;
export type CreatePlanFromTemplateData = z.infer<typeof createPlanFromTemplateSchema>;

export type PlanActivationData = z.infer<typeof planActivationSchema>;
export type ClientPlanActivationData = z.infer<typeof clientPlanActivationSchema>;
