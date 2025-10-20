# Controller Pattern Analysis Report

## Executive Summary

Analysis of all API v1 routes in `/home/coder/alga-psa/server/src/app/api/v1/` reveals two distinct controller patterns being used:

- **V2 Controllers**: 66 routes (20%)
- **Standard Controllers**: 255 routes (80%)

## Controller Patterns

### V2 Controller Pattern
Routes using V2 controllers follow this pattern:
- Import controllers with "V2" suffix (e.g., `ApiContactControllerV2`)
- No try-catch blocks in route handlers
- Controller instantiated once and methods called directly
- Example:
```typescript
import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export async function GET(request: Request) {
  return await controller.list()(request as any);
}
```

### Standard Controller Pattern
Routes using standard controllers follow this pattern:
- Import controllers without V2 suffix (e.g., `AssetController`)
- Include try-catch blocks with `handleApiError` middleware
- Controller instantiated inside each handler
- Example:
```typescript
import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}
```

## V2 Controllers by Resource

| Resource | Count | Controller |
|----------|-------|------------|
| time-entries | 12 | ApiTimeEntryControllerV2 |
| teams | 11 | ApiTeamControllerV2 |
| users | 8 | ApiUserControllerV2 |
| tickets | 8 | ApiTicketControllerV2 |
| projects | 7 | ApiProjectControllerV2 |
| roles | 6 | ApiRoleControllerV2 |
| contacts | 5 | ApiContactControllerV2 |
| companies | 5 | ApiCompanyControllerV2 |
| permissions | 4 | ApiPermissionControllerV2 |

## Standard Controllers by Resource

| Controller | Routes | Primary Resources |
|------------|--------|-------------------|
| QuickBooksController | 31 | integrations/quickbooks |
| FinancialController | 25 | financial |
| InvoiceController | 25 | invoices |
| WebhookController | 24 | webhooks |
| WorkflowController | 23 | workflows |
| TimeSheetController | 23 | time-sheets |
| ContractLineController | 17 | contract-lines |
| AssetController | 15 | assets |
| AutomationController | 14 | automation |
| TagController | 10 | tags |
| CategoryController | 9 | categories |
| UserController | 9 | users (subset) |
| ProjectController | 8 | projects (subset) |
| MetadataController | 8 | meta |
| PermissionRoleController | 5 | plan-bundles, user-roles |
| TeamController | 4 | teams (subset) |

## Key Observations

1. **Migration in Progress**: The presence of both patterns suggests an ongoing migration from standard controllers to V2 controllers.

2. **Core Resources Using V2**: Critical resources like users, teams, contacts, companies, and permissions have been migrated to V2 controllers.

3. **Complex Modules Still Standard**: Larger, more complex modules (QuickBooks integration, financial, invoices, webhooks, workflows) still use standard controllers.

4. **Error Handling Difference**: V2 controllers appear to handle errors internally, while standard controllers use explicit try-catch blocks with middleware.

5. **Instantiation Pattern**: V2 controllers are instantiated once outside handlers, while standard controllers are instantiated per request.

## Recommendations

1. **Complete Migration**: Consider migrating remaining standard controllers to V2 pattern for consistency.

2. **Priority Order**: Focus on high-usage modules first (financial, invoices, webhooks).

3. **Documentation**: Document the differences and migration guide for developers.

4. **Testing**: Ensure comprehensive tests during migration, especially for error handling behavior changes.