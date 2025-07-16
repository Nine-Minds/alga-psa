# Workflow Troubleshooting Guide

This document provides solutions to common issues encountered when working with the workflow system.

## Table of Contents

1. [Action Not Found Errors](#action-not-found-errors)
2. [Workflow Deserialization Errors](#workflow-deserialization-errors)
3. [Database Update Issues](#database-update-issues)
4. [Test Environment Issues](#test-environment-issues)

## Action Not Found Errors

### Problem: `actions.resolve_email_provider_defaults is not a function`

**Symptoms:**
- Workflow fails with error: `actions.resolve_email_provider_defaults is not a function`
- Error occurs during email processing workflow execution

**Root Cause:**
The workflow code in the database still references an old action name that has been deprecated or renamed.

**Solution:**
1. **Update the workflow source code** to use the new action name
2. **Update the database** using the appropriate update script
3. **Verify the database contains the updated code**

**Example Fix:**
```javascript
// OLD (deprecated)
const ticketDefaults = await actions.resolve_email_provider_defaults({
  providerId: providerId,
  tenant: tenant
});

// NEW (correct)
const ticketDefaults = await actions.resolve_inbound_ticket_defaults({
  tenant: tenant
});
```

**Verification Steps:**
```sql
-- Check what action names are in the database
SELECT 
  sv.version_id,
  sv.is_current,
  LENGTH(sv.code) as code_length,
  CASE 
    WHEN sv.code LIKE '%resolve_email_provider_defaults%' THEN 'OLD_ACTION'
    WHEN sv.code LIKE '%resolve_inbound_ticket_defaults%' THEN 'NEW_ACTION'
    ELSE 'UNKNOWN'
  END as action_status
FROM system_workflow_registration_versions sv
WHERE sv.registration_id = '550e8400-e29b-41d4-a716-446655440001'
ORDER BY sv.created_at DESC;
```

## Workflow Deserialization Errors

### Problem: `Unexpected token 'async'`

**Symptoms:**
- Error: `SyntaxError: Unexpected token 'async'`
- Occurs when workflow runtime tries to deserialize workflow function
- Error in `deserializeWorkflowFunction`

**Root Cause:**
The workflow function stored in the database contains incorrect syntax that conflicts with how the runtime wraps the function.

**Solution:**
The stored function should NOT have `async` in the wrapper as the runtime adds it automatically.

```javascript
// CORRECT - runtime adds async wrapper
const dbWorkflowCode = `function execute(context) {
  // workflow body
}`;
```

### Problem: `Failed to extract function body from compiled code`

**Symptoms:**
- Error: `Failed to extract function body from compiled code`
- Occurs during workflow deserialization
- Error in `deserializeWorkflowFunction`

**Root Cause:**
The workflow runtime expects stored functions to match the pattern `async function <name>(context) { ... }` but the stored function doesn't match this pattern.

**Solution:**
Ensure the stored function matches the expected pattern:

```javascript
// CORRECT - matches runtime expectations
const dbWorkflowCode = `async function execute(context) {
  ${functionBody}
}`;
```

**Common Issues:**
1. **Missing async keyword**: Function stored as `function execute(context)` instead of `async function execute(context)`
2. **TypeScript imports**: Import statements in the workflow code
3. **Type annotations**: TypeScript type annotations like `context: WorkflowContext`
4. **Async function declarations within workflow**: Helper functions declared as `async function name() {}` inside the main workflow

### Problem: `Unexpected token 'async'` with helper functions

**Symptoms:**
- Error: `SyntaxError: Unexpected token 'async'`
- Occurs when workflow contains helper functions declared as `async function`
- Runtime fails to parse the wrapped function

**Root Cause:**
Helper functions declared as `async function name() {}` within the workflow cause parsing errors when the runtime wraps the extracted function body.

**Solution:**
Convert helper function declarations to function expressions:

```javascript
// WRONG - causes parsing error
async function checkEmailThreading(emailData, actions) {
  // ...
}

// CORRECT - use function expressions
const checkEmailThreading = async (emailData, actions) => {
  // ...
};

// Also correct - function expression syntax
const checkEmailThreading = async function(emailData, actions) {
  // ...
};
```

**Why this happens:**
The runtime wraps the extracted function body like this:
```javascript
return (async function(context) {
  // Your extracted function body goes here
  async function helperFunction() {} // <-- This causes the error!
})(context);
```

Function declarations inside immediately invoked function expressions cause JavaScript parsing errors.

**Issue 2: Remove imports and TypeScript syntax**
```typescript
// WRONG - TypeScript syntax
import type { WorkflowContext } from '../core/types.js';

export async function systemEmailProcessingWorkflow(context: WorkflowContext): Promise<void> {
  // workflow logic
}

// CORRECT - Plain JavaScript
export async function systemEmailProcessingWorkflow(context) {
  // workflow logic
}
```

**Issue 3: Update tsconfig to exclude workflow files**
```json
{
  "exclude": ["node_modules", "dist", "workflow/workflows/system-email-processing-workflow.ts"]
}
```

### Problem: Helper functions not accessible in workflow scope

**Symptoms:**
- Workflow deserialization succeeds initially
- Runtime errors when helper functions are called
- Functions appear undefined during execution
- Error: `checkEmailThreading is not defined` or similar

**Root Cause:**
The workflow runtime extracts only the function body and wraps it in a new execution context. Helper functions defined outside the main workflow function are not included in the extracted body, making them inaccessible during execution.

**Solution:**
**All helper functions must be defined inside the main workflow function** using function expressions:

```javascript
export async function systemEmailProcessingWorkflow(context) {
  const { actions, data, logger, setState, events } = context;
  
  // CORRECT - Helper functions defined inside main function as const expressions
  const checkEmailThreading = async (emailData, actions) => {
    // helper function logic
  };
  
  const handleEmailReply = async (emailData, existingTicket, actions) => {
    // helper function logic
  };
  
  const findExactEmailMatch = async (emailAddress, actions) => {
    // helper function logic
  };
  
  // Main workflow logic starts here
  setState('PROCESSING_INBOUND_EMAIL');
  // ... rest of workflow
}

// WRONG - Helper functions outside main function won't be included
async function checkEmailThreading(emailData, actions) {
  // This function won't be available during execution!
}

export async function systemEmailProcessingWorkflow(context) {
  // Main workflow logic - but helper functions are missing!
}
```

**Why this happens:**
1. The runtime extracts only the content between the first `{` and last `}` of the main function
2. Functions defined outside the main function are not included in the extraction
3. The extracted body is wrapped in a new execution context where external functions don't exist

**Key Requirements:**
- Use `const functionName = async () => {}` syntax inside the main function
- Never use `async function functionName() {}` declarations inside the main function (causes parsing errors)
- Never define helper functions outside the main workflow function

### Problem: Function body extraction issues

**Symptoms:**
- Error: `Could not find systemEmailProcessingWorkflow function in source file`
- Seed fails during workflow loading

**Root Cause:**
The regex or string parsing logic in the seed file doesn't match the actual function signature.

**Solution:**
Use simple string indexing instead of complex regex:

```javascript
// Find the function declaration and extract everything after the opening brace
const functionStart = workflowContent.indexOf('export async function systemEmailProcessingWorkflow(context) {');
if (functionStart === -1) {
  throw new Error('Could not find systemEmailProcessingWorkflow function in source file');
}

// Find the opening brace and extract everything after it, minus the final closing brace
const openBraceIndex = workflowContent.indexOf('{', functionStart);
const functionContent = workflowContent.substring(openBraceIndex + 1);

// Remove the final closing brace
const functionBody = functionContent.substring(0, functionContent.lastIndexOf('}')).trim();
```

## Database Update Issues

### Problem: Workflow updates not taking effect

**Symptoms:**
- Updated workflow code in source file
- Ran update script successfully
- But runtime still executes old workflow code

**Root Causes:**
1. **Multiple databases**: Update script connected to different database than runtime
2. **Test seeds overwriting**: Test environment seeds overwrite manual updates
3. **Caching issues**: Workflow runtime caching old definitions

**Solutions:**

**Issue 1: Verify correct database connection**
```bash
# Check which databases are running
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep postgres

# Use correct environment variables
DB_HOST=localhost DB_PORT=5433 DB_NAME_SERVER=server_test DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=postpass123 node scripts/update-workflow-in-db.cjs
```

**Issue 2: Update seed files to read from source**
Ensure seed files read from the actual TypeScript source instead of hardcoded workflow code:

```javascript
// WRONG - hardcoded workflow
const dbWorkflowCode = `async function execute(context) {
  // hardcoded workflow logic here
}`;

// CORRECT - read from source file
function loadWorkflowCodeFromSource() {
  const workflowPath = path.join(__dirname, '../../../shared/workflow/workflows/system-email-processing-workflow.ts');
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  // extract and convert workflow code
}
```

**Issue 3: Check workflow version IDs**
Verify the update script is updating the correct version:

```sql
-- Check all workflow versions
SELECT 
  sv.version_id,
  sv.is_current,
  sv.created_at,
  sv.updated_at,
  LENGTH(sv.code) as code_length
FROM system_workflow_registration_versions sv
WHERE sv.registration_id = '550e8400-e29b-41d4-a716-446655440001'
ORDER BY sv.created_at DESC;
```

## Test Environment Issues

### Problem: Tests overwrite workflow updates

**Symptoms:**
- Manual workflow updates work
- Tests reset workflow to old version
- Tests fail with old action errors

**Root Cause:**
Test environment runs seeds that overwrite workflow definitions with outdated code.

**Solution:**
Update the seed file to load from the current source file instead of hardcoded workflow:

```javascript
// File: /server/seeds/dev/004_email_processing_workflow_from_source.cjs

function loadWorkflowCodeFromSource() {
  const workflowPath = path.join(__dirname, '../../../shared/workflow/workflows/system-email-processing-workflow.ts');
  
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  
  console.log(`Reading workflow from source file: ${workflowPath}`);
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  
  // Extract function body and create database-compatible version
  // ... (extraction logic)
  
  return dbWorkflowCode;
}
```

### Problem: Multiple workflow registrations

**Symptoms:**
- Multiple entries for the same workflow
- Unclear which version is being executed

**Diagnosis:**
```sql
-- Check all email-related workflows
SELECT 
  sr.registration_id,
  sr.name,
  sr.status,
  sv.version_id,
  sv.is_current,
  LENGTH(sv.code) as code_length
FROM system_workflow_registrations sr
JOIN system_workflow_registration_versions sv ON sr.registration_id = sv.registration_id
WHERE sr.name LIKE '%email%' OR sv.code LIKE '%email%'
ORDER BY sr.name, sv.created_at DESC;
```

**Solution:**
Ensure only one registration exists with the correct static UUID and that only one version is marked as current.

## Debugging Tips

### 1. Check Workflow Runtime Logs
Look for these log patterns:
- `[TENANT-DEBUG] WorkflowWorker about to start workflow`
- `Error deserializing workflow function`
- `Failed to load system workflow definition`

### 2. Verify Database State
```sql
-- Check current workflow registration
SELECT * FROM system_workflow_registrations 
WHERE registration_id = '550e8400-e29b-41d4-a716-446655440001';

-- Check current version
SELECT * FROM system_workflow_registration_versions 
WHERE registration_id = '550e8400-e29b-41d4-a716-446655440001' 
AND is_current = true;
```

### 3. Test Workflow Updates
Use the improved update script with detailed logging:
```bash
# The script provides comprehensive feedback
node scripts/update-workflow-in-db.cjs
```

### 4. Validate Workflow Syntax
Before updating the database, ensure the workflow function:
- Has no TypeScript imports
- Uses plain JavaScript syntax
- Function signature matches: `export async function systemEmailProcessingWorkflow(context)`
- Contains expected action calls

## Prevention Best Practices

1. **Keep workflows simple**: Avoid TypeScript syntax in workflow files
2. **Use seed files that read from source**: Don't hardcode workflow logic in seeds
3. **Exclude workflow files from TypeScript compilation**: Add to tsconfig exclude
4. **Test workflow updates**: Verify database state after updates
5. **Use consistent database connections**: Ensure update scripts target the correct database
6. **Version control workflow changes**: Track both source and database updates

## Quick Reference

### Common Commands
```bash
# Update workflow in database
DB_HOST=localhost DB_PORT=5433 DB_NAME_SERVER=server_test DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=postpass123 node scripts/update-workflow-in-db.cjs

# Check database workflows
docker exec sebastian_postgres_test psql -U postgres -d server_test -c "SELECT name, status FROM system_workflow_registrations;"

# Check running containers
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep postgres
```

### Workflow File Requirements
- Plain JavaScript syntax only
- No TypeScript imports
- No type annotations
- Function signature: `export async function systemEmailProcessingWorkflow(context)`
- Store as `function execute(context)` in database (no async keyword)