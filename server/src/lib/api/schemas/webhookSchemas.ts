/**
 * Webhook API Schemas
 * Comprehensive validation schemas for webhook operations and management
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  emailSchema, 
  urlSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  metadataSchema,
  booleanTransform,
  numberTransform,
  dateSchema
} from './common';

// Webhook event types enum
export const webhookEventTypeSchema = z.enum([
  // Entity events
  'ticket.created',
  'ticket.updated',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.closed',
  'project.created',
  'project.updated',
  'project.completed',
  'project.task.created',
  'project.task.updated',
  'project.task.completed',
  'client.created',
  'client.updated',
  'contact.created',
  'contact.updated',
  'time.entry.created',
  'time.entry.updated',
  'time.entry.approved',
  'invoice.created',
  'invoice.finalized',
  'invoice.sent',
  'invoice.paid',
  'asset.created',
  'asset.updated',
  'asset.maintenance.scheduled',
  'asset.maintenance.completed',
  // System events
  'system.backup.completed',
  'system.backup.failed',
  'system.maintenance.started',
  'system.maintenance.completed',
  // Workflow events
  'workflow.execution.started',
  'workflow.execution.completed',
  'workflow.execution.failed',
  // Custom events
  'custom.event'
]);

// HTTP methods for webhook endpoints
export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Webhook security types
export const webhookSecurityTypeSchema = z.enum([
  'none',
  'basic_auth',
  'bearer_token',
  'api_key',
  'hmac_signature',
  'oauth2'
]);

// Webhook payload formats
export const webhookPayloadFormatSchema = z.enum([
  'json',
  'xml',
  'form_data',
  'custom'
]);

// Webhook delivery status
export const deliveryStatusSchema = z.enum([
  'pending',
  'delivered',
  'failed',
  'retrying',
  'abandoned'
]);

// Webhook retry strategies
export const retryStrategySchema = z.enum([
  'exponential_backoff',
  'linear_backoff',
  'fixed_interval',
  'custom'
]);

// Security configuration schema
export const webhookSecurityConfigSchema = z.object({
  type: webhookSecurityTypeSchema,
  // Basic auth
  username: z.string().optional(),
  password: z.string().optional(),
  // Bearer token / API key
  token: z.string().optional(),
  header_name: z.string().optional().default('Authorization'),
  // HMAC signature
  secret: z.string().optional(),
  algorithm: z.enum(['sha1', 'sha256', 'sha512']).optional().default('sha256'),
  signature_header: z.string().optional().default('X-Signature'),
  // OAuth2
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  token_url: urlSchema.optional(),
  scope: z.string().optional()
}).optional();

// Retry configuration schema
export const retryConfigSchema = z.object({
  strategy: retryStrategySchema.default('exponential_backoff'),
  max_attempts: z.number().min(1).max(10).default(3),
  initial_delay: z.number().min(1).default(1000), // milliseconds
  max_delay: z.number().min(1000).default(300000), // 5 minutes max
  backoff_multiplier: z.number().min(1).default(2),
  timeout: z.number().min(1000).max(30000).default(10000) // 10 seconds default
}).optional();

// Event filter configuration
export const eventFilterSchema = z.object({
  entity_types: z.array(z.string()).optional(),
  entity_ids: z.array(uuidSchema).optional(),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in']),
    value: z.any()
  })).optional(),
  tags: z.array(z.string()).optional()
}).optional();

// Payload transformation configuration
export const payloadTransformationSchema = z.object({
  template: z.string().optional(), // Handlebars template
  include_fields: z.array(z.string()).optional(),
  exclude_fields: z.array(z.string()).optional(),
  custom_fields: z.record(z.any()).optional(),
  flatten_nested: z.boolean().optional().default(false)
}).optional();

// Create webhook schema
export const createWebhookSchema = z.object({
  name: z.string().min(1, 'Webhook name is required').max(255),
  description: z.string().optional(),
  url: urlSchema.refine((url) => url !== undefined, 'Webhook URL is required'),
  method: httpMethodSchema.default('POST'),
  event_types: z.array(webhookEventTypeSchema).min(1, 'At least one event type is required'),
  
  // Security configuration
  security: webhookSecurityConfigSchema,
  
  // Payload configuration
  payload_format: webhookPayloadFormatSchema.default('json'),
  content_type: z.string().default('application/json'),
  custom_headers: z.record(z.string()).optional(),
  
  // Event filtering
  event_filter: eventFilterSchema,
  
  // Payload transformation
  payload_transformation: payloadTransformationSchema,
  
  // Retry configuration
  retry_config: retryConfigSchema,
  
  // Webhook settings
  is_active: z.boolean().default(true),
  is_test_mode: z.boolean().default(false),
  verify_ssl: z.boolean().default(true),
  secret_token: z.string().optional(), // For webhook verification
  
  // Rate limiting
  rate_limit: z.object({
    enabled: z.boolean().default(false),
    requests_per_minute: z.number().min(1).max(1000).optional(),
    burst_limit: z.number().min(1).optional()
  }).optional(),
  
  // Metadata
  metadata: metadataSchema,
  tags: z.array(z.string()).optional()
});

// Update webhook schema
export const updateWebhookSchema = createUpdateSchema(createWebhookSchema);

// Webhook response schema
export const webhookResponseSchema = z.object({
  webhook_id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  method: httpMethodSchema,
  event_types: z.array(webhookEventTypeSchema),
  
  security: webhookSecurityConfigSchema,
  payload_format: webhookPayloadFormatSchema,
  content_type: z.string(),
  custom_headers: z.record(z.string()).nullable(),
  
  event_filter: eventFilterSchema,
  payload_transformation: payloadTransformationSchema,
  retry_config: retryConfigSchema,
  
  is_active: z.boolean(),
  is_test_mode: z.boolean(),
  verify_ssl: z.boolean(),
  secret_token: z.string().nullable(),
  
  rate_limit: z.object({
    enabled: z.boolean(),
    requests_per_minute: z.number().nullable(),
    burst_limit: z.number().nullable()
  }).nullable(),
  
  // Statistics
  total_deliveries: z.number().default(0),
  successful_deliveries: z.number().default(0),
  failed_deliveries: z.number().default(0),
  last_delivery_at: dateSchema,
  last_success_at: dateSchema,
  last_failure_at: dateSchema,
  
  created_at: dateSchema,
  updated_at: dateSchema,
  tenant: uuidSchema,
  metadata: metadataSchema,
  tags: z.array(z.string()).optional()
});

// Webhook filter schema
export const webhookFilterSchema = baseFilterSchema.extend({
  name: z.string().optional(),
  url: z.string().optional(),
  event_type: webhookEventTypeSchema.optional(),
  is_active: booleanTransform.optional(),
  is_test_mode: booleanTransform.optional(),
  payload_format: webhookPayloadFormatSchema.optional(),
  last_delivery_from: dateSchema,
  last_delivery_to: dateSchema,
  has_failures: booleanTransform.optional(),
  delivery_rate_min: numberTransform.optional(), // Success rate percentage
  delivery_rate_max: numberTransform.optional()
});

// Webhook list query schema
export const webhookListQuerySchema = createListQuerySchema(webhookFilterSchema);

// Webhook delivery record schema
export const webhookDeliverySchema = z.object({
  delivery_id: uuidSchema,
  webhook_id: uuidSchema,
  event_id: uuidSchema.optional(),
  event_type: webhookEventTypeSchema,
  
  // Request details
  request_url: z.string(),
  request_method: httpMethodSchema,
  request_headers: z.record(z.string()).optional(),
  request_body: z.string().optional(),
  
  // Response details
  response_status: z.number().optional(),
  response_headers: z.record(z.string()).optional(),
  response_body: z.string().optional(),
  
  // Delivery metadata
  status: deliveryStatusSchema,
  attempt_number: z.number().min(1),
  duration_ms: z.number().min(0).optional(),
  error_message: z.string().optional(),
  
  // Timestamps
  attempted_at: dateSchema,
  completed_at: dateSchema,
  next_retry_at: dateSchema,
  
  tenant: uuidSchema
});

// Webhook test schema
export const webhookTestSchema = z.object({
  webhook_id: uuidSchema.optional(), // If testing existing webhook
  test_event_type: webhookEventTypeSchema,
  test_payload: z.record(z.any()).optional(),
  override_url: urlSchema.optional() // For testing different URL
});

// Webhook test result schema
export const webhookTestResultSchema = z.object({
  test_id: uuidSchema,
  success: z.boolean(),
  status_code: z.number().optional(),
  response_time_ms: z.number().optional(),
  response_body: z.string().optional(),
  error_message: z.string().optional(),
  tested_at: dateSchema
});

// Webhook template schema for common configurations
export const webhookTemplateSchema = z.object({
  template_id: uuidSchema,
  name: z.string(),
  description: z.string().optional(),
  category: z.string(), // e.g., 'slack', 'discord', 'teams', 'custom'
  
  // Template configuration
  default_config: z.object({
    url_template: z.string().optional(), // Template with placeholders
    method: httpMethodSchema,
    headers: z.record(z.string()).optional(),
    payload_template: z.string(), // Handlebars template
    security_type: webhookSecurityTypeSchema.optional()
  }),
  
  // Required fields for this template
  required_fields: z.array(z.string()).optional(),
  
  // Supported event types
  supported_events: z.array(webhookEventTypeSchema).optional(),
  
  is_system_template: z.boolean().default(false),
  created_at: dateSchema,
  updated_at: dateSchema,
  tenant: uuidSchema.optional() // Null for system templates
});

// Bulk webhook operations
export const bulkWebhookOperationSchema = z.object({
  webhook_ids: z.array(uuidSchema).min(1).max(100),
  operation: z.enum(['activate', 'deactivate', 'delete', 'test']),
  test_event_type: webhookEventTypeSchema.optional() // Required for test operation
});

// Webhook subscription schema (for event-based subscriptions)
export const webhookSubscriptionSchema = z.object({
  subscription_id: uuidSchema,
  webhook_id: uuidSchema,
  entity_type: z.string(), // e.g., 'ticket', 'project', 'client'
  entity_id: uuidSchema.optional(), // Optional for entity-specific subscriptions
  event_types: z.array(webhookEventTypeSchema),
  
  // Subscription settings
  is_active: z.boolean().default(true),
  expires_at: dateSchema,
  
  created_at: dateSchema,
  updated_at: dateSchema,
  tenant: uuidSchema
});

// Webhook delivery analytics
export const webhookAnalyticsSchema = z.object({
  webhook_id: uuidSchema.optional(), // If null, returns system-wide analytics
  date_from: dateSchema,
  date_to: dateSchema,
  
  metrics: z.object({
    total_deliveries: z.number(),
    successful_deliveries: z.number(),
    failed_deliveries: z.number(),
    success_rate: z.number(), // Percentage
    average_response_time: z.number(), // milliseconds
    
    // Delivery by status
    deliveries_by_status: z.record(z.number()),
    
    // Event type breakdown
    deliveries_by_event_type: z.record(z.number()),
    
    // Timeline data
    deliveries_timeline: z.array(z.object({
      date: z.string(), // ISO date
      successful: z.number(),
      failed: z.number()
    })),
    
    // Response time percentiles
    response_time_percentiles: z.object({
      p50: z.number(),
      p90: z.number(),
      p95: z.number(),
      p99: z.number()
    }).optional()
  })
});

// Webhook event schema (for the actual event payload)
export const webhookEventSchema = z.object({
  event_id: uuidSchema,
  event_type: webhookEventTypeSchema,
  entity_type: z.string(),
  entity_id: uuidSchema,
  
  // Event data
  current_data: z.record(z.any()), // Current state of the entity
  previous_data: z.record(z.any()).optional(), // Previous state (for updates)
  changes: z.array(z.object({
    field: z.string(),
    old_value: z.any(),
    new_value: z.any()
  })).optional(),
  
  // Context
  triggered_by: z.object({
    user_id: uuidSchema.optional(),
    user_name: z.string().optional(),
    source: z.string(), // 'api', 'web', 'system', etc.
    ip_address: z.string().optional()
  }).optional(),
  
  // Timestamps
  occurred_at: dateSchema,
  tenant: uuidSchema,
  
  // Metadata
  metadata: z.record(z.any()).optional()
});

// Webhook signature verification
export const webhookSignatureSchema = z.object({
  algorithm: z.enum(['sha1', 'sha256', 'sha512']),
  signature: z.string(),
  timestamp: z.number().optional(),
  body: z.string()
});

// Search and filtering schemas
export const webhookSearchSchema = z.object({
  query: z.string().optional(),
  filters: z.object({
    event_types: z.array(webhookEventTypeSchema).optional(),
    status: z.array(z.enum(['active', 'inactive'])).optional(),
    last_delivery: z.object({
      from: dateSchema,
      to: dateSchema
    }).optional(),
    success_rate: z.object({
      min: z.number().min(0).max(100).optional(),
      max: z.number().min(0).max(100).optional()
    }).optional()
  }).optional(),
  sort: z.object({
    field: z.enum(['name', 'created_at', 'last_delivery_at', 'success_rate']),
    order: z.enum(['asc', 'desc'])
  }).optional()
});

// Export TypeScript types
export type CreateWebhookData = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookData = z.infer<typeof updateWebhookSchema>;
export type WebhookResponse = z.infer<typeof webhookResponseSchema>;
export type WebhookFilterData = z.infer<typeof webhookFilterSchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type WebhookTest = z.infer<typeof webhookTestSchema>;
export type WebhookTestResult = z.infer<typeof webhookTestResultSchema>;
export type WebhookTemplate = z.infer<typeof webhookTemplateSchema>;
export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;
export type WebhookAnalytics = z.infer<typeof webhookAnalyticsSchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type WebhookSecurityConfig = z.infer<typeof webhookSecurityConfigSchema>;
export type RetryConfig = z.infer<typeof retryConfigSchema>;
export type EventFilter = z.infer<typeof eventFilterSchema>;
export type PayloadTransformation = z.infer<typeof payloadTransformationSchema>;

// Validation helper functions
export function validateWebhookUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

export function validateEventType(eventType: string): boolean {
  return webhookEventTypeSchema.safeParse(eventType).success;
}

export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha256'
): boolean {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac(algorithm, secret)
    .update(payload, 'utf8')
    .digest('hex');
  
  const expectedSignatureWithPrefix = `${algorithm}=${expectedSignature}`;
  
  // Use crypto.timingSafeEqual for constant-time comparison
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignatureWithPrefix);
  
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

// Default webhook templates
export const defaultWebhookTemplates = {
  slack: {
    name: 'Slack Webhook',
    description: 'Send notifications to Slack board',
    default_config: {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      payload_template: '{"text": "{{event_type}} - {{entity_type}} {{#if current_data.name}}{{current_data.name}}{{else}}{{entity_id}}{{/if}}"}'
    }
  },
  discord: {
    name: 'Discord Webhook',
    description: 'Send notifications to Discord board',
    default_config: {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      payload_template: '{"content": "**{{event_type}}** - {{entity_type}} {{#if current_data.name}}{{current_data.name}}{{else}}{{entity_id}}{{/if}}"}'
    }
  },
  teams: {
    name: 'Microsoft Teams Webhook',
    description: 'Send notifications to Microsoft Teams board',
    default_config: {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      payload_template: '{"@type": "MessageCard", "@context": "http://schema.org/extensions", "summary": "{{event_type}}", "text": "{{event_type}} - {{entity_type}} {{#if current_data.name}}{{current_data.name}}{{else}}{{entity_id}}{{/if}}"}'
    }
  }
};