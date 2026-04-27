import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAuthRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Auth';

  registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'Auth.js JWE session token',
  });

  registry.registerComponent('securitySchemes', 'SessionCookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'authjs.session-token',
    description:
      'Auth.js session cookie. In secure production deployments the cookie may be named __Secure-authjs.session-token; in local development it may include a port suffix.',
  });

  const OAuthHtmlResponse = registry.registerSchema(
    'OAuthCallbackHtmlResponse',
    zOpenApi.string().describe(
      'HTML popup callback page. The page posts a JSON oauth-callback message to window.opener or window.parent via postMessage, then attempts to close itself.',
    ),
  );

  const OAuthCallbackQuery = registry.registerSchema(
    'OAuthCallbackQuery',
    zOpenApi.object({
      code: zOpenApi
        .string()
        .optional()
        .describe('OAuth 2.0 authorization code. Required unless the provider returned error.'),
      state: zOpenApi
        .string()
        .optional()
        .describe(
          'Base64-encoded JSON state object generated when the OAuth flow was initiated. It carries tenant context, providerId, redirectUri, timestamp, and nonce values used to complete the callback.',
        ),
      error: zOpenApi
        .string()
        .optional()
        .describe('OAuth error code returned by the provider, such as access_denied.'),
      error_description: zOpenApi
        .string()
        .optional()
        .describe('Human-readable OAuth error description returned by the provider.'),
    }),
  );

  const AuthSessionUser = registry.registerSchema(
    'AuthSessionUser',
    zOpenApi.object({
      id: zOpenApi.string().describe('User identifier from the users.user_id record.'),
      email: zOpenApi.string().email().describe("User's email address."),
      name: zOpenApi.string().describe("User's display name, usually first_name plus last_name."),
      username: zOpenApi.string().describe("User's login username."),
      image: zOpenApi.string().optional().describe('Avatar or profile image URL.'),
      proToken: zOpenApi.string().optional().describe('Legacy Pro token value when present.'),
      tenant: zOpenApi.string().optional().describe('Tenant UUID from the user session JWT.'),
      tenantSlug: zOpenApi.string().optional().describe('URL-safe tenant slug for portal routing.'),
      user_type: zOpenApi
        .enum(['client', 'internal'])
        .optional()
        .describe('User classification from users.user_type.'),
      clientId: zOpenApi
        .string()
        .uuid()
        .optional()
        .describe('Client UUID from contacts.client_id for client-portal users.'),
      contactId: zOpenApi
        .string()
        .uuid()
        .optional()
        .describe('Contact UUID from users.contact_id for client-portal users.'),
      plan: zOpenApi.string().optional().describe('Current tenant billing plan key.'),
      addons: zOpenApi.array(zOpenApi.string()).optional().describe('Enabled tenant add-on keys.'),
      trial_end: zOpenApi.string().nullable().optional().describe('Trial expiry timestamp when present.'),
      subscription_status: zOpenApi
        .enum(['active', 'trialing', 'past_due', 'unpaid'])
        .nullable()
        .optional()
        .describe('Billing subscription status copied into the session token.'),
      solo_pro_trial_end: zOpenApi
        .string()
        .nullable()
        .optional()
        .describe('Solo Pro trial expiry timestamp when present.'),
      premium_trial_end: zOpenApi
        .string()
        .nullable()
        .optional()
        .describe('Premium trial expiry timestamp when present.'),
      premium_trial_confirmed: zOpenApi
        .boolean()
        .optional()
        .describe('Whether the user confirmed the Premium trial.'),
      premium_trial_effective_date: zOpenApi
        .string()
        .nullable()
        .optional()
        .describe('Premium trial effective date when present.'),
    }),
  );

  const AuthSessionAuthenticatedResponse = registry.registerSchema(
    'AuthSessionAuthenticatedResponse',
    zOpenApi.object({
      session_id: zOpenApi
        .string()
        .uuid()
        .optional()
        .describe('Current session UUID from the sessions table, created at sign-in.'),
      login_method: zOpenApi
        .string()
        .optional()
        .describe('Authentication method used for this session, such as credentials, google, or azure-ad.'),
      user: AuthSessionUser,
    }),
  );

  const EmptyObjectResponse = registry.registerSchema(
    'EmptyObjectResponse',
    zOpenApi.object({}).strict().describe('Empty object returned when no authenticated session is present.'),
  );

  const AuthSessionResponse = registry.registerSchema(
    'AuthSessionResponse',
    zOpenApi.union([AuthSessionAuthenticatedResponse, EmptyObjectResponse]).describe(
      'Authenticated session data, or an empty object when the request has no valid session cookie.',
    ),
  );

  const FlatErrorResponse = registry.registerSchema(
    'FlatErrorResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Human-readable error message.'),
    }),
  );

  const ValidateApiKeyHeaders = registry.registerSchema(
    'ValidateApiKeyHeaders',
    zOpenApi.object({
      'x-api-key': zOpenApi
        .string()
        .min(1)
        .describe('Plaintext API key to validate. The service hashes this value before looking up the api_keys record.'),
    }),
  );

  const ValidateApiKeyResponse = registry.registerSchema(
    'ValidateApiKeyResponse',
    zOpenApi.object({
      isValid: zOpenApi.literal(true).describe('Indicates that the API key is active and valid.'),
      userId: zOpenApi
        .string()
        .uuid()
        .describe('UUID of the user who owns the API key, from api_keys.user_id.'),
      tenant: zOpenApi.string().describe('Tenant identifier scoped to this API key, from api_keys.tenant.'),
    }),
  );

  const ValidateTokenHeaders = registry.registerSchema(
    'ValidateTokenHeaders',
    zOpenApi.object({
      authorization: zOpenApi
        .string()
        .optional()
        .describe('Optional Bearer token fallback. The route also accepts the Auth.js session token cookie.'),
    }),
  );

  const ValidateTokenSuccessResponse = registry.registerSchema(
    'ValidateTokenSuccessResponse',
    zOpenApi.object({
      isValid: zOpenApi.literal(true).describe('Indicates that the request contains a valid Auth.js session token.'),
      userType: zOpenApi
        .enum(['internal', 'client'])
        .describe('User classification from users.user_type in the session JWT.'),
      tenant: zOpenApi.string().describe('Tenant identifier from the session JWT.'),
    }),
  );

  const ValidateTokenUnauthorizedResponse = registry.registerSchema(
    'ValidateTokenUnauthorizedResponse',
    zOpenApi.object({
      isValid: zOpenApi.literal(false).describe('No valid session token was found.'),
    }),
  );

  const NextAuthCatchAllParams = registry.registerSchema(
    'NextAuthCatchAllParams',
    zOpenApi.object({
      nextauth: zOpenApi
        .string()
        .describe(
          'NextAuth catch-all action path. Common values include csrf, providers, signin, signout, session, error, verify-request, webauthn-options, callback/credentials, callback/google, callback/azure-ad, and callback/keycloak.',
        ),
    }),
  );

  const NextAuthGetQuery = registry.registerSchema(
    'NextAuthGetQuery',
    zOpenApi.object({
      callbackUrl: zOpenApi
        .string()
        .optional()
        .describe('Optional URL to redirect to after sign-in or sign-out flows.'),
      error: zOpenApi
        .string()
        .optional()
        .describe('Optional NextAuth/OAuth error code shown by sign-in or error pages.'),
      code: zOpenApi
        .string()
        .optional()
        .describe('OAuth authorization code for provider callback sub-routes.'),
      state: zOpenApi
        .string()
        .optional()
        .describe('OAuth state value for provider callback sub-routes.'),
      error_description: zOpenApi
        .string()
        .optional()
        .describe('Human-readable provider error description for OAuth callback sub-routes.'),
    }),
  );

  const CsrfTokenResponse = registry.registerSchema(
    'CsrfTokenResponse',
    zOpenApi.object({
      csrfToken: zOpenApi
        .string()
        .describe('Opaque double-submit CSRF token required for mutating NextAuth POST actions.'),
    }),
  );

  const ProviderInfo = registry.registerSchema(
    'ProviderInfo',
    zOpenApi.object({
      id: zOpenApi.string().describe('Provider identifier such as credentials, google, azure-ad, or keycloak.'),
      name: zOpenApi.string().describe('Provider display name.'),
      type: zOpenApi
        .enum(['oauth', 'oidc', 'credentials', 'email', 'webauthn'])
        .describe('NextAuth provider type.'),
      signinUrl: zOpenApi.string().describe('URL used to initiate sign-in with this provider.'),
      callbackUrl: zOpenApi.string().describe('URL the provider redirects to after authentication.'),
    }),
  );

  const AuthProvidersResponse = registry.registerSchema(
    'AuthProvidersResponse',
    zOpenApi.record(zOpenApi.string(), ProviderInfo).describe('Map of configured providers keyed by provider ID.'),
  );

  const NextAuthGetResponse = registry.registerSchema(
    'NextAuthGetResponse',
    zOpenApi
      .union([AuthSessionResponse, CsrfTokenResponse, AuthProvidersResponse, OAuthHtmlResponse, EmptyObjectResponse])
      .describe(
        'Representative successful GET response for the NextAuth catch-all route. The exact payload depends on the nextauth action: session returns a session object or {}, csrf returns csrfToken, providers returns a provider map, and page actions return HTML or redirects.',
      ),
  );

  const NextAuthPostBody = registry.registerSchema(
    'NextAuthPostBody',
    zOpenApi.object({
      email: zOpenApi.string().email().optional().describe('Credentials-provider email address for callback/credentials.'),
      password: zOpenApi.string().optional().describe('Credentials-provider plaintext password for callback/credentials.'),
      twoFactorCode: zOpenApi
        .string()
        .optional()
        .describe('TOTP code required when two-factor authentication is enabled and the device is not trusted.'),
      userType: zOpenApi
        .enum(['client', 'internal'])
        .optional()
        .describe('Optional user type used to scope credentials-provider lookup.'),
      tenant: zOpenApi
        .string()
        .optional()
        .describe('Optional tenant slug used to resolve the tenant for credentials-provider login.'),
      csrfToken: zOpenApi
        .string()
        .optional()
        .describe('CSRF token from GET /api/auth/csrf. Required for sign-in, sign-out, and other mutating NextAuth actions.'),
      callbackUrl: zOpenApi.string().optional().describe('Post-authentication redirect URL.'),
      redirect: zOpenApi.string().optional().describe('NextAuth redirect mode flag.'),
      json: zOpenApi.string().optional().describe('NextAuth JSON response mode flag.'),
      code: zOpenApi.string().optional().describe('OAuth authorization code for provider callback actions.'),
      state: zOpenApi.string().optional().describe('OAuth state value for provider callback actions.'),
      error: zOpenApi.string().optional().describe('Provider OAuth error code for callback actions.'),
      error_description: zOpenApi
        .string()
        .optional()
        .describe('Provider OAuth error description for callback actions.'),
    }),
  );

  const RedirectResponse = registry.registerSchema(
    'RedirectResponse',
    zOpenApi.string().describe('HTTP redirect response. NextAuth sets or clears cookies depending on the action.'),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/auth/google/callback',
    summary: 'Handle Google OAuth callback',
    description:
      'Browser popup callback for the Gmail email-provider OAuth flow. Google redirects here with an authorization code and state. The handler decodes the state to find the tenant and email provider, exchanges the code for Google access and refresh tokens, stores them on the provider configuration, marks the provider connected, and may provision Gmail watch/Pub/Sub resources. This endpoint is public and protected by the OAuth state parameter; it always responds with text/html that posts the success or error payload to the opener window rather than returning JSON.',
    tags: [tag],
    security: [],
    request: {
      query: OAuthCallbackQuery,
    },
    responses: {
      200: {
        description:
          'HTML popup callback page. The embedded postMessage payload reports success, provider=google, token expiry, and echoed code/state, or an OAuth/configuration/token-exchange error.',
        contentType: 'text/html',
        schema: OAuthHtmlResponse,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/auth/microsoft/callback',
    summary: 'Handle Microsoft OAuth callback',
    description:
      'Browser popup callback for the Microsoft Graph email-provider OAuth flow. Microsoft redirects here with an authorization code and state. The handler decodes tenant/provider context from state, resolves the tenant Microsoft profile credentials, exchanges the code for Microsoft Graph tokens, stores them on the email provider, marks the provider connected, and best-effort registers a Graph webhook subscription. This endpoint is public and protected by the OAuth state parameter; it always responds with text/html that posts the success or error payload to the opener window rather than returning JSON.',
    tags: [tag],
    security: [],
    request: {
      query: OAuthCallbackQuery,
    },
    responses: {
      200: {
        description:
          'HTML popup callback page. The embedded postMessage payload reports success, provider=microsoft, token expiry, and echoed code/state, or an OAuth/configuration/token-exchange error.',
        contentType: 'text/html',
        schema: OAuthHtmlResponse,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/auth/{nextauth}',
    summary: 'Handle NextAuth GET action',
    description:
      'Catch-all Auth.js/NextAuth GET endpoint. The nextauth path segment selects the action: csrf returns a CSRF token and sets the CSRF cookie, providers returns configured provider metadata, session returns the current session or {}, signin/signout/error/verify-request render or redirect to configured pages, and callback/{provider} handles OAuth provider redirects. This route is the authentication surface itself and does not require API-key authentication.',
    tags: [tag],
    security: [],
    request: {
      params: NextAuthCatchAllParams,
      query: NextAuthGetQuery,
    },
    responses: {
      200: {
        description:
          'Successful JSON or HTML response for the selected NextAuth action. Examples include { csrfToken }, provider maps, session objects, {}, or built-in HTML pages.',
        schema: NextAuthGetResponse,
      },
      302: {
        description: 'Redirect to the configured sign-in, sign-out, callback, or error destination.',
        schema: RedirectResponse,
      },
      404: {
        description: 'No content when a built-in action is unavailable or disabled.',
        emptyBody: true,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/auth/{nextauth}',
    summary: 'Handle NextAuth POST action',
    description:
      'Catch-all Auth.js/NextAuth POST endpoint. The nextauth path segment selects the action: callback/credentials authenticates email and password credentials, callback/{provider} handles OAuth callback form posts, signout clears the current session, session returns or updates session data, and csrf returns a CSRF token. Mutating actions require the csrfToken body field matching the Auth.js CSRF cookie. Credential success sets the encrypted Auth.js session cookie and redirects; failures typically redirect to /auth/signin with an error code.',
    tags: [tag],
    security: [],
    request: {
      params: NextAuthCatchAllParams,
      body: {
        contentType: 'application/x-www-form-urlencoded',
        description: 'Form fields consumed by the selected NextAuth POST action.',
        schema: NextAuthPostBody,
      },
    },
    responses: {
      200: {
        description: 'JSON response for session or csrf POST actions.',
        schema: zOpenApi.union([AuthSessionResponse, CsrfTokenResponse, EmptyObjectResponse]),
      },
      302: {
        description: 'Redirect after sign-in, OAuth callback, sign-out, or error handling. Session cookies may be set or cleared.',
        schema: RedirectResponse,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/auth/session',
    summary: 'Get current Auth.js session',
    description:
      'Returns the current Auth.js/NextAuth session by reading the session cookie and running the full auth handler, including session revocation checks. Authenticated responses include the user profile, tenant context, session_id from the sessions table, and login method. If no valid session cookie is present, the route still returns HTTP 200 with an empty object.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    responses: {
      200: {
        description: 'Authenticated session object, or {} when the request is unauthenticated.',
        schema: AuthSessionResponse,
      },
      500: {
        description: 'Unexpected session retrieval failure.',
        schema: FlatErrorResponse,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/auth/validate-api-key',
    summary: 'Validate API key',
    description:
      'Validates a plaintext API key supplied in the x-api-key header. The key is hashed before lookup. If the api_keys record exists, is active, has not expired, and has not exhausted its usage limit, the response returns the owning user UUID and tenant from that record. This route is the credential validation endpoint itself and does not require a separate session, tenant header, or RBAC permission.',
    tags: [tag],
    security: [],
    request: {
      headers: ValidateApiKeyHeaders,
    },
    responses: {
      200: {
        description: 'API key is valid and active.',
        schema: ValidateApiKeyResponse,
      },
      401: {
        description: 'The x-api-key header is missing, or the key is invalid, inactive, expired, or usage-exhausted.',
        schema: FlatErrorResponse,
      },
      500: {
        description: 'Unexpected error while validating the API key.',
        schema: FlatErrorResponse,
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/auth/validate-token',
    summary: 'Validate session token',
    description:
      'Checks whether the request carries a valid Auth.js session token, either in the session cookie or in an Authorization: Bearer header. A valid token returns the user type and tenant copied from the session JWT. No request body is read.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }, { BearerAuth: [] }],
    request: {
      headers: ValidateTokenHeaders,
    },
    responses: {
      200: {
        description: 'Session token is valid.',
        schema: ValidateTokenSuccessResponse,
      },
      401: {
        description: 'No valid session token was found.',
        schema: ValidateTokenUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected token validation error.',
        schema: FlatErrorResponse,
      },
    },
    edition: 'both',
  });

  // Keeps the shared error component reachable from this registrar for generators
  // that prune unused imports during future refactors.
  void deps.ErrorResponse;
}
