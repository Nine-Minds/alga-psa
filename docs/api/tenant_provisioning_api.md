# Tenant Provisioning API Documentation

## 1. Overview
The Tenant Provisioning API is an Enterprise Edition (EE) feature that enables partners to provision and manage tenant accounts. Located in `ee/server/src/api/provisioning/`, this API is only available in enterprise deployments and follows the architectural patterns described in [api_overview.md](api_overview.md).

## 2. Use Cases and Requirements
- **Tenant Provisioning:** Allow partners to create new tenant records
- **Validation:** Ensure all required tenant fields (e.g., company name, contact details) are provided
- **Security and Access Control:** Ensure only authorized partner integrations can access the API
- **Extensibility:** Support future operations (updating tenant details, deletion) through additional endpoints

## 3. Implementation Details

### File Structure
```
ee/
 └── server/
      └── src/
           └── api/
                └── provisioning/
                     ├── tenant.controller.ts    // Contains the provisioning business logic
                     ├── tenant.routes.ts        // Defines Next.js API route handlers
                     ├── tenant.schema.ts        // Contains Zod schema for request validation
                     └── index.ts                // Aggregates and exports the router for integration
```

### API Endpoints

- **POST `/api/provisioning/tenants`:**
  - **Description:** Create a new tenant
  - **Request Body:** JSON payload including mandatory fields
  - **Response:** JSON confirmation with the newly created tenant details
  - **Required Role:** partner-admin
  
- **GET `/api/provisioning/tenants/:id`:**
  - **Description:** Retrieve details for a specific tenant (future enhancement)

- **PATCH/PUT `/api/provisioning/tenants/:id`:**
  - **Description:** Update tenant details (future enhancement)

- **DELETE `/api/provisioning/tenants/:id`:**
  - **Description:** Delete a tenant (future enhancement)

### Data Models and Validation

#### Tenant Schema
```typescript
export const TenantSchema = z.object({
  client_name: z.string().min(1, "Client name is required"),
  email: z.string().email("Invalid email address"),
  phone_number: z.string().optional(),
  industry: z.string().optional(),
  // additional fields as needed
});
```

### Authorization
The API enforces role-based access control through our RBAC system:
- Required role: "partner-admin"
- Permission: "tenant:create"
- JWT must include proper role claims
- Middleware validates permissions before processing requests

### Error Handling
- **400 Bad Request:** Invalid input data
- **401 Unauthorized:** Missing or invalid authentication
- **403 Forbidden:** Insufficient permissions
- **404 Not Found:** Tenant not found
- **409 Conflict:** Tenant already exists
- **500 Internal Server Error:** Server-side errors

## 4. Integration with Actions System
- Leverages existing tenant management actions
- Maintains data consistency through transactions
- Maps action errors to appropriate HTTP responses

## 5. Testing Strategy
- **Unit Tests:**
  - Schema validation
  - Controller logic
  - Error handling
- **Integration Tests:**
  - API endpoint behavior
  - Authentication flows
  - Authorization checks
- **Error Scenarios:**
  - Invalid input handling
  - Permission validation
  - Duplicate detection

## 6. Future Enhancements
- Implement remaining CRUD operations
- Add bulk provisioning capabilities
- Support tenant configuration management
- Implement webhook notifications for tenant lifecycle events

## 7. Example Usage

### Create Tenant Request
```http
POST /api/provisioning/tenants
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "client_name": "Example Corp",
  "email": "admin@example.com",
  "phone_number": "+1234567890",
  "industry": "Technology"
}
```

### Successful Response
```json
{
  "tenant": "550e8400-e29b-41d4-a716-446655440000",
  "client_name": "Example Corp",
  "email": "admin@example.com",
  "phone_number": "+1234567890",
  "industry": "Technology",
  "created_at": "2025-02-10T16:30:00.000Z",
  "updated_at": "2025-02-10T16:30:00.000Z"
}
```
