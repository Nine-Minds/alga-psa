# Tenant Management API

API endpoints for managing tenants through the Nine Minds reporting extension.

**Access:** Restricted to users from `MASTER_BILLING_TENANT_ID` only.

**Audit:** All actions are logged to the unified `extension_audit_logs` table.

## Endpoints

### POST /api/v1/tenant-management/create-tenant

Creates a new tenant by triggering the existing Temporal `tenantCreationWorkflow`.

**Request Body:**
```json
{
  "companyName": "Acme Inc.",
  "firstName": "John",
  "lastName": "Doe",
  "email": "admin@acme.com",
  "licenseCount": 10  // optional, defaults to 5
}
```

**Response (Success - Completed):**
```json
{
  "success": true,
  "workflowId": "tenant-creation-1234567890-abc123",
  "tenantId": "uuid-of-tenant",
  "adminUserId": "uuid-of-admin-user",
  "message": "Tenant \"Acme Inc.\" created successfully. Welcome email sent to admin@acme.com."
}
```

**Response (Success - Still Running):**
```json
{
  "success": true,
  "workflowId": "tenant-creation-1234567890-abc123",
  "status": "running",
  "message": "Tenant creation started. Workflow ID: tenant-creation-1234567890-abc123. Check Temporal UI for status."
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message"
}
```

**Status Codes:**
- `200`: Success (tenant created or workflow started)
- `400`: Bad request (missing/invalid fields)
- `401`: Unauthorized (not authenticated)
- `403`: Forbidden (not from master tenant)
- `500`: Server error

**Workflow Behavior:**
1. Creates tenant record in database
2. Runs onboarding seeds (roles, permissions, tax settings)
3. Creates admin user with temporary password
4. Sets up initial tenant data (contract lines, default settings)
5. Creates customer tracking records in Nine Minds tenant (optional, non-blocking)
6. Sends welcome email to admin user

**Timeout:**
- The API waits up to 2 minutes for the workflow to complete
- If workflow takes longer, it returns the workflow ID and status "running"
- You can check the workflow status in the Temporal UI or via audit logs

**Audit Logging:**
All tenant creation attempts are logged to `extension_audit_logs` with:
- Event type: `tenant.create`
- Resource type: `tenant`
- User who triggered the action
- Workflow ID for tracking
- Status: `pending` → `completed`/`failed`/`running`
- Full details and result

## Implementation Details

**Workflow Client:**
Uses the existing `TenantWorkflowClient` from `ee/temporal-workflows/src/client.ts`

**Workflow:**
Uses the existing `tenantCreationWorkflow` from `ee/temporal-workflows/src/workflows/tenant-creation-workflow.ts`

**No new workflow needed** - this endpoint simply exposes the existing Temporal workflow via API.

## Example Usage

```bash
# Create a new tenant
curl -X POST http://localhost:3000/api/v1/tenant-management/create-tenant \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "companyName": "Acme Inc.",
    "firstName": "John",
    "lastName": "Doe",
    "email": "admin@acme.com",
    "licenseCount": 10
  }'
```

## Testing

See `.ai/tenant-creation-workflow-plan.md` for the complete implementation plan and testing instructions.
