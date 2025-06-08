# Model Usage Analysis in Action Files

## Summary
This document lists all action files that import and use models, along with the specific models they use and common method patterns.

## Files Using Models from lib/models/

### 1. **billingPlanAction.ts**
- **Model**: `BillingPlan` from 'server/src/lib/models/billingPlan'
- **Model**: `BillingPlanFixedConfig` from 'server/src/lib/models/billingPlanFixedConfig'
- **Methods Used**: 
  - `BillingPlan.getAll()`
  - `BillingPlan.findById(planId)`
  - `BillingPlan.create(safePlanData)`
  - `BillingPlan.update(planId, safeUpdateData)`
  - `BillingPlan.delete(planId)`
  - `BillingPlan.isInUse(planId)`
  - `BillingPlan.hasAssociatedServices(planId)`

### 2. **bundleBillingPlanActions.ts**
- **Model**: `BundleBillingPlan` from 'server/src/lib/models/bundleBillingPlan'

### 3. **channel-actions/channelActions.ts**
- **Model**: `Channel` from '../../models/channel'

### 4. **clientBillingAction.ts**
- **Model**: `CompanyBillingPlan` from 'server/src/lib/models/clientBilling'

### 5. **comment-actions/commentActions.ts**
- **Model**: `Comment` from 'server/src/lib/models/comment'

### 6. **company-actions/companyPlanBundleActions.ts**
- **Model**: `CompanyPlanBundle` from 'server/src/lib/models/companyPlanBundle'

### 7. **creditReconciliationActions.ts** & **creditReconciliationFixActions.ts**
- **Model**: `CreditReconciliationReport` from 'server/src/lib/models/creditReconciliationReport'

### 8. **document-actions/documentActions.ts**
- **Model**: `Document` from 'server/src/lib/models/document'
- **Model**: `DocumentAssociation` from 'server/src/lib/models/document-association'

### 9. **interactionActions.ts**
- **Model**: `InteractionModel` from 'server/src/lib/models/interactions'

### 10. **invoiceActions.ts** (and related invoice files)
- **Model**: `Invoice` from 'server/src/lib/models/invoice'

### 11. **planBundleActions.ts**
- **Model**: `PlanBundle` from 'server/src/lib/models/planBundle'

### 12. **priorityActions.ts**
- **Model**: `Priority` from 'server/src/lib/models/priority'

### 13. **project-actions/projectActions.ts**
- **Model**: `ProjectModel` from 'server/src/lib/models/project'
- **Model**: `ProjectTaskModel` from 'server/src/lib/models/projectTask'

### 14. **scheduleActions.ts**
- **Model**: `ScheduleEntry` from 'server/src/lib/models/scheduleEntry'

### 15. **serviceActions.ts**
- **Model**: `Service` from 'server/src/lib/models/service'
- **Model**: `ServiceTypeModel` from '../models/serviceType'

### 16. **serviceRateTierActions.ts**
- **Model**: `ServiceRateTier` from 'server/src/lib/models/serviceRateTier'

### 17. **tagActions.ts**
- **Model**: `Tag` from 'server/src/lib/models/tag'

### 18. **team-actions/teamActions.ts**
- **Model**: `Team` from 'server/src/lib/models/team'

### 19. **ticket-actions/ticketActions.ts**
- **Model**: `Ticket` from 'server/src/lib/models/ticket'

### 20. **ticketResourceActions.ts**
- **Model**: `TicketResource` from 'server/src/lib/models/ticketResource'

### 21. **timePeriodsActions.ts**
- **Model**: `TimePeriod` from '../models/timePeriod'
- **Model**: `TimePeriodSettings` from '../models/timePeriodSettings'

### 22. **user-actions/userActions.ts** & **registrationActions.ts**
- **Model**: `User` from 'server/src/lib/models/user'
- **Model**: `UserPreferences` from 'server/src/lib/models/userPreferences'

### 23. **initializeApp.ts**
- **Model**: `Tenant` from 'server/src/lib/models/tenant'

## Files Using Models from src/models/

### 1. **file-actions/fileActions.ts**
- **Model**: `FileStoreModel` from '../../../models/storage'

### 2. **event-catalog-actions.ts**
- **Model**: `EventCatalogModel` from '../../models/eventCatalog'

### 3. **workflow-event-attachment-actions.ts**
- **Model**: `WorkflowEventAttachmentModel` from 'server/src/models/workflowEventAttachment'

### 4. **workflow-event-actions.ts**
- **Model**: `WorkflowEventMappingModel` from '../../models/workflowEventMapping'

### 5. **workflow-trigger-actions.ts**
- **Model**: `WorkflowTriggerModel` from '../../models/workflowTrigger'

### 6. **integrations/qboActions.ts**
- **Model**: `AssetAssociationModel` from 'server/src/models/asset'

## Common Model Method Patterns

Based on the analysis, models typically expose these methods:
- `getAll()` - Fetch all records
- `findById(id)` - Find a single record by ID
- `create(data)` - Create a new record
- `update(id, data)` - Update an existing record
- `delete(id)` - Delete a record
- `isInUse(id)` - Check if record is referenced elsewhere
- `hasAssociatedServices(id)` - Check for related services (specific to BillingPlan)

## Transaction Support Needed

All these models need to be updated to support optional Knex transaction parameter:
- Add optional `trx?: Knex.Transaction` parameter to all model methods
- Ensure the transaction is passed through to database queries
- This will enable proper transaction handling in action files using `withTransaction`