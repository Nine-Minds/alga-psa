# API Overview

> 👉 **New to our APIs?** Check out our [Getting Started Guide](api_getting_started_guide.md) for a quick introduction to using our APIs.

## 1. Introduction
This document outlines the design and architecture of the Alga PSA APIs. Our APIs are implemented using Next.js for the backend and take a REST-ish approach, leveraging Next.js API routes along with our existing actions system.

> 📝 **Note:** The Alga PSA hosted environment is available at `algapsa.com`. If you are running an on-premise installation, replace this with your configured domain.

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
  - Hudu Integration Status API (see Section 6)
  - Appliance Console API (see Section 6)

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

=======

The following REST API groups are available in the Community Edition under the base path `/api/v1/`:


- [API Rate Limiting and Webhooks](api-rate-limiting-and-webhooks.md)
- [Unified Full-Text Search](search.md)
- **Tickets** — Create, read, update, and close service tickets; manage comments, time entries, assignments, and files. Includes ticket bundling and asset links (see below). `GET /api/v1/tickets` supports a `fields` query parameter for sparse field sets; pass `fields=tags` to include each ticket's tag array in the response — each entry contains `tag_id`, `tag_text`, `background_color`, and `text_color`.
- **Assets** — Register hardware assets, schedule maintenance, map relationships between devices, drive RMM actions, and link assets to tickets (see below).
- **Users** — Create and administer user accounts, manage passwords and two-factor authentication, and read roles, teams, and effective permissions.
- **Billing** — Access contracts, contract lines, invoices, and billing analytics.
- Additional endpoints: companies (clients), contacts, projects, boards, categories, priorities, statuses, time entries, schedules, and more.

#### Ticket Bundling

When multiple tickets describe the same underlying issue, they can be grouped under one *master* ticket using the bundle sub-resource at `/api/v1/tickets/{id}/bundle`. This feature is available to both PSA and AlgaDesk tenants.

| Method | Path | Purpose |
|--------|------|-------|
| `GET` | `/tickets/{id}/bundle` | Return the ticket's bundle role (`master`, `child`, or `standalone`), the master ticket, children, and settings |
| `POST` | `/tickets/{id}/bundle` | Create a bundle with `{id}` as master. Requires `child_ticket_ids` (array of UUIDs); accepts optional `mode` (`link_only` or `sync_updates`, default `sync_updates`) |
| `DELETE` | `/tickets/{id}/bundle` | Detach all children and remove bundle settings |
| `POST` | `/tickets/{id}/bundle/children` | Add additional child tickets to an existing bundle |
| `DELETE` | `/tickets/{id}/bundle/children/{childId}` | Remove one child; bundle settings are cleaned up when the last child is removed |
| `POST` | `/tickets/{id}/bundle/promote` | Promote a child ticket to become the new master |
| `PUT` | `/tickets/{id}/bundle/settings` | Update `mode` and/or `reopen_on_child_reply` for the bundle |

**Bundle modes:**
- `link_only` — links tickets visually without propagating state changes to children
- `sync_updates` — propagates the master ticket's status changes to all children (default)

#### Asset ↔ Ticket Links

Assets and tickets can be linked to each other (the same association surfaced in the asset and ticket detail UIs). The link is a single record readable and writable from either side.

| Method | Path | Purpose |
|--------|------|-------|
| `GET` | `/assets/{id}/tickets` | List tickets linked to an asset |
| `POST` | `/assets/{id}/tickets` | Link a ticket to an asset. Requires `ticket_id`; accepts optional `relationship_type` (default `affected`) and `notes` |
| `DELETE` | `/assets/{id}/tickets/{ticketId}` | Remove the link between an asset and a ticket |
| `GET` | `/tickets/{id}/assets` | List assets linked to a ticket |
| `POST` | `/tickets/{id}/assets` | Link an asset to a ticket. Requires `asset_id`; accepts optional `relationship_type` (default `affected`) and `notes` |
| `DELETE` | `/tickets/{id}/assets/{assetId}` | Remove the link between a ticket and an asset |

**Permissions:** the asset-side routes require `asset:update` plus `ticket:read`; the ticket-side routes require `ticket:update` plus `asset:read`. In each case you need *update* on the resource whose links you are changing and *read* on the one you reference.

### Enterprise Edition APIs
- **Tenant Provisioning API:** Enables partner-driven tenant management. See [tenant_provisioning_api.md](tenant_provisioning_api.md) for details.
- **Hudu Integration Status:** `GET /api/integrations/hudu` returns connection health for the tenant's Hudu integration: `status`, `baseUrl`, `connectedAt`, `lastSyncedAt`, and `passwordAccess` (whether the Hudu API key can reach the password endpoints). Connection setup, company mapping, and asset layout mapping are configured through the Alga PSA UI at **Settings → Integrations → Hudu**, not via REST. Requires the `system_settings` read permission; available on EE deployments with the Hudu feature enabled. See [hudu.md](../integrations/hudu.md) for the full admin guide.
- **Appliance Console API (EE only):** Manages on-premise appliance installations for Enterprise Edition deployments. Three endpoints are available under `/api/v1/appliance-installs/`:

  | Method | Path | Purpose |
  |--------|------|--------|
  | `GET` | `/api/v1/appliance-installs` | List appliance installs visible to the authenticated tenant |
  | `GET` | `/api/v1/appliance-installs/{tenantId}` | Retrieve details for a specific appliance install by tenant ID |
  | `POST` | `/api/v1/appliance-installs/access` | Log an access event for an appliance install |

  Community Edition deployments respond to all three endpoints with `501 Not Implemented` and the message `"Appliance console is only available in Enterprise Edition."` CORS preflight (`OPTIONS`) requests return `204 No Content` in both editions.

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
