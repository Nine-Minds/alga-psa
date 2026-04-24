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

  void EmailOAuthState;
  void GmailNotificationPayload;
}
