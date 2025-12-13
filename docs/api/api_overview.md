# API Overview

> 👉 **New to our APIs?** Check out our [Getting Started Guide](api_getting_started_guide.md) for a quick introduction to using our APIs.

## 1. Introduction
This document outlines the design and architecture of the Alga PSA APIs. Our APIs are implemented using Next.js for the backend and take a REST-ish approach, leveraging Next.js API routes along with our existing actions system.

> 📝 **Note:** The Alga PSA hosted environment is available at `api.algapsa.com`. If you are running an on-premise installation, replace this with your configured domain.

## 2. API Editions

Our APIs are segmented into two editions:

### Community Edition (CE)
- Located in the `server/src/api/` directory
- Available in both CE and EE deployments
- Core functionality APIs
- Accessible to all deployments

### Enterprise Edition (EE)
- Located in the `ee/server/src/api/` directory
- Only available in EE deployments
- Advanced/premium features
- Current EE-only APIs:
  - Tenant Provisioning API (see [tenant_provisioning_api.md](tenant_provisioning_api.md))

The edition is controlled by the `EDITION` environment variable:
- `EDITION=community` for CE deployments
- `EDITION=enterprise` for EE deployments

## 3. Core Architecture
- **Technology Stack:**
  - **Next.js:** APIs are built using Next.js API routes, which integrate seamlessly into the existing Next.js application.
  - **Node.js:** Underlying runtime environment.
  - **Zod:** Used for schema validation of incoming requests.
  - **NextAuth Augmentation:** Our NextAuth integration (defined in `server/src/types/next-auth.ts`) includes extended fields such as `proToken`, `tenant`, and `user_type`. These fields support role/permission claims in the JWT for authorization via our RBAC infrastructure.
  - **Existing Actions:** APIs leverage existing server actions for business logic implementation.

## 4. Security Framework
- **Authentication:** 
  - API key-based authentication for all API endpoints
  - API keys are associated with specific users and tenants
  - Keys can be created, managed, and revoked through dedicated API endpoints
  - Middleware validates API keys and attaches user context
  - API keys can be set to expire and are automatically deactivated
  - API key management through server actions:
    - `createApiKey`: Create a new API key
    - `listApiKeys`: List all API keys for the current user
    - `deactivateApiKey`: Deactivate an API key
- **Authorization:**
  - Role-Based Access Control (RBAC) system integration
  - NextAuth configuration extends User, Session, and JWT types
  - Role claims embedded in JWTs during authentication
  - Middleware enforces role-based permissions
  - 401/403 responses for authentication/authorization failures

## 5. Standard Conventions
### API Structure
- **Controllers:** Contain business logic
- **Routes:** Define Next.js API endpoints
- **Schemas:** Zod validation for request/response payloads
- **Actions:** Integration with server actions
- **Middleware:** Authentication and authorization handlers

### Common Patterns
- RESTful endpoint design
- Consistent error handling
- Standard HTTP status codes
- Structured response formats

### API Key Management
API keys can be managed through the user interface by navigating to your User Profile settings and scrolling to the "API Keys" section. The underlying implementation uses server actions in `server/src/lib/actions/apiKeyActions.ts`:

- **Creating API Keys:**
  ```typescript
  const result = await createApiKey(
    "Development API key",           // Optional description
    "2026-02-10T12:00:00Z"          // Optional expiration date
  );
  // Returns:
  {
    api_key_id: "uuid",
    api_key: "generated-api-key",    // Only shown once upon creation
    description: "Development API key",
    created_at: "2025-02-10T12:00:00Z",
    expires_at: "2026-02-10T12:00:00Z"
  }
  ```

- **Listing API Keys:**
  ```typescript
  const keys = await listApiKeys();
  // Returns:
  [
    {
      api_key_id: "uuid",
      description: "Development API key",
      created_at: "2025-02-10T12:00:00Z",
      last_used_at: "2025-02-10T12:30:00Z",
      expires_at: "2026-02-10T12:00:00Z",
      active: true
    }
  ]
  ```

- **Deactivating API Keys:**
  ```typescript
  await deactivateApiKey("api-key-id");
  ```

- **Using API Keys:**
  Include the API key in the `x-api-key` header for all API requests:
  ```http
  GET /api/some-endpoint
  x-api-key: your-api-key-here
  ```

## 6. Available APIs

### Community Edition APIs
- [Future CE APIs will be documented here]

### Enterprise Edition APIs
- **Tenant Provisioning API:** Enables partner-driven tenant management. See [tenant_provisioning_api.md](tenant_provisioning_api.md) for details.

## 7. Development Guidelines

### Edition-Specific Considerations
- CE APIs should focus on core functionality
- EE APIs can depend on CE components but not vice versa
- Use feature flags for edition-specific functionality
- Test both editions during development
- Document edition requirements clearly

### General Guidelines
### Integration with Actions System
- APIs should leverage existing server actions where possible
- Standardized error mapping to HTTP responses
- Consistent business logic processing

### Logging and Monitoring
- Request details and error logging
- Performance monitoring
- Error rate tracking
- Audit trail maintenance

### Testing Requirements
- Unit tests for validation and business logic
- Integration tests for API endpoints
- Authentication/authorization test cases
- Error handling verification

### Documentation Standards
- API specifications should include:
  - Endpoint descriptions
  - Request/response schemas
  - Authentication requirements
  - Example requests/responses
  - Error scenarios and handling

## 8. Future Considerations
- **API Documentation:** OpenAPI/Swagger integration
- **Webhook Support:** For asynchronous operations
- **Rate Limiting:** Request throttling implementation
- **Versioning Strategy:** API versioning guidelines
- **Security Reviews:** Regular security assessment and updates

## 9. Conclusion
This architecture provides a foundation for building secure, maintainable, and extensible APIs across both Community and Enterprise editions. It emphasizes security through robust authentication and authorization, maintainability through consistent patterns and documentation, and extensibility through modular design and standardized interfaces. The edition-based segmentation ensures that advanced features are properly isolated while maintaining a cohesive development experience.
