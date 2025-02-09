# Provisioning API Overview

## 1. Introduction
This document outlines the design for a new Provisioning API system for the MSP PSA enterprise edition. The API is intended for use by our partners to provision new customer accounts and is implemented using Next.js for the backend. It is designed as an enterprise-only feature and will reside under the `ee/` folder. The API takes a REST-ish approach and leverages Next.js API routes along with our existing actions system.

## 3. Architectural Overview
- **Technology Stack:**
  - **Next.js:** The API is built using Next.js API routes, which integrate seamlessly into the existing Next.js application.
  - **Node.js:** Underlying runtime environment.
  - **Zod:** Used for schema validation of incoming requests.
  - **NextAuth Augmentation:** Enhancements to our existing NextAuth integration will be applied to support API access. Our current NextAuth setup (defined in `server/src/types/next-auth.ts`) already includes extended fields such as `proToken`, `tenant`, and `user_type`. We will leverage these fields to include role/permission claims in the JWT, and enforce authorization via our RBAC infrastructure.
  - **Existing Actions:** The API leverages existing server actions for creating and managing customer records.
- **Structure:** The API code is organized into:
  - **Controllers:** Contain business logic for provisioning.
  - **Routes:** Define the Next.js API endpoints.
  - **Schemas/Validation:** Use Zod to validate request payloads.
  - **Actions Integration:** Invoke existing server actions to handle customer creation.
  - **Middleware:** Implemented to handle authentication (via NextAuth) and authorization (via our RBAC module).

## 5. Security and Authentication
- **Authentication:** 
  - Use token-based authentication (e.g., JWT) or API keys to ensure only authorized partners can access the endpoints.
  - The existing NextAuth integration is leveraged to manage user sessions and issue JWTs, which include extended fields such as `proToken`, `tenant`, and `user_type`.
  - For API requests, a middleware will extract and verify the JWT. The token payload, enhanced during the NextAuth callbacks, can include additional claims like roles.
  - Consider integration with NextAuth.js callbacks to persist custom claims (e.g., roles) into the JWT, so API routes can validate access.
- **Augmenting NextAuth for API Access:**
  - **Current Setup:** Our current NextAuth configuration (see `server/src/types/next-auth.ts`) extends the User, Session, and JWT types with fields such as `username`, `proToken`, `tenant`, and `user_type`.
  - **Proposed Enhancements:**
    - **Include Role Claims:** During the NextAuth sign-in or JWT callback, retrieve the user’s role (or roles) from our RBAC system (defined in `@/server/src/lib/auth/rbac.ts`) and embed this information in the JWT.
    - **Custom API Token:** Consider issuing a dedicated API token (or using the `proToken`) that partners must present when accessing the API. This token will be validated for authenticity and for proper role claims.
    - **Middleware Enforcement:** API route middleware will validate the JWT and use helper functions from our RBAC module (e.g., `checkRole`) to enforce that the user holds the proper roles (e.g., “partner-admin” or “integration-user”) for the requested operation.
    - **Fallback and Session Refresh:** Ensure that if token validation fails, the API returns a 401/403 error, prompting re-authentication or token refresh as necessary.

## 7. File Structure and Code Organization
The proposed file structure for the Provisioning API within the enterprise edition is as follows:

```
ee/
 └── server/
      └── src/
           └── api/
                └── provisioning/
                     ├── customer.controller.ts    // Contains the provisioning business logic
                     ├── customer.routes.ts        // Defines Next.js API route handlers
                     ├── customer.schema.ts        // Contains Zod schema for request validation
                     └── index.ts                  // Aggregates and exports the router for integration
```

This structure ensures the API is modular, encapsulated within the enterprise edition, and distinct from the open source features.

## 8. Integration with Actions System
- API endpoints will call existing server actions responsible for customer creation and management.
- Errors thrown by these actions will be mapped to standardized HTTP error responses.
- This ensures consistency with the way other parts of the system process business logic.

## 9. Logging, Monitoring, and Testing
- **Logging:** 
  - Integrate with the current logging framework to record request details and errors.
- **Monitoring:**
  - Implement monitoring to track API performance and error rates.
- **Testing:**
  - Develop unit and integration tests to validate endpoint behavior using tools like Jest or Vitest.
  - Ensure endpoints are thoroughly tested for both valid and invalid input scenarios.

## 10. Future Enhancements
- **Additional Endpoints:** 
  - Extend the API to support updating and deletion of customer records.
- **Webhook Integration:** 
  - Support asynchronous processing through webhooks for tasks that take longer to complete.
- **API Documentation:** 
  - Consider generating API documentation (e.g., via OpenAPI/Swagger) for partner developers.
- **Security Improvements:** 
  - Regularly review and improve authentication/authorization mechanisms as new security threats emerge.

## 11. Conclusion
This design provides a clear, modular, and extensible approach to implementing the Provisioning API with Next.js and Zod for the enterprise edition. It addresses key requirements, including robust authentication via an augmented NextAuth strategy, detailed schema validation, and integration with our RBAC system for strict role-based access control. This lays a solid foundation for current business needs and future enhancements.