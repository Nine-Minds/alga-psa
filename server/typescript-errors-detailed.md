# Detailed TypeScript Error Fixes

## 1. Model Transaction Handling Fixes

### src/lib/models/projectTask.ts
- **Import fix**: Line 3 - Change `from '../tenant'` to `from '../db'`
- **Function: deleteTask** (around line 170)
  - Add after getting tenant: `const isTransaction = (knexOrTrx as any).isTransaction || false;`
  - Add transaction creation: `const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();`
  - Fix lines 199, 203: Change `!knexOrTrx.isTransaction` to `!isTransaction`

- **Function: updateDescendantWbsCodes** (around line 260)
  - Add after getting tenant: `const isTransaction = (knexOrTrx as any).isTransaction || false;`
  - Add transaction creation: `const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();`
  - Fix lines 286, 290: Change `!knexOrTrx.isTransaction` to `!isTransaction`

### src/lib/models/team.tsx
- **Function: deleteTeam** (around line 120)
  - Add after getting tenant: `const isTransaction = (knexOrTrx as any).isTransaction || false;`
  - Add transaction creation: `const trx = isTransaction ? knexOrTrx as Knex.Transaction : await knexOrTrx.transaction();`
  - Fix lines 141, 145: Change `!knexOrTrx.isTransaction` to `!isTransaction`

### src/lib/models/ticket.tsx
- **Line 50**: Type issue with `assigned_to` - needs to handle null properly

## 2. Test Import Fixes

### Missing createTestEnvironment export
Files affected:
- src/test/infrastructure/projectManagement.test.ts
- src/test/infrastructure/projectPermissions.test.ts
- src/test/infrastructure/ticketPermissions.test.ts

### Workflow module imports
Multiple test files trying to import non-existent workflow modules

## 3. Interface Updates Needed

### ICompany interface
Add property: `tax_region?: string`

### ITicket interface
Add property: `estimated_hours?: number`

### ITaxRate interface
Check for missing `name` property

### ICompanyTaxSettings interface
Check for `tax_rate_id` property

### IUserWithRoles interface
Ensure `user_type` is included

### IInvoiceItem interface
Ensure `rate` property is included

## 4. Function Call Updates

### Time Period Functions
- src/test/infrastructure/timePeriods.test.ts lines 365, 397
- Need to add knex as first parameter

### Project Management Functions
- src/test/infrastructure/projectManagement.test.ts lines 435, 577, 654
- Need to add knex as first parameter

## 5. Type Annotations for Workflow Tests

Add explicit types for parameters in test files:
- actionExecutor.test.ts
- actionRegistry.test.ts
- workflowDependencyResolution.test.ts
- workflowErrorHandling.test.ts
- workflowEventSourcing.test.ts
- workflowParallelExecution.test.ts
- workflowVersioning.test.ts