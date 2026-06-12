import type { ZodTypeAny } from 'zod';
import { WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY } from '../../../webhooks/payloadFields';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ApiResponseSpec } from '../types';

export function registerWebhookRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Webhooks';
  const payloadFieldDescription = Object.entries(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY)
    .map(([entity, fields]) => `${entity}: ${fields.join(', ')}`)
    .join('; ');
  const payloadFieldsByEntityShape: Record<string, ZodTypeAny> = {};
  for (const [entity, fields] of Object.entries(WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY)) {
    const [firstField, ...otherFields] = fields;
    payloadFieldsByEntityShape[entity] = firstField
      ? zOpenApi
          .array(zOpenApi.enum([firstField, ...otherFields] as [string, ...string[]]))
          .nullable()
          .optional()
      : zOpenApi.array(zOpenApi.string()).nullable().optional();
  }

  // ---------------------------------------------------------------------------
  // Path / query parameters
  // ---------------------------------------------------------------------------

  const WebhookIdParam = registry.registerSchema(
    'WebhookIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Webhook UUID from webhooks.webhook_id.'),
    }),
  );

  const WebhookDeliveryParams = registry.registerSchema(
    'WebhookDeliveryParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Webhook UUID from webhooks.webhook_id.'),
      delivery_id: zOpenApi
        .string()
        .uuid()
        .describe('Delivery UUID from webhook_deliveries.delivery_id (URL-derived).'),
    }),
  );

  const WebhookListQuery = registry.registerSchema(
    'WebhookListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      name: zOpenApi.string().optional(),
      url: zOpenApi.string().optional(),
      event_type: zOpenApi.string().optional(),
      is_active: zOpenApi.enum(['true', 'false']).optional(),
      is_test_mode: zOpenApi.enum(['true', 'false']).optional(),
      payload_format: zOpenApi.enum(['json', 'xml', 'form_data', 'custom']).optional(),
      has_failures: zOpenApi.enum(['true', 'false']).optional(),
      last_delivery_from: zOpenApi.string().optional(),
      last_delivery_to: zOpenApi.string().optional(),
      delivery_rate_min: zOpenApi.string().optional(),
      delivery_rate_max: zOpenApi.string().optional(),
      query: zOpenApi.string().optional(),
    }),
  );

  const WebhookAnalyticsQuery = registry.registerSchema(
    'WebhookAnalyticsQueryV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid().optional(),
      date_from: zOpenApi.string().datetime().optional(),
      date_to: zOpenApi.string().datetime().optional(),
    }),
  );

  const WebhookDeliveryQuery = registry.registerSchema(
    'WebhookDeliveryQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      status: zOpenApi
        .enum(['pending', 'delivered', 'failed', 'retrying', 'abandoned'])
        .optional(),
      from_date: zOpenApi.string().datetime().optional(),
      to_date: zOpenApi.string().datetime().optional(),
    }),
  );

  // ---------------------------------------------------------------------------
  // Reusable enums (registered so refs survive serialization)
  // ---------------------------------------------------------------------------

  const TicketWebhookEvent = registry.registerSchema(
    'TicketWebhookEventV1',
    zOpenApi
      .enum([
        'ticket.created',
        'ticket.updated',
        'ticket.status_changed',
        'ticket.assigned',
        'ticket.closed',
        'ticket.comment.added',
      ])
      .describe('Ticket-domain webhook events emitted by the eventBus subscriber.'),
  );

  const WebhookEventType = registry.registerSchema(
    'WebhookEventTypeV1',
    zOpenApi.enum([
      'ticket.created',
      'ticket.updated',
      'ticket.status_changed',
      'ticket.assigned',
      'ticket.closed',
      'ticket.comment.added',
      'project.created',
      'project.updated',
      'project.status_changed',
      'project.assigned',
      'project.closed',
      'project.completed',
      'project.task.created',
      'project.task.updated',
      'project.task.status_changed',
      'project.task.assigned',
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
      'system.backup.completed',
      'system.backup.failed',
      'system.maintenance.started',
      'system.maintenance.completed',
      'workflow.execution.started',
      'workflow.execution.completed',
      'workflow.execution.failed',
      'custom.event',
    ]),
  );

  // ---------------------------------------------------------------------------
  // Request bodies
  // ---------------------------------------------------------------------------

  const PayloadFieldsByEntity = zOpenApi
    .object(payloadFieldsByEntityShape)
    .nullable()
    .describe(
      `Per-entity payload allowlist. null/{} = full payload everywhere. { ticket: null } = full ticket payload. { ticket: [] } = required-only. { ticket: [a,b] } = explicit allowlist plus required keys. Unknown entities and fields are rejected by WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY in lib/webhooks/payloadFields. Supported fields: ${payloadFieldDescription}.`,
    );

  const CreateWebhookBody = registry.registerSchema(
    'CreateWebhookBodyV1',
    zOpenApi.object({
      name: zOpenApi.string().min(1),
      description: zOpenApi.string().optional(),
      url: zOpenApi.string().url(),
      method: zOpenApi.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      event_types: zOpenApi.array(WebhookEventType).min(1),
      security: zOpenApi.record(zOpenApi.unknown()).optional(),
      payload_format: zOpenApi.enum(['json', 'xml', 'form_data', 'custom']).optional(),
      content_type: zOpenApi.string().optional(),
      custom_headers: zOpenApi.record(zOpenApi.string()).optional(),
      event_filter: zOpenApi.record(zOpenApi.unknown()).optional(),
      payload_fields: PayloadFieldsByEntity.optional(),
      payload_transformation: zOpenApi.record(zOpenApi.unknown()).optional(),
      retry_config: zOpenApi.record(zOpenApi.unknown()).optional(),
      is_active: zOpenApi.boolean().optional(),
      is_test_mode: zOpenApi.boolean().optional(),
      verify_ssl: zOpenApi.boolean().optional(),
      secret_token: zOpenApi.string().optional(),
      rate_limit: zOpenApi.record(zOpenApi.unknown()).optional(),
      metadata: zOpenApi.record(zOpenApi.unknown()).optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
    }),
  );

  const WebhookTestBody = registry.registerSchema(
    'WebhookTestBodyV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid().optional(),
      test_event_type: WebhookEventType,
      test_payload: zOpenApi.record(zOpenApi.unknown()).optional(),
      override_url: zOpenApi.string().url().optional(),
    }),
  );

  const WebhookTemplateBody = registry.registerSchema(
    'WebhookTemplateBodyV1',
    zOpenApi.object({
      name: zOpenApi.string(),
      description: zOpenApi.string().optional(),
      category: zOpenApi.string(),
      default_config: zOpenApi.record(zOpenApi.unknown()),
      required_fields: zOpenApi.array(zOpenApi.string()).optional(),
      supported_events: zOpenApi.array(WebhookEventType).optional(),
      is_system_template: zOpenApi.boolean().optional(),
    }),
  );

  const WebhookTemplateCreateBody = registry.registerSchema(
    'WebhookTemplateCreateBodyV1',
    zOpenApi.object({
      name: zOpenApi.string().min(1),
      url: zOpenApi.string().url(),
      custom_config: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const WebhookSignatureBody = registry.registerSchema(
    'WebhookSignatureBodyV1',
    zOpenApi
      .object({
        algorithm: zOpenApi
          .enum(['sha1', 'sha256', 'sha512'])
          .describe('Only sha256 is currently honored; other values yield valid=false.'),
        signature: zOpenApi
          .string()
          .describe(
            'Either the raw v1 signature, or the canonical "t=<unix>,v1=<sig>" header value. When raw and a timestamp is supplied, the controller assembles the canonical form before verifying.',
          ),
        timestamp: zOpenApi
          .number()
          .optional()
          .describe('Unix-seconds timestamp paired with a raw v1 signature.'),
        body: zOpenApi.string().describe('Exact request body bytes to verify against.'),
        webhook_id: zOpenApi
          .string()
          .uuid()
          .optional()
          .describe('Resolves the signing secret from webhooks.signing_secret_vault_path.'),
        secret_vault_path: zOpenApi
          .string()
          .optional()
          .describe(
            'Vault key (basename of secret_vault_path) used when no webhook_id is supplied. webhook_id or secret_vault_path is required.',
          ),
      })
      .describe('Verification request: webhook_id OR secret_vault_path is required.'),
  );

  // ---------------------------------------------------------------------------
  // Concrete response schemas
  // ---------------------------------------------------------------------------

  const ApiError = registry.registerSchema(
    'WebhookApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const WebhookRecord = registry.registerSchema(
    'WebhookRecordV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid(),
      tenant: zOpenApi.string().uuid(),
      name: zOpenApi.string(),
      description: zOpenApi.string().nullable(),
      url: zOpenApi.string(),
      method: zOpenApi.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      event_types: zOpenApi.array(WebhookEventType),
      security: zOpenApi.record(zOpenApi.unknown()).nullable().optional(),
      payload_format: zOpenApi.enum(['json', 'xml', 'form_data', 'custom']).optional(),
      content_type: zOpenApi.string().optional(),
      custom_headers: zOpenApi.record(zOpenApi.string()).nullable(),
      event_filter: zOpenApi.record(zOpenApi.unknown()).nullable().optional(),
      payload_fields: PayloadFieldsByEntity.optional(),
      payload_transformation: zOpenApi.record(zOpenApi.unknown()).nullable().optional(),
      retry_config: zOpenApi.record(zOpenApi.unknown()).nullable().optional(),
      is_active: zOpenApi.boolean(),
      is_test_mode: zOpenApi.boolean().optional(),
      verify_ssl: zOpenApi.boolean(),
      total_deliveries: zOpenApi.number().int(),
      successful_deliveries: zOpenApi.number().int(),
      failed_deliveries: zOpenApi.number().int(),
      last_delivery_at: zOpenApi.string().datetime().nullable().optional(),
      last_success_at: zOpenApi.string().datetime().nullable().optional(),
      last_failure_at: zOpenApi.string().datetime().nullable().optional(),
      auto_disabled_at: zOpenApi.string().datetime().nullable().optional(),
      created_at: zOpenApi.string().datetime(),
      updated_at: zOpenApi.string().datetime(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
    }),
  );

  const WebhookDeliveryRecord = registry.registerSchema(
    'WebhookDeliveryRecordV1',
    zOpenApi.object({
      tenant: zOpenApi.string().uuid(),
      delivery_id: zOpenApi.string().uuid(),
      webhook_id: zOpenApi.string().uuid(),
      event_id: zOpenApi.string(),
      event_type: zOpenApi.string(),
      request_headers: zOpenApi.record(zOpenApi.string()).nullable(),
      request_body: zOpenApi.unknown().nullable(),
      response_status_code: zOpenApi.number().int().nullable(),
      response_headers: zOpenApi.record(zOpenApi.string()).nullable(),
      response_body: zOpenApi.string().nullable(),
      status: zOpenApi.enum(['pending', 'delivered', 'failed', 'retrying', 'abandoned']),
      attempt_number: zOpenApi.number().int(),
      duration_ms: zOpenApi.number().int().nullable(),
      error_message: zOpenApi.string().nullable(),
      next_retry_at: zOpenApi.string().datetime().nullable(),
      is_test: zOpenApi.boolean(),
      attempted_at: zOpenApi.string().datetime(),
      completed_at: zOpenApi.string().datetime().nullable(),
    }),
  );

  const WebhookHealth = registry.registerSchema(
    'WebhookHealthV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid(),
      status: zOpenApi.enum(['healthy', 'failing', 'disabled']),
      is_active: zOpenApi.boolean(),
      auto_disabled_at: zOpenApi.string().datetime().nullable(),
      total_deliveries: zOpenApi.number().int(),
      successful_deliveries: zOpenApi.number().int(),
      failed_deliveries: zOpenApi.number().int(),
      success_rate: zOpenApi
        .number()
        .describe('Fraction in [0,1]; 1 when there are no deliveries yet.'),
      last_delivery_at: zOpenApi.string().datetime().nullable(),
      last_success_at: zOpenApi.string().datetime().nullable(),
      last_failure_at: zOpenApi.string().datetime().nullable(),
      checked_at: zOpenApi.string().datetime(),
    }),
  );

  const WebhookTestResult = registry.registerSchema(
    'WebhookTestResultV1',
    zOpenApi.object({
      test_id: zOpenApi.string().uuid().describe('event_id stamped on the test envelope.'),
      delivery_id: zOpenApi.string().uuid(),
      success: zOpenApi.boolean(),
      status_code: zOpenApi.number().int().nullable().optional(),
      response_time_ms: zOpenApi.number().int().nullable().optional(),
      response_body: zOpenApi.string().nullable().optional(),
      error_message: zOpenApi.string().nullable().optional(),
      tested_at: zOpenApi.string().datetime(),
    }),
  );

  const WebhookSecretRotation = registry.registerSchema(
    'WebhookSecretRotationV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid(),
      signing_secret: zOpenApi
        .string()
        .describe('32-byte base64url secret; only returned at rotation time.'),
    }),
  );

  const WebhookSubscriptionsResponse = registry.registerSchema(
    'WebhookSubscriptionsResponseV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid(),
      event_types: zOpenApi.array(WebhookEventType),
    }),
  );

  const WebhookSignatureValidation = registry.registerSchema(
    'WebhookSignatureValidationV1',
    zOpenApi.object({
      valid: zOpenApi.boolean(),
    }),
  );

  const WebhookEventList = registry.registerSchema(
    'WebhookEventListV1',
    zOpenApi.array(WebhookEventType),
  );

  const WebhookAnalyticsResponse = registry.registerSchema(
    'WebhookAnalyticsResponseV1',
    zOpenApi.object({
      webhook_id: zOpenApi.string().uuid().optional(),
      date_from: zOpenApi.string().datetime(),
      date_to: zOpenApi.string().datetime(),
      metrics: zOpenApi.object({
        total_deliveries: zOpenApi.number().int(),
        successful_deliveries: zOpenApi.number().int(),
        failed_deliveries: zOpenApi.number().int(),
        success_rate: zOpenApi.number(),
        average_response_time: zOpenApi.number(),
        deliveries_by_status: zOpenApi.record(zOpenApi.number().int()),
        deliveries_by_event_type: zOpenApi.record(zOpenApi.number().int()),
        deliveries_timeline: zOpenApi.array(
          zOpenApi.object({
            date: zOpenApi.string(),
            successful: zOpenApi.number().int(),
            failed: zOpenApi.number().int(),
          }),
        ),
        response_time_percentiles: zOpenApi
          .object({
            p50: zOpenApi.number(),
            p90: zOpenApi.number(),
            p95: zOpenApi.number(),
            p99: zOpenApi.number(),
          })
          .optional(),
      }),
    }),
  );

  const WebhookTemplateRecord = registry.registerSchema(
    'WebhookTemplateRecordV1',
    zOpenApi.object({
      template_id: zOpenApi.string().uuid(),
      name: zOpenApi.string(),
      description: zOpenApi.string().optional(),
      category: zOpenApi.string(),
      default_config: zOpenApi.object({
        url_template: zOpenApi.string().optional(),
        method: zOpenApi.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        headers: zOpenApi.record(zOpenApi.string()).optional(),
        payload_template: zOpenApi.string(),
        security_type: zOpenApi
          .enum(['none', 'basic_auth', 'bearer_token', 'api_key', 'hmac_signature', 'oauth2'])
          .optional(),
      }),
      required_fields: zOpenApi.array(zOpenApi.string()).optional(),
      supported_events: zOpenApi.array(WebhookEventType).optional(),
      is_system_template: zOpenApi.boolean().optional(),
      created_at: zOpenApi.string().datetime(),
      updated_at: zOpenApi.string().datetime(),
      tenant: zOpenApi.string().uuid().nullable().optional(),
    }),
  );

  // Generic envelopes (still used for endpoints whose payload is a list/object
  // we do not need to lock down — e.g. listTemplates, useTemplate result).
  function successOf(schema: ReturnType<typeof zOpenApi.object> | unknown) {
    return zOpenApi.object({
      data: schema as never,
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    });
  }

  function paginatedOf(itemSchema: unknown) {
    return zOpenApi.object({
      data: zOpenApi.array(itemSchema as never),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    });
  }

  const WebhookListResponse = registry.registerSchema(
    'WebhookListResponseV1',
    paginatedOf(WebhookRecord),
  );
  const WebhookDeliveryListResponse = registry.registerSchema(
    'WebhookDeliveryListResponseV1',
    paginatedOf(WebhookDeliveryRecord),
  );
  const WebhookEnvelope = registry.registerSchema(
    'WebhookEnvelopeV1',
    successOf(WebhookRecord),
  );
  const WebhookDeliveryEnvelope = registry.registerSchema(
    'WebhookDeliveryEnvelopeV1',
    successOf(WebhookDeliveryRecord),
  );
  const WebhookHealthEnvelope = registry.registerSchema(
    'WebhookHealthEnvelopeV1',
    successOf(WebhookHealth),
  );
  const WebhookTestResultEnvelope = registry.registerSchema(
    'WebhookTestResultEnvelopeV1',
    successOf(WebhookTestResult),
  );
  const WebhookSecretRotationEnvelope = registry.registerSchema(
    'WebhookSecretRotationEnvelopeV1',
    successOf(WebhookSecretRotation),
  );
  const WebhookSubscriptionsEnvelope = registry.registerSchema(
    'WebhookSubscriptionsEnvelopeV1',
    successOf(WebhookSubscriptionsResponse),
  );
  const WebhookSignatureValidationEnvelope = registry.registerSchema(
    'WebhookSignatureValidationEnvelopeV1',
    successOf(WebhookSignatureValidation),
  );
  const WebhookEventListEnvelope = registry.registerSchema(
    'WebhookEventListEnvelopeV1',
    successOf(WebhookEventList),
  );
  const WebhookAnalyticsEnvelope = registry.registerSchema(
    'WebhookAnalyticsEnvelopeV1',
    successOf(WebhookAnalyticsResponse),
  );
  const WebhookTemplateListEnvelope = registry.registerSchema(
    'WebhookTemplateListEnvelopeV1',
    successOf(zOpenApi.array(WebhookTemplateRecord)),
  );
  const WebhookTemplateEnvelope = registry.registerSchema(
    'WebhookTemplateEnvelopeV1',
    successOf(WebhookTemplateRecord),
  );

  // ---------------------------------------------------------------------------
  // Outbound delivery (OpenAPI 3.1 `webhooks:` block) — declares what
  // *consumers* receive at their URL, not what the management API consumes.
  // ---------------------------------------------------------------------------

  const TicketChangeEntry = registry.registerSchema(
    'TicketWebhookChangeEntryV1',
    zOpenApi.object({
      previous: zOpenApi.unknown().nullable(),
      new: zOpenApi.unknown().nullable(),
    }),
  );

  const TicketCommentBlock = registry.registerSchema(
    'TicketWebhookCommentBlockV1',
    zOpenApi.object({
      text: zOpenApi.string(),
      author: zOpenApi.string().nullable(),
      timestamp: zOpenApi.string().datetime(),
      is_internal: zOpenApi.boolean(),
    }),
  );

  const TicketCommentsEntry = registry.registerSchema(
    'TicketWebhookCommentsEntryV1',
    zOpenApi.object({
      comment_id: zOpenApi.string().uuid(),
      text: zOpenApi.string(),
      author: zOpenApi.string().nullable(),
      is_internal: zOpenApi.boolean(),
      is_resolution: zOpenApi.boolean(),
      created_at: zOpenApi.string().datetime(),
      updated_at: zOpenApi.string().datetime().nullable(),
    }),
  );

  // Full ticket payload superset; per-event events use this with documented
  // additions/restrictions noted in their description.
  const TicketWebhookData = registry.registerSchema(
    'TicketWebhookDataV1',
    zOpenApi.object({
      ticket_id: zOpenApi.string().uuid().describe('Always present; the correlation key.'),
      ticket_number: zOpenApi.string().nullable().optional(),
      title: zOpenApi.string().nullable().optional(),
      url: zOpenApi.string().url().optional(),
      status_id: zOpenApi.string().uuid().nullable().optional(),
      status_name: zOpenApi.string().nullable().optional(),
      is_closed: zOpenApi.boolean().optional(),
      previous_status_id: zOpenApi
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe('Only populated on ticket.status_changed.'),
      previous_status_name: zOpenApi
        .string()
        .nullable()
        .optional()
        .describe('Only populated on ticket.status_changed.'),
      priority_id: zOpenApi.string().uuid().nullable().optional(),
      priority_name: zOpenApi.string().nullable().optional(),
      client_id: zOpenApi.string().uuid().nullable().optional(),
      client_name: zOpenApi.string().nullable().optional(),
      contact_name_id: zOpenApi.string().uuid().nullable().optional(),
      contact_name: zOpenApi.string().nullable().optional(),
      contact_email: zOpenApi.string().nullable().optional(),
      assigned_to: zOpenApi.string().uuid().nullable().optional(),
      assigned_to_name: zOpenApi.string().nullable().optional(),
      assigned_team_id: zOpenApi.string().uuid().nullable().optional(),
      board_id: zOpenApi.string().uuid().nullable().optional(),
      board_name: zOpenApi.string().nullable().optional(),
      category_id: zOpenApi.string().uuid().nullable().optional(),
      subcategory_id: zOpenApi.string().uuid().nullable().optional(),
      entered_at: zOpenApi.string().datetime().nullable().optional(),
      updated_at: zOpenApi.string().datetime().nullable().optional(),
      closed_at: zOpenApi.string().datetime().nullable().optional(),
      due_date: zOpenApi.string().nullable().optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
      changes: zOpenApi
        .record(TicketChangeEntry)
        .optional()
        .describe('Field-level diff. Only on ticket.updated.'),
      comment: TicketCommentBlock.optional().describe(
        'Newly-added comment. Only on ticket.comment.added. Attachments are never included.',
      ),
      comments: zOpenApi
        .array(TicketCommentsEntry)
        .optional()
        .describe(
          'Full comment thread, oldest first. Only included when the webhook subscription opted into the `comments` field.',
        ),
    }),
  );

  function envelopeFor(eventValue: string, dataSchema: ReturnType<typeof zOpenApi.object>) {
    return zOpenApi.object({
      event_id: zOpenApi.string().uuid(),
      event_type: zOpenApi.literal(eventValue),
      occurred_at: zOpenApi.string().datetime(),
      tenant_id: zOpenApi.string().uuid(),
      data: dataSchema,
    });
  }

  const WebhookOutboundHeaders = registry.registerSchema(
    'WebhookOutboundHeadersV1',
    zOpenApi.object({
      'x-alga-signature': zOpenApi
        .string()
        .describe('`t=<unix-seconds>,v1=<hex-hmac-sha256>` over `${timestamp}.${raw_body}`.'),
      'x-alga-webhook-id': zOpenApi.string().uuid(),
      'x-alga-event-id': zOpenApi.string().uuid(),
      'x-alga-event-type': WebhookEventType,
      'x-alga-delivery-id': zOpenApi.string().uuid(),
      'x-alga-delivery-attempt': zOpenApi.string().describe('Stringified attempt count, starts at 1.'),
    }),
  );

  const TicketCreatedEnvelope = registry.registerSchema(
    'TicketCreatedDeliveryV1',
    envelopeFor('ticket.created', TicketWebhookData),
  );
  const TicketUpdatedEnvelope = registry.registerSchema(
    'TicketUpdatedDeliveryV1',
    envelopeFor('ticket.updated', TicketWebhookData),
  );
  const TicketStatusChangedEnvelope = registry.registerSchema(
    'TicketStatusChangedDeliveryV1',
    envelopeFor('ticket.status_changed', TicketWebhookData),
  );
  const TicketAssignedEnvelope = registry.registerSchema(
    'TicketAssignedDeliveryV1',
    envelopeFor('ticket.assigned', TicketWebhookData),
  );
  const TicketClosedEnvelope = registry.registerSchema(
    'TicketClosedDeliveryV1',
    envelopeFor('ticket.closed', TicketWebhookData),
  );
  const TicketCommentAddedEnvelope = registry.registerSchema(
    'TicketCommentAddedDeliveryV1',
    envelopeFor('ticket.comment.added', TicketWebhookData),
  );

  const outboundDefs: Array<{ event: string; envelope: ZodTypeAny; description: string }> = [
    {
      event: 'ticket.created',
      envelope: TicketCreatedEnvelope,
      description:
        'Emitted when a ticket is first created. `data.changes` and `data.comment` are not included on this event.',
    },
    {
      event: 'ticket.updated',
      envelope: TicketUpdatedEnvelope,
      description:
        'Emitted when a ticket is updated. `data.changes` is a record keyed by changed field name with `{previous, new}` entries.',
    },
    {
      event: 'ticket.status_changed',
      envelope: TicketStatusChangedEnvelope,
      description:
        'Emitted when a ticket status changes. `data.previous_status_id` / `previous_status_name` are populated.',
    },
    {
      event: 'ticket.assigned',
      envelope: TicketAssignedEnvelope,
      description:
        'Emitted when a ticket assignment changes (assigned_to or assigned_team_id).',
    },
    {
      event: 'ticket.closed',
      envelope: TicketClosedEnvelope,
      description:
        'Emitted when a ticket transitions to a closed status. `data.is_closed` is true and `data.closed_at` is set.',
    },
    {
      event: 'ticket.comment.added',
      envelope: TicketCommentAddedEnvelope,
      description:
        'Emitted when a comment is added to a ticket. `data.comment` carries the new comment block; attachments are never included.',
    },
  ];

  for (const def of outboundDefs) {
    registry.registerWebhook({
      method: 'post',
      path: def.event,
      summary: `Outbound delivery: ${def.event}`,
      description: `${def.description} Delivered with HMAC-SHA256 signature header X-Alga-Signature, and the X-Alga-* metadata headers. Retried with backoff (1m, 5m, 30m, 2h, 12h) before being abandoned.`,
      tags: [tag],
      request: {
        headers: WebhookOutboundHeaders,
        body: { schema: def.envelope, description: 'Signed JSON envelope.' },
      },
      responses: {
        200: { description: 'Endpoint accepted the delivery (any 2xx is treated as success).' },
        410: {
          description: 'Endpoint indicates the resource is permanently gone; webhook will be auto-disabled.',
        },
      },
      extensions: {
        'x-alga-event-type': def.event,
        'x-rbac-resource': 'webhook',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Route registration
  // ---------------------------------------------------------------------------

  const commonExtensions = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'x-api-key validated in ApiWebhookController.authenticate()',
    'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
    'x-rbac-resource': 'webhook',
  };

  type ResponseSpec = ApiResponseSpec;

  function requestFor(path: string, handler: string) {
    const req: Record<string, unknown> = {};

    if (path.includes('{id}/deliveries/{delivery_id}')) {
      req.params = WebhookDeliveryParams;
    } else if (path.includes('{id}')) {
      req.params = WebhookIdParam;
    }

    if (handler === 'list') req.query = WebhookListQuery;
    if (handler === 'getAnalytics' || handler === 'getWebhookAnalytics') {
      req.query = WebhookAnalyticsQuery;
    }
    if (handler === 'getDeliveries') req.query = WebhookDeliveryQuery;

    if (handler === 'create') req.body = { schema: CreateWebhookBody };
    if (handler === 'update') req.body = { schema: CreateWebhookBody.partial() };
    if (handler === 'test' || handler === 'testById') req.body = { schema: WebhookTestBody };
    if (handler === 'createTemplate') req.body = { schema: WebhookTemplateBody };
    if (handler === 'useTemplate') req.body = { schema: WebhookTemplateCreateBody };
    if (handler === 'verifySignature') req.body = { schema: WebhookSignatureBody };

    return req;
  }

  function responsesFor(handler: string, successResponse: ResponseSpec): Record<number, ResponseSpec> {
    const responses: Record<number, ResponseSpec> = {
      400: { description: 'Invalid request payload, query, or webhook id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user missing.', schema: ApiError },
      403: { description: 'Webhook RBAC permission denied.', schema: ApiError },
      500: { description: 'Unexpected webhook operation failure.', schema: ApiError },
    };

    // 404 surface
    if (
      [
        'getById',
        'update',
        'delete',
        'testById',
        'getDeliveries',
        'getDelivery',
        'retryDelivery',
        'getWebhookAnalytics',
        'getHealth',
        'rotateSecret',
        'getSubscriptions',
        'verifySignature',
        'useTemplate',
      ].includes(handler)
    ) {
      responses[404] = { description: 'Webhook, delivery, template, or signing secret not found.', schema: ApiError };
    }

    if (handler === 'create') {
      responses[409] = { description: 'Webhook already exists.', schema: ApiError };
    }

    const code =
      handler === 'delete'
        ? 204
        : ['create', 'createTemplate', 'useTemplate'].includes(handler)
          ? 201
          : 200;

    responses[code] = successResponse;
    return responses;
  }

  type RouteDef = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    handler: string;
    action: string;
    summary: string;
    description: string;
    success: ResponseSpec;
    extraExtensions?: Record<string, unknown>;
  };

  const defs: RouteDef[] = [
    {
      method: 'get',
      path: '/api/v1/webhooks',
      handler: 'list',
      action: 'read',
      summary: 'List webhooks',
      description: 'Lists tenant webhooks with pagination and filter query fields.',
      success: { description: 'Paginated webhook list.', schema: WebhookListResponse },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks',
      handler: 'create',
      action: 'create',
      summary: 'Create webhook',
      description:
        'Creates a webhook configuration. Supports per-entity payload_fields allowlists; an undefined or null map yields the full payload.',
      success: { description: 'Webhook created.', schema: WebhookEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/analytics',
      handler: 'getAnalytics',
      action: 'analytics',
      summary: 'Get system webhook analytics',
      description: 'Returns aggregated webhook delivery analytics for the tenant over a date window.',
      success: { description: 'Aggregated analytics returned.', schema: WebhookAnalyticsEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/events',
      handler: 'listEvents',
      action: 'read',
      summary: 'List available webhook events',
      description:
        'Returns the supported webhook event types from webhookEventTypeSchema (ticket.*, project.*, invoice.*, etc.).',
      success: { description: 'Event type list.', schema: WebhookEventListEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/templates',
      handler: 'listTemplates',
      action: 'read',
      summary: 'List webhook templates',
      description: 'Returns webhook templates visible to the tenant (own + system templates).',
      success: { description: 'Template list.', schema: WebhookTemplateListEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/templates',
      handler: 'createTemplate',
      action: 'system_settings',
      summary: 'Create webhook template',
      description: 'Creates a reusable webhook template. Requires system_settings RBAC.',
      success: { description: 'Template created.', schema: WebhookTemplateEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/templates/{id}',
      handler: 'getById',
      action: 'read',
      summary: 'Get webhook template detail (webhook getById wiring)',
      description:
        'Template detail route delegates to ApiWebhookController.getById() and looks up rows from the webhooks table by the URL id, not webhook_templates. Calling with a true template_id will return 404.',
      success: { description: 'Webhook detail returned.', schema: WebhookEnvelope },
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-method': 'ApiWebhookController.getById()' },
    },
    {
      method: 'put',
      path: '/api/v1/webhooks/templates/{id}',
      handler: 'update',
      action: 'update',
      summary: 'Update webhook template (webhook update wiring)',
      description:
        'Template update route delegates to ApiWebhookController.update() and operates on webhooks rows, not webhook_templates.',
      success: { description: 'Webhook updated.', schema: WebhookEnvelope },
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-method': 'ApiWebhookController.update()' },
    },
    {
      method: 'delete',
      path: '/api/v1/webhooks/templates/{id}',
      handler: 'delete',
      action: 'delete',
      summary: 'Delete webhook template (webhook delete wiring)',
      description:
        'Template delete route delegates to ApiWebhookController.delete() and removes a webhooks row, not a webhook_templates row.',
      success: { description: 'Webhook deleted.', emptyBody: true },
      extraExtensions: { 'x-route-to-controller-mismatch': true, 'x-controller-method': 'ApiWebhookController.delete()' },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/templates/{id}/create',
      handler: 'useTemplate',
      action: 'create',
      summary: 'Create webhook from template',
      description: 'Instantiates a webhook configuration from a template, merging caller-supplied overrides.',
      success: { description: 'Webhook created from template.', schema: WebhookEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/test',
      handler: 'test',
      action: 'test',
      summary: 'Test webhook configuration',
      description:
        'Sends a one-off test delivery. Pass webhook_id to reuse stored configuration, or override_url/test_payload for ad-hoc testing.',
      success: { description: 'Test delivery executed.', schema: WebhookTestResultEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/verify',
      handler: 'verifySignature',
      action: 'verify',
      summary: 'Verify webhook signature',
      description:
        'Verifies an X-Alga-Signature header value against a stored signing secret. Returns { valid: true } only for sha256 with a matching v1 signature.',
      success: { description: 'Signature verification result.', schema: WebhookSignatureValidationEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/{id}',
      handler: 'getById',
      action: 'read',
      summary: 'Get webhook',
      description: 'Returns a single webhook by id.',
      success: { description: 'Webhook detail.', schema: WebhookEnvelope },
    },
    {
      method: 'put',
      path: '/api/v1/webhooks/{id}',
      handler: 'update',
      action: 'update',
      summary: 'Update webhook',
      description: 'Updates a webhook by id. Body accepts the same fields as create, all optional.',
      success: { description: 'Webhook updated.', schema: WebhookEnvelope },
    },
    {
      method: 'delete',
      path: '/api/v1/webhooks/{id}',
      handler: 'delete',
      action: 'delete',
      summary: 'Delete webhook',
      description: 'Deletes a webhook by id.',
      success: { description: 'Webhook deleted.', emptyBody: true },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/{id}/analytics',
      handler: 'getWebhookAnalytics',
      action: 'analytics',
      summary: 'Get webhook analytics',
      description: 'Returns delivery analytics for a single webhook over a date window.',
      success: { description: 'Per-webhook analytics returned.', schema: WebhookAnalyticsEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/{id}/deliveries',
      handler: 'getDeliveries',
      action: 'read',
      summary: 'List webhook deliveries',
      description: 'Returns paginated delivery history for a webhook id, optionally filtered by status and date window.',
      success: { description: 'Paginated delivery list.', schema: WebhookDeliveryListResponse },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/{id}/deliveries/{delivery_id}',
      handler: 'getDelivery',
      action: 'read',
      summary: 'Get delivery detail',
      description: 'Returns a single delivery record (request/response payloads, status, retry pointer).',
      success: { description: 'Delivery detail returned.', schema: WebhookDeliveryEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/{id}/deliveries/{delivery_id}/retry',
      handler: 'retryDelivery',
      action: 'retry',
      summary: 'Retry delivery',
      description: 'Re-sends a previously failed delivery and records a new attempt on the same delivery row.',
      success: { description: 'Retry attempted.', schema: WebhookDeliveryEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/{id}/health',
      handler: 'getHealth',
      action: 'read',
      summary: 'Get webhook health',
      description:
        'Derives status (healthy | failing | disabled), success_rate, and last delivery timestamps from the webhook stats counters.',
      success: { description: 'Health status returned.', schema: WebhookHealthEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/{id}/secret/rotate',
      handler: 'rotateSecret',
      action: 'manage_security',
      summary: 'Rotate webhook secret',
      description:
        'Generates a new 32-byte base64url signing secret, persists it via webhookModel.update, and returns the secret in the response. The secret is only available at rotation time.',
      success: { description: 'Secret rotated.', schema: WebhookSecretRotationEnvelope },
    },
    {
      method: 'get',
      path: '/api/v1/webhooks/{id}/subscriptions',
      handler: 'getSubscriptions',
      action: 'read',
      summary: 'List webhook event subscriptions',
      description:
        'Returns the event types the webhook is subscribed to. Subscriptions are stored on the webhooks row (event_types column), not in a separate subscription table.',
      success: { description: 'Subscription list returned.', schema: WebhookSubscriptionsEnvelope },
    },
    {
      method: 'post',
      path: '/api/v1/webhooks/{id}/test',
      handler: 'testById',
      action: 'test',
      summary: 'Test webhook by id',
      description:
        'Sends a signed test delivery to the webhook URL using the stored signing secret and records the attempt in webhook_deliveries with is_test=true.',
      success: { description: 'Test delivery executed.', schema: WebhookTestResultEnvelope },
    },
  ];

  for (const def of defs) {
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: requestFor(def.path, def.handler),
      responses: responsesFor(def.handler, def.success),
      extensions: {
        ...commonExtensions,
        'x-rbac-action': def.action,
        'x-controller-method': `ApiWebhookController.${def.handler}()`,
        ...(def.extraExtensions || {}),
      },
      edition: 'both',
    });
  }
}
