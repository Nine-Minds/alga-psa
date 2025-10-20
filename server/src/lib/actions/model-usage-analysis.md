# Model Usage Analysis in Action Files

## Summary
This document lists all action files that import and use models, along with the specific models they use and common method patterns.

## Files Using Models from lib/models/

### 1. **contractLineAction.ts**
- **Model**: `ContractLine` from 'server/src/lib/models/contractLine'
- **Model**: `ContractLineFixedConfig` from 'server/src/lib/models/contractLineFixedConfig'
- **Methods Used**: 
  - `ContractLine.getAll()`
  - `ContractLine.findById(planId)`
  - `ContractLine.create(safePlanData)`
  - `ContractLine.update(planId, safeUpdateData)`
  - `ContractLine.delete(planId)`
  - `ContractLine.isInUse(planId)`
  - `ContractLine.hasAssociatedServices(planId)`

### 2. **contractLineMappingActions.ts**
- **Model**: `ContractLineMapping` from 'server/src/lib/models/contractLineMapping'

### 3. **channel-actions/channelActions.ts**
- **Model**: `Channel` from '../../models/channel'

### 4. **clientContractLineAction.ts**
- **Model**: `CompanyContractLine` from 'server/src/lib/models/clientContractLine'

### 5. **comment-actions/commentActions.ts**
- **Model**: `Comment` from 'server/src/lib/models/comment'

### 6. **company-actions/companyContractActions.ts**
- **Model**: `CompanyContract` from 'server/src/lib/models/companyContract'

### 7. **creditReconciliationActions.ts** & **creditReconciliationFixActions.ts**
- **Model**: `CreditReconciliationReport` from 'server/src/lib/models/creditReconciliationReport'

### 8. **document-actions/documentActions.ts**
- **Model**: `Document` from 'server/src/lib/models/document'
- **Model**: `DocumentAssociation` from 'server/src/lib/models/document-association'

### 9. **interactionActions.ts**
- **Model**: `InteractionModel` from 'server/src/lib/models/interactions'

### 10. **invoiceActions.ts** (and related invoice files)
- **Model**: `Invoice` from 'server/src/lib/models/invoice'

### 11. **contractActions.ts**
- **Model**: `Contract` from 'server/src/lib/models/contract'

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
- `hasAssociatedServices(id)` - Check for related services (specific to ContractLine)

## Transaction Support Needed

All these models need to be updated to support optional Knex transaction parameter:
- Add optional `trx?: Knex.Transaction` parameter to all model methods
- Ensure the transaction is passed through to database queries
- This will enable proper transaction handling in action files using `withTransaction`