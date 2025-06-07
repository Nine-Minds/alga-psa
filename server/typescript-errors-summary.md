# TypeScript Compilation Errors Summary

## Error Types Overview

### 1. Transaction Handling Errors (TS2339) - 31 occurrences
**Priority: HIGH - Core refactoring issue**
- Files: `projectTask.ts`, `team.tsx`
- Issue: Trying to call `commit()` and `rollback()` on `Knex` instead of `Knex.Transaction`
- Pattern: Missing transaction type checks before calling transaction methods

### 2. Missing Module/Import Errors (TS2307, TS2305) - 38 occurrences
**Priority: HIGH - Blocking tests**
- Workflow modules: Missing workflow core modules in test files
- Import issues: `getCurrentTenantId` from wrong path in `projectTask.ts`
- Test factory: Missing `createTestEnvironment` export

### 3. Implicit Any Types (TS7006) - 32 occurrences
**Priority: MEDIUM - Type safety**
- Mainly in workflow test files
- Parameters without explicit types in test callbacks

### 4. Property Does Not Exist (TS2353) - 29 occurrences
**Priority: MEDIUM - Interface mismatches**
- `tax_region` missing from `ICompany` interface
- `estimated_hours` missing from `ITicket` interface
- Tax-related properties missing from various interfaces

### 5. Missing Required Properties (TS2741) - 9 occurrences
**Priority: MEDIUM - Interface compliance**
- `user_type` missing from user objects
- `rate` missing from invoice items

### 6. Type Assignment Errors (TS2322, TS2740, TS2739) - 17 occurrences
**Priority: LOW - Type mismatches**
- Service array type mismatches
- Invoice view model type issues
- Time period type mismatches

### 7. Wrong Argument Count (TS2554) - 4 occurrences
**Priority: LOW - Function signature changes**
- Missing first parameter (knex/transaction) in model calls

## Files Grouped by Issue Type

### Transaction Handling Issues
```
src/lib/models/projectTask.ts - Lines 200, 204, 287, 291
src/lib/models/team.tsx - Lines 142, 146
```

### Import/Module Issues
```
src/lib/models/projectTask.ts - Line 3 (getCurrentTenantId import)
src/lib/workflow/visualization/ast/flowGraphBuilder.test.ts
src/test/infrastructure/projectManagement.test.ts
src/test/infrastructure/projectPermissions.test.ts
src/test/infrastructure/ticketPermissions.test.ts
src/test/unit/workflow*.test.ts (multiple files)
```

### Interface Property Issues
```
Tax-related:
- src/test/infrastructure/billingInvoiceGeneration_discounts.test.ts
- src/test/infrastructure/taxExemptionHandling.test.ts
- src/test/infrastructure/taxRateChanges.test.ts
- src/test/infrastructure/taxRoundingBehavior.test.ts
- src/test/unit/taxCalculation.test.ts
- src/test/unit/taxService.test.ts

Other:
- src/test/infrastructure/ticketPermissions.test.ts (estimated_hours)
- src/test/unit/auth.test.ts (user_type)
- src/test/unit/templateRenderer.test.tsx (rate, parsed)
```

### Function Signature Issues
```
src/test/infrastructure/projectManagement.test.ts - Lines 435, 577, 654
src/test/infrastructure/timePeriods.test.ts - Lines 365, 397
```

## Recommended Fix Order

1. **Fix transaction handling in models** (projectTask.ts, team.tsx)
2. **Fix import paths** (getCurrentTenantId)
3. **Update interfaces** (add missing properties)
4. **Fix function calls** (add knex parameter)
5. **Add type annotations** (workflow tests)
6. **Fix type mismatches** (arrays, view models)