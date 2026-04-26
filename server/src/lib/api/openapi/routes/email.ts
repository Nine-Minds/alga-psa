import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerEmailRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Email';

  registry.registerComponent('securitySchemes', 'GooglePubSubJWT', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'Google Pub/Sub JWT',
    description:
      'Google-signed JWT from Pub/Sub push. The webhook validates the audience against the webhook URL and checks the issuer/service account against tenant Google configuration.',
  });

  const EmailErrorResponse = registry.registerSchema(
    'EmailErrorResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Human-readable error message.'),
      success: zOpenApi.boolean().optional().describe('Present on some failure responses.'),
      retryable: zOpenApi.boolean().optional().describe('Whether a webhook sender should retry the request.'),
    }),
  );

  const EmailOAuthInitiateRequest = registry.registerSchema(
    'EmailOAuthInitiateRequest',
    zOpenApi.object({
      provider: zOpenApi
        .enum(['microsoft', 'google'])
        .describe('Email OAuth provider to authorize.'),
      redirectUri: zOpenApi
        .string()
        .url()
        .optional()
        .describe('Optional OAuth callback URI. If omitted, the server builds /api/auth/{provider}/callback from the configured base URL.'),
      providerId: zOpenApi
        .string()
        .uuid()
        .optional()
        .describe('Email provider configuration ID to carry through OAuth state and use during callback token persistence.'),
    }),
  );

  const EmailOAuthInitiateResponse = registry.registerSchema(
    'EmailOAuthInitiateResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('OAuth initiation succeeded.'),
      authUrl: zOpenApi.string().url().describe('Provider authorization URL for the browser to visit.'),
      provider: zOpenApi.enum(['microsoft', 'google']).describe('Email OAuth provider being authorized.'),
      state: zOpenApi
        .string()
        .describe('Base64-encoded OAuth state containing tenant, userId, providerId, redirectUri, timestamp, nonce, and hosted flag.'),
    }),
  );

  const EmailOAuthState = registry.registerSchema(
    'EmailOAuthState',
    zOpenApi.object({
      tenant: zOpenApi.string().describe('Tenant identifier from the authenticated user session.'),
      userId: zOpenApi.string().optional().describe('User UUID from the authenticated session.'),
      providerId: zOpenApi.string().uuid().optional().describe('Email provider configuration UUID from the initiate request.'),
      redirectUri: zOpenApi.string().describe('OAuth redirect URI included in the authorization request.'),
      timestamp: zOpenApi.number().describe('Epoch milliseconds when state was generated.'),
      nonce: zOpenApi.string().describe('Random hex nonce for CSRF correlation.'),
      hosted: zOpenApi.boolean().optional().describe('Whether hosted credentials are used for the flow.'),
    }),
  );

  const EmailRefreshWatchRequest = registry.registerSchema(
    'EmailRefreshWatchRequest',
    zOpenApi.object({
      providerId: zOpenApi
        .string()
        .uuid()
        .describe('Active Gmail email provider ID from email_providers.id to refresh.'),
    }),
  );

  const EmailRefreshWatchResponse = registry.registerSchema(
    'EmailRefreshWatchResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Refresh completed successfully.'),
      message: zOpenApi.string().describe('Human-readable success message.'),
      providerId: zOpenApi.string().uuid().describe('Email provider ID that was refreshed.'),
      mailbox: zOpenApi.string().email().describe('Mailbox address for the Gmail provider.'),
    }),
  );

  const GooglePubSubMessage = registry.registerSchema(
    'GooglePubSubMessage',
    zOpenApi.object({
      data: zOpenApi
        .string()
        .describe('Base64-encoded Gmail notification JSON containing emailAddress and historyId.'),
      messageId: zOpenApi.string().describe('Google Pub/Sub message ID.'),
      publishTime: zOpenApi.string().describe('ISO timestamp when Pub/Sub published the message.'),
    }),
  );

  const GooglePubSubPushBody = registry.registerSchema(
    'GooglePubSubPushBody',
    zOpenApi.object({
      message: GooglePubSubMessage,
      subscription: zOpenApi
        .string()
        .describe('Full Pub/Sub subscription path, such as projects/{project}/subscriptions/{subscriptionName}.'),
    }),
  );

  const GmailNotificationPayload = registry.registerSchema(
    'GmailNotificationPayload',
    zOpenApi.object({
      emailAddress: zOpenApi.string().email().describe('Gmail mailbox address with new activity.'),
      historyId: zOpenApi.string().describe('Gmail history ID indicating the mailbox change position.'),
    }),
  );

  const GoogleWebhookEnqueueResponse = registry.registerSchema(
    'GoogleWebhookEnqueueResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Webhook was accepted.'),
      queued: zOpenApi.literal(true).describe('The notification was enqueued for asynchronous processing.'),
      handoff: zOpenApi
        .literal('unified_pointer_queue')
        .describe('Queue handoff mechanism used for the Gmail notification pointer.'),
      providerId: zOpenApi.string().uuid().describe('Resolved email_providers.id for the Gmail mailbox.'),
      tenant: zOpenApi.string().describe('Tenant identifier owning the provider.'),
      historyId: zOpenApi.string().describe('Gmail history ID from the decoded notification.'),
      jobId: zOpenApi.string().uuid().describe('UUID assigned to the Redis queue job.'),
      queueDepth: zOpenApi.number().int().describe('Redis queue depth after enqueue.'),
    }),
  );

  const GoogleWebhookSkippedResponse = registry.registerSchema(
    'GoogleWebhookSkippedResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Webhook request was accepted but no job was enqueued.'),
      message: zOpenApi
        .enum(['No data to process', 'No provider found', 'No google config found'])
        .describe('Reason the webhook did not enqueue work.'),
    }),
  );

  const MicrosoftWebhookValidationQuery = registry.registerSchema(
    'MicrosoftWebhookValidationQuery',
    zOpenApi.object({
      validationtoken: zOpenApi
        .string()
        .optional()
        .describe('Microsoft Graph subscription validation token. The handler also accepts validationToken with camel-case spelling.'),
      validationToken: zOpenApi
        .string()
        .optional()
        .describe('Camel-case variant of the Microsoft Graph validation token.'),
    }),
  );

  const MicrosoftWebhookTextResponse = registry.registerSchema(
    'MicrosoftWebhookTextResponse',
    zOpenApi
      .string()
      .describe('Plain text response. For validation requests, this is the validation token echoed verbatim; otherwise it may be OK or Internal Server Error.'),
  );

  const MicrosoftGraphResourceData = registry.registerSchema(
    'MicrosoftGraphResourceData',
    zOpenApi.object({
      '@odata.type': zOpenApi.string().optional().describe('OData resource type, such as #microsoft.graph.message.'),
      '@odata.id': zOpenApi.string().optional().describe('OData resource identifier.'),
      id: zOpenApi.string().optional().describe('Microsoft Graph message ID. If absent, the handler extracts it from resource.'),
      subject: zOpenApi.string().optional().describe('Optional message subject supplied by Microsoft Graph.'),
    }),
  );

  const MicrosoftGraphNotification = registry.registerSchema(
    'MicrosoftGraphNotification',
    zOpenApi.object({
      changeType: zOpenApi.string().describe('Microsoft Graph change type, typically created for new mail.'),
      clientState: zOpenApi
        .string()
        .optional()
        .describe('Opaque verification token that must match microsoft_email_provider_config.webhook_verification_token when configured.'),
      resource: zOpenApi.string().describe('Graph resource path, for example /users/{userId}/messages/{messageId}.'),
      resourceData: MicrosoftGraphResourceData,
      subscriptionExpirationDateTime: zOpenApi.string().optional().describe('Microsoft Graph subscription expiry timestamp.'),
      subscriptionId: zOpenApi
        .string()
        .describe('Microsoft Graph subscription ID. Used to resolve microsoft_email_provider_config.webhook_subscription_id.'),
      tenantId: zOpenApi.string().optional().describe('Microsoft tenant GUID from the notification. Informational only; tenant is resolved from DB.'),
    }),
  );

  const MicrosoftGraphWebhookBody = registry.registerSchema(
    'MicrosoftGraphWebhookBody',
    zOpenApi.object({
      value: zOpenApi.array(MicrosoftGraphNotification).describe('Batch of Microsoft Graph change notifications.'),
    }),
  );

  const MicrosoftWebhookSuccessResponse = registry.registerSchema(
    'MicrosoftWebhookSuccessResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Webhook request was processed successfully.'),
      queued: zOpenApi.boolean().describe('Whether any notification pointer jobs were enqueued.'),
      handoff: zOpenApi.literal('unified_pointer_queue').describe('Queue handoff mechanism used for Microsoft notification pointers.'),
      unifiedQueuedCount: zOpenApi.number().int().describe('Number of notification jobs enqueued.'),
      processedCount: zOpenApi.number().int().describe('Number of notifications processed.'),
      messageIds: zOpenApi.array(zOpenApi.string()).describe('Microsoft Graph message IDs that were enqueued.'),
    }),
  );

  const MicrosoftWebhookEmptyResponse = registry.registerSchema(
    'MicrosoftWebhookEmptyResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Webhook request was accepted.'),
      message: zOpenApi.string().describe('Reason no notification jobs were enqueued.'),
    }),
  );

  const MicrosoftWebhookEnqueueErrorResponse = registry.registerSchema(
    'MicrosoftWebhookEnqueueErrorResponse',
    zOpenApi.object({
      error: zOpenApi.literal('Failed to enqueue one or more Microsoft pointer jobs'),
      failureCount: zOpenApi.number().int().describe('Number of enqueue failures.'),
      failures: zOpenApi
        .array(zOpenApi.object({
          subscriptionId: zOpenApi.string().describe('Microsoft Graph subscription ID from the notification.'),
          messageId: zOpenApi.string().describe('Microsoft Graph message ID that failed to enqueue.'),
          providerId: zOpenApi.string().describe('Resolved email provider ID.'),
          tenantId: zOpenApi.string().describe('Resolved tenant identifier.'),
          reason: zOpenApi.string().describe('Failure reason.'),
        }))
        .describe('Per-notification enqueue failures.'),
    }),
  );

  const EmailWebhookTestRequest = registry.registerSchema(
    'EmailWebhookTestRequest',
    zOpenApi.object({
      provider: zOpenApi
        .enum(['microsoft', 'google'])
        .optional()
        .describe('Email provider type to simulate in the synthetic inbound email event. Defaults to microsoft.'),
      messageId: zOpenApi
        .string()
        .optional()
        .describe('Synthetic message identifier to include in the test event. Defaults to test-message-123.'),
    }),
  );

  const EmailWebhookTestResponse = registry.registerSchema(
    'EmailWebhookTestResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Test event was published successfully.'),
      message: zOpenApi.string().describe('Human-readable success message.'),
      eventId: zOpenApi.string().describe('Redis Streams event ID returned by publishEvent.'),
      tenant: zOpenApi.string().describe('Tenant identifier from the authenticated user session.'),
    }),
  );

  registry.registerRoute({
    method: 'post',
    path: '/api/email/oauth/initiate',
    summary: 'Initiate email OAuth flow',
    description:
      'Starts the OAuth 2.0 authorization flow for a Google or Microsoft email provider. Requires a valid Auth.js session cookie. The handler builds secure OAuth state containing tenant, user, providerId, redirect URI, timestamp, and nonce, resolves the provider client ID from configured secrets, and returns the authorization URL for the browser to visit.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      body: {
        schema: EmailOAuthInitiateRequest,
        description: 'Email OAuth initiation payload.',
      },
    },
    responses: {
      200: {
        description: 'OAuth authorization URL generated successfully.',
        schema: EmailOAuthInitiateResponse,
      },
      400: {
        description: 'Provider is missing or not supported.',
        schema: EmailErrorResponse,
      },
      401: {
        description: 'No authenticated user session was found.',
        schema: EmailErrorResponse,
      },
      500: {
        description: 'OAuth client ID was not configured or initiation failed unexpectedly.',
        schema: EmailErrorResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/email/refresh-watch',
    summary: 'Refresh Gmail watch registration',
    description:
      'Forces Pub/Sub setup and Gmail watch registration refresh for an active Google email provider. Requires a valid Auth.js session. The providerId must reference email_providers.id for a provider_type=google record with a google_email_provider_config row and project_id. Internally this calls configureGmailProvider with force=true.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      body: {
        schema: EmailRefreshWatchRequest,
        description: 'Gmail provider refresh request.',
      },
    },
    responses: {
      200: {
        description: 'Gmail provider Pub/Sub and watch registration refreshed successfully.',
        schema: EmailRefreshWatchResponse,
      },
      400: {
        description: 'providerId is missing, or the Gmail provider has no project_id configured.',
        schema: EmailErrorResponse,
      },
      401: {
        description: 'No authenticated user session was found.',
        schema: EmailErrorResponse,
      },
      404: {
        description: 'Gmail provider or Gmail configuration row was not found.',
        schema: EmailErrorResponse,
      },
      500: {
        description: 'Refresh failed unexpectedly. Response includes success=false and an error message.',
        schema: EmailErrorResponse,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'options',
    path: '/api/email/webhooks/google',
    summary: 'CORS preflight for Google email webhook',
    description:
      'CORS preflight response for the Gmail Pub/Sub webhook endpoint. This is handled by global middleware before route authentication or business logic. It does not require a session, API key, tenant, JWT, request body, or query parameter, and always returns 204 No Content with CORS headers.',
    tags: [tag],
    security: [],
    responses: {
      204: {
        description: 'CORS preflight accepted; response body is empty.',
        emptyBody: true,
      },
    },
    extensions: {
      'x-cors-preflight': true,
      'x-handled-by': 'middleware',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/email/webhooks/google',
    summary: 'Receive Google Gmail Pub/Sub webhook',
    description:
      'Receives Google Pub/Sub push notifications for Gmail watches. Standard session and API-key middleware are bypassed; the handler requires an Authorization: Bearer Google-signed JWT, decodes the Pub/Sub message data into a Gmail notification with emailAddress and historyId, resolves the tenant and email provider by subscription name or mailbox, validates Google configuration, and enqueues a pointer-only job into the unified inbound email queue. It does not fetch or return email content.',
    tags: [tag],
    security: [{ GooglePubSubJWT: [] }],
    request: {
      body: {
        schema: GooglePubSubPushBody,
        description: 'Google Pub/Sub push message containing a base64-encoded Gmail notification.',
      },
    },
    responses: {
      200: {
        description: 'Webhook accepted. Either a queue job was enqueued, or the notification was safely skipped.',
        schema: zOpenApi.union([GoogleWebhookEnqueueResponse, GoogleWebhookSkippedResponse]),
      },
      400: {
        description: 'Permanent parse or validation error; Pub/Sub should not retry.',
        schema: EmailErrorResponse,
      },
      401: {
        description: 'Bearer JWT is missing or invalid.',
        schema: EmailErrorResponse,
      },
      503: {
        description: 'Transient enqueue or processing failure; Pub/Sub may retry.',
        schema: EmailErrorResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-session-auth-skipped': true,
      'x-webhook-provider': 'google-pubsub',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/email/webhooks/microsoft',
    summary: 'Validate Microsoft email webhook subscription',
    description:
      'Microsoft Graph subscription validation endpoint. During subscription creation or renewal, Microsoft calls this endpoint with validationtoken or validationToken. The handler echoes the token verbatim as text/plain. If no token is provided, it returns OK. No session, API key, tenant header, or request body is required.',
    tags: [tag],
    security: [],
    request: {
      query: MicrosoftWebhookValidationQuery,
    },
    responses: {
      200: {
        description: 'Plain text validation token echo, or OK when no validation token is present.',
        contentType: 'text/plain',
        schema: MicrosoftWebhookTextResponse,
      },
      500: {
        description: 'Unexpected error while handling validation request.',
        contentType: 'text/plain',
        schema: MicrosoftWebhookTextResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-webhook-provider': 'microsoft-graph',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'options',
    path: '/api/email/webhooks/microsoft',
    summary: 'CORS preflight for Microsoft email webhook',
    description:
      'CORS preflight response for the Microsoft Graph email webhook endpoint. Global middleware intercepts OPTIONS before route logic and returns 204 No Content with CORS headers. No authentication, tenant, request body, query parameter, or database access is required.',
    tags: [tag],
    security: [],
    responses: {
      204: {
        description: 'CORS preflight accepted; response body is empty.',
        emptyBody: true,
      },
    },
    extensions: {
      'x-cors-preflight': true,
      'x-handled-by': 'middleware',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/email/webhooks/microsoft',
    summary: 'Receive Microsoft Graph email webhook',
    description:
      'Receives Microsoft Graph change notifications for monitored mailboxes. Standard session and API-key middleware are bypassed. The handler supports validation token echo, parses Microsoft notification batches, resolves provider and tenant by matching notification subscriptionId to microsoft_email_provider_config.webhook_subscription_id, validates clientState against the stored webhook_verification_token when configured, extracts message IDs, and enqueues pointer-only jobs into the unified inbound email queue. The tenantId in the Microsoft payload is informational and is not trusted for tenant resolution.',
    tags: [tag],
    security: [],
    request: {
      query: MicrosoftWebhookValidationQuery,
      body: {
        schema: MicrosoftGraphWebhookBody,
        description: 'Microsoft Graph webhook notification batch.',
      },
    },
    responses: {
      200: {
        description: 'Validation token echoed as text/plain, or JSON success response after notifications are processed or skipped.',
        schema: zOpenApi.union([MicrosoftWebhookSuccessResponse, MicrosoftWebhookEmptyResponse, MicrosoftWebhookTextResponse]),
      },
      500: {
        description: 'Unexpected internal server error.',
        schema: EmailErrorResponse,
      },
      503: {
        description: 'One or more notification pointers could not be enqueued.',
        schema: MicrosoftWebhookEnqueueErrorResponse,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-session-auth-skipped': true,
      'x-webhook-provider': 'microsoft-graph',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/email/webhooks/test',
    summary: 'Publish test inbound email event',
    description:
      'Publishes a synthetic INBOUND_EMAIL_RECEIVED event to the workflow event stream so operators can test webhook and workflow delivery without a real provider notification. Requires a valid Auth.js session; tenant is taken from the authenticated user session. The route performs no RBAC check and does not require an API key.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      body: {
        schema: EmailWebhookTestRequest,
        description: 'Optional synthetic email provider metadata for the test event.',
      },
    },
    responses: {
      200: {
        description: 'Test event was published successfully.',
        schema: EmailWebhookTestResponse,
      },
      401: {
        description: 'No authenticated user session was found.',
        schema: EmailErrorResponse,
      },
      500: {
        description: 'Failed to publish the test event.',
        schema: EmailErrorResponse,
      },
    },
    edition: 'both',
  });

  void EmailOAuthState;
  void GmailNotificationPayload;
}
