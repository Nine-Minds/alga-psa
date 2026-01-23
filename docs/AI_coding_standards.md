# Note to AI editor Claude / GPT-4 / O1 / etc

- If you need to see any additional files before you are sure you have enough context, ask the user to provide the file to the context before continuing.
- If you would like to search for the contents to files, offer to use the run command and grep command to search for the contents.
- Do not proceed to updating files until you have enough context to do so.
- When working in the billing domain, prefer the renamed terminology (`contract lines`, `contracts`) and alias any remaining helper imports that include `plan`/`bundle` to the new schema names in your edits.
- Default invoice template selections must flow through the `invoice_template_assignments` table. Do **not** add new usages of `invoice_templates.is_default` or `companies.invoice_template_id`; those fields are legacy-only until they are removed.


# Failure Handling Philosophy

- Fail fast when assumptions are violated instead of silently attempting fallbacks.
- Throw exceptions with actionable, descriptive messages to surface what went wrong.
- Validate assumptions as early as possible and reject inputs that do not meet strict criteria.

# UI coding standards

Prefer radix components over other libraries

## UI Components

**IMPORTANT: All interactive elements (buttons, inputs, selects, etc.) MUST have unique `id` attributes for the reflection UI system. See Component ID Guidelines section for naming conventions.**

- Use component from `server/src/components/ui` folder
    - [Button](../server/src/components/ui/Button.tsx)
    - [Card](../server/src/components/ui/Card.tsx)
    - [Checkbox](../server/src/components/ui/Checkbox.tsx)
    - [CustomSelect](../server/src/components/ui/CustomSelect.tsx)
    - [CustomTabs](../server/src/components/ui/CustomTabs.tsx)
    - [Dialog](../server/src/components/ui/Dialog.tsx)
    - [Drawer](../server/src/components/ui/Drawer.tsx)
    - [Input](../server/src/components/ui/Input.tsx)
    - [Label](../server/src/components/ui/Label.tsx)
    - [Select](../server/src/components/ui/Select.tsx)
    - [Switch](../server/src/components/ui/Switch.tsx)
    - [SwitchWithLabel](../server/src/components/ui/SwitchWithLabel.tsx)
    - [Table](../server/src/components/ui/Table.tsx)
    - [TextArea](../server/src/components/ui/TextArea.tsx)

## Loading States for Remote Content

- When embedding remote experiences (extension iframes, external dashboards, etc.), always surface a branded loading state until the surface reports it is ready.
- Wrap the remote surface in a `relative` container and gate its visibility with an `isLoading` flag driven by the `onLoad`/`onError` lifecycle events.
- Reuse the shared overlay styles defined in `server/src/app/globals.css` (`extension-loading-overlay`, `extension-loading-indicator`, `extension-loading-text`, `extension-loading-subtext`) to maintain consistent visuals.
- Use the `LoadingIndicator` component with `layout="stacked"` for the primary status message and reserve the subtext paragraph for short explanations (<40 characters) so the layout stays balanced.
- Example pattern:
  ```tsx
  <div className="relative h-full" aria-busy={isLoading}>
    {isLoading && (
      <div className="extension-loading-overlay" role="status">
        <LoadingIndicator
          layout="stacked"
          className="extension-loading-indicator"
          text="Starting extension"
          textClassName="extension-loading-text"
          spinnerProps={{ size: 'sm', color: 'border-primary-400' }}
        />
        <p className="extension-loading-subtext">Connecting to the runtime workspace&hellip;</p>
      </div>
    )}

    <iframe
      onLoad={() => setIsLoading(false)}
      onError={() => {
        setHasError(true);
        setIsLoading(false);
      }}
      className={isLoading ? 'opacity-0' : 'opacity-100'}
    />
  </div>
  ```

## Dialog Component Usage

When implementing dialogs in the application, follow these guidelines:

1. **Use Custom Dialog Component**
   - Always use the custom Dialog component from 'server/src/components/ui/Dialog'
   - Never import Dialog directly from '@radix-ui/react-dialog'
   ```tsx
   // Good
   import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
   
   // Bad
   import * as Dialog from '@radix-ui/react-dialog';
   ```

2. **Dialog Structure**
   ```tsx
   <Dialog 
     isOpen={isOpen} 
     onClose={() => setIsOpen(false)}
     title="Dialog Title"
     className="max-w-lg"  // Use responsive width classes
   >
     <DialogContent>
       {/* Dialog content */}
     </DialogContent>
     <DialogFooter>
       {/* Action buttons */}
     </DialogFooter>
   </Dialog>
   ```

3. **Props and Features**
   - `isOpen`: Boolean to control dialog visibility
   - `onClose`: Callback function when dialog should close
   - `title`: Dialog title shown in the draggable header
   - `className`: Use responsive Tailwind classes (max-w-sm, max-w-md, max-w-lg, max-w-xl, max-w-2xl)
   - `draggable`: Defaults to true, set to false to disable dragging
   - `hideCloseButton`: Set to true to hide the X close button

4. **Width Guidelines**
   - Use responsive max-width classes instead of fixed pixel widths
   - Common sizes:
     - `max-w-sm` (384px) - Very small dialogs
     - `max-w-md` (448px) - Small dialogs (confirmations, simple forms)
     - `max-w-lg` (512px) - Medium dialogs (standard forms)
     - `max-w-xl` (576px) - Large dialogs (complex forms)
     - `max-w-2xl` (672px) - Extra large dialogs (multi-section forms)

5. **Spacing and Padding**
   - DialogContent automatically provides padding
   - For forms with focus rings, add `mt-2` to the first form element container to prevent cut-off
   - Example:
   ```tsx
   <DialogContent>
     <form className="space-y-4 mt-2">
       <Input className="..." />
     </form>
   </DialogContent>
   ```

6. **Handling Close Events**
   - The Dialog's onClose is called with boolean false when the X button is clicked
   - Handle both MouseEvent and boolean types if needed:
   ```tsx
   const handleClose = (e?: React.MouseEvent | boolean) => {
     if (typeof e === 'boolean' && !e) {
       // Handle close from Dialog's X button
     }
     // Your close logic
   };
   ```

7. **Confirmation Dialogs**
   - For simple confirmations, use the ConfirmationDialog component
   - For custom confirmations with unsaved changes:
   ```tsx
   const hasChanges = () => {
     // Only return true if user has actually entered data
     return formField.trim() !== '' || otherField !== initialValue;
   };
   ```

## DataTable Action Menus

When implementing action menus in DataTable components, follow these guidelines:

1. **Component Structure**
   - Use Radix UI's DropdownMenu components from 'server/src/components/ui/DropdownMenu':
     ```tsx
     import {
       DropdownMenu,
       DropdownMenuTrigger,
       DropdownMenuContent,
       DropdownMenuItem,
     } from 'server/src/components/ui/DropdownMenu';
     ```

2. **Trigger Button Implementation**
   - Use the Button component from 'server/src/components/ui/Button'
   - Import MoreVertical icon from 'lucide-react'
   ```tsx
   <DropdownMenuTrigger asChild>
     <Button
       id="contract-line-actions-menu"  // Follow pattern: {object}-actions-menu
       variant="ghost"
       className="h-8 w-8 p-0"
       onClick={(e) => e.stopPropagation()}
     >
       <span className="sr-only">Open menu</span>
       <MoreVertical className="h-4 w-4" />
     </Button>
   </DropdownMenuTrigger>
   ```

3. **ID Naming Convention**
   Follow the component ID guidelines with these specific patterns:
   - Menu trigger: `{object}-actions-menu`
   - Menu items: `{action}-{object}-menu-item`
   Example:
   ```tsx
   <Button id="contract-line-actions-menu">
   <DropdownMenuItem id="edit-contract-line-menu-item">
   ```

4. **Event Handling**
   - Always use stopPropagation() to prevent row selection when clicking menu items
   - Handle async operations with proper error management
   ```tsx
   onClick={(e) => {
     e.stopPropagation();
     handleAction();
   }}
   ```

5. **Styling Guidelines**
   - Use theme-aware styling for destructive actions:
     ```tsx
     // For destructive actions (delete, remove)
     <DropdownMenuItem 
       className="text-red-600 focus:text-red-600"
     >
       Delete
     </DropdownMenuItem>
     ```
   - Position dropdown content:
     ```tsx
     <DropdownMenuContent align="end">
     ```

6. **Menu Content Organization**
   - Order items by frequency of use
   - Place destructive actions last
   - Use clear, concise action names
   Example structure:
   ```tsx
   <DropdownMenuContent align="end">
     <DropdownMenuItem>Edit</DropdownMenuItem>
     <DropdownMenuItem className="text-red-600 focus:text-red-600">
       Delete
     </DropdownMenuItem>
   </DropdownMenuContent>
   ```

7. **Accessibility**
   - Include sr-only text for screen readers
   - Ensure keyboard navigation works properly
   - Maintain focus states for all interactive elements

Lucide icons can (and should) be used from the `lucide` package.

## Server Action Authentication

**Recommended Pattern:** Use the `withAuth` wrapper from `@alga-psa/auth` for all server actions that need authentication:

```typescript
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

export const myAction = withAuth(async (user, { tenant }, arg1: string): Promise<Result> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'resource', 'action')) {
    throw new Error('Permission denied');
  }

  return knex('table').where({ tenant }).select('*');
});
```

**Why `withAuth`?**
- Sets tenant context via AsyncLocalStorage (works with Turbopack)
- Handles authentication checks consistently
- Provides typed `user` (IUserWithRoles) and `tenant` context
- Eliminates 15-20 lines of boilerplate per action

**Available wrappers:**
- `withAuth(action)` - Requires authentication, throws if not authenticated
- `withOptionalAuth(action)` - Allows unauthenticated access (user/ctx may be null)
- `withAuthCheck(action)` - Auth check only, no tenant context (for non-DB actions)

**Legacy Pattern (avoid in new code):**
```typescript
// OLD PATTERN - do not use in new code
import { getCurrentUser } from '@alga-psa/users/actions';

export async function myAction(): Promise<Result> {
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error('Not authenticated');
  if (!currentUser.tenant) throw new Error('No tenant');
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  // ... more boilerplate validation ...
}
```

## Server Communication

We use server actions that are located in the `/server/src/lib/actions` folder and package-specific actions in `packages/*/src/actions/`.

# ee folder
The ee folder contains the server code for the enterprise edition of the application. It is a parallel structure 
containing its own migrations that are overlaid on top of the base server migrations. ee specific database changes
should be made in the migrations in the ee folder.

# Database
server migrations are stored in the `/server/migrations` folder.
seeds are stored in the `/server/seeds` folder.
information about the database can be found in the `/server/src/lib/db` folder.

Migrations and seeds are using the Knex.js library.

Always use commands like "cd server && npx knex migrate:make <name> --knexfile knexfile.cjs --env migration" to create a new migration. Do the same for seeds.

The knexfile is located in the /server/knexfile.cjs file and is used to configure the database connection.

Use createTenantKnex() from the /server/src/lib/db/index.ts file to create a database connection and return the tenant as a string.

**Correct Usage Pattern:**
```typescript
// CORRECT: Destructure both knex and tenant
const { knex, tenant } = await createTenantKnex();

// Example query
const documents = await knex('documents')
  .where('tenant', tenant)
  .select('*');
```

**Transaction Pattern:**
```typescript
import { withTransaction } from '@alga-psa/db';

// CORRECT: Pass knex as first parameter
const { knex } = await createTenantKnex();

await withTransaction(knex, async (trx) => {
  // Use trx for all operations within the transaction
  await trx('documents').insert({...});
  await trx('document_associations').insert({...});
});
```

**Common Mistakes:**
```typescript
// ❌ WRONG: Missing destructuring
const knex = await createTenantKnex();

// ❌ WRONG: Missing knex parameter
await withTransaction(async (trx) => {...});

// ❌ WRONG: Don't use getConnection()
const knex = await getConnection();
```

Migrations should have a .cjs extension and should be located in the /server/migrations folder.

Run migrations with the migration environment (env) flag.

Every query should filter on the tenant column (including joins) to ensure compatibility with citusdb.

## Local EE migrations
- Do not physically copy EE migrations into `server/migrations/` locally.
- Use the temp-dir overlay runner which points Knex at a merged directory via `MIGRATIONS_DIR`.
- Commands:
  - From repo root: `npm -w server run migrate:ee`
  - From `server/`: `npm run migrate:ee`
- Details and rollback guidance: see `docs/migrations/local-ee-migrations.md`.

## JSON/JSONB Column Handling with Knex

When working with PostgreSQL JSON and JSONB columns in Knex.js, follow these guidelines:

1. **JSONB Column Behavior**
   - PostgreSQL JSONB columns automatically serialize/deserialize JSON data
   - Knex automatically handles the conversion between JavaScript objects/arrays and JSON strings
   - When you store data in a JSONB column, PostgreSQL converts it to binary JSON format
   - When you retrieve data from a JSONB column, PostgreSQL returns it as parsed JavaScript objects/arrays

2. **Storage Pattern**
   ```typescript
   // Store arrays/objects as JSON strings for JSONB columns
   await knex('table_name')
     .insert({
       json_column: JSON.stringify(arrayOrObject)
     });
   ```

3. **Retrieval Pattern**
   ```typescript
   // JSONB columns are automatically parsed - no need to JSON.parse()
   const result = await knex('table_name')
     .select('json_column')
     .first();
   
   // result.json_column is already a JavaScript object/array
   const parsedData = result.json_column || [];  // Use directly
   ```

4. **Common Mistake to Avoid**
   ```typescript
   // WRONG - Don't JSON.parse() data from JSONB columns
   const data = JSON.parse(result.json_column);  // This will fail!
   
   // CORRECT - JSONB data is already parsed
   const data = result.json_column || [];
   ```

5. **Complete Example**
   ```typescript
   // Storing an array in JSONB
   const labelFilters = ['INBOX', 'SENT'];
   await knex('google_email_provider_config')
     .insert({
       label_filters: JSON.stringify(labelFilters)  // Store as JSON string
     });
   
   // Retrieving from JSONB
   const config = await knex('google_email_provider_config')
     .select('label_filters')
     .first();
   
   // Use directly - already parsed by PostgreSQL/Knex
   const filters = config.label_filters || [];  // No JSON.parse() needed
   ```

6. **Error Symptoms**
   - If you see `SyntaxError: Unexpected token` when calling `JSON.parse()` on JSONB data, you're trying to parse already-parsed data
   - If you see `invalid input syntax for type json` when inserting, you may be passing objects instead of JSON strings

7. **Migration Pattern**
   ```sql
   -- Define JSONB column with default
   table.jsonb('json_column').defaultTo('[]');
   ```

## CitusDB Compatibility

1. **CitusDB UPDATE Restrictions**
   - CitusDB does not allow column references with any functions (even type casts) in UPDATE queries
   - This includes IMMUTABLE functions and type casts
   - Solution: Select values first, then update with parameterized queries
   Example:
   ```typescript
   // Bad - Will fail in CitusDB
   await knex.raw(`
     UPDATE table_name 
     SET new_date = old_date::date
     WHERE id = 1
   `);

   // Good - Select and update separately
   const records = await knex('table_name')
     .select('id', 'old_date', 'tenant')
     .where(...);

   for (const record of records) {
     await knex('table_name')
       .where('id', record.id)
       .andWhere('tenant', record.tenant)p
       .update({
         new_date: knex.raw('?::date', [record.old_date])
       });
   }
   ```

2. **Date/Time Handling in CitusDB**
   - Always use parameterized values for type casting
   - Include tenant in WHERE clauses for updates
   - Handle NULL values with separate updates
   Example:
   ```typescript
   // First get the records
   const records = await knex('table_name')
     .select('id', 'date_column', 'tenant')
     .whereNotNull('date_column');

   // Then update with parameterized values
   for (const record of records) {
     await knex('table_name')
       .where('id', record.id)
       .andWhere('tenant', record.tenant)
       .update({
         new_date: knex.raw('?::date', [record.date_column])
       });
   }
   ```

3. **Tenant Column Requirements**
    - Always include tenant column in WHERE clauses
    - Include tenant in JOIN conditions
    - Add tenant to unique constraints and indexes
    Example:
    ```sql
    CREATE UNIQUE INDEX my_unique_index
    ON my_table (tenant, column1, column2);
    ```
    
    **Tenant Column in New Tables:**
    - Always name the column `tenant` (not `tenant_id`)
    - Always use UUID data type for tenant columns
    - **IMPORTANT:** Always include tenant in the primary key for all tables
    - Set NOT NULL constraint on tenant columns
    - Add foreign key reference to tenants table when appropriate
    
    Example for creating a new table with proper tenant column:
    ```sql
    -- Create table with tenant column
    CREATE TABLE my_new_table (
      entry_id uuid NOT NULL,
      tenant uuid NOT NULL,
      -- other columns
      CONSTRAINT my_new_table_pkey PRIMARY KEY (entry_id, tenant),
      CONSTRAINT my_new_table_tenant_foreign FOREIGN KEY (tenant) 
      REFERENCES tenants(tenant)
    );
    ```
    
    For existing tables that need tenant in primary key:
    ```sql
    -- Modify existing table to include tenant in primary key
    ALTER TABLE existing_table DROP CONSTRAINT existing_table_pkey;
    ALTER TABLE existing_table ADD CONSTRAINT existing_table_pkey 
    PRIMARY KEY (id, tenant);
    ```

4. **Tenant Context in Distributed Queries**
    - Connection-specific tenant context (`app.current_tenant`) does not propagate to all shards
    - Queries without shard key (tenant) are broadcast to all shards
    - Each shard connection needs its own tenant context
    - Security policies checking `app.current_tenant` will fail on shards without context
    Example of potential issues:
    ```typescript
    // This could fail if broadcast to all shards
    const results = await knex('some_table')
      .select('*')
      .where('some_column', 'value');
    
    // Always include tenant to avoid broadcast
    const results = await knex('some_table')
      .select('*')
      .where('tenant', currentTenant)
      .andWhere('some_column', 'value');
    ```

5. **GUID Handling in CitusDB**
    - Use UUIDs for GUIDs
    - Use `gen_random_uuid()` function for generating new UUIDs
    Example:
    ```sql
      INSERT INTO my_table (id, tenant, ...)
      VALUES (gen_random_uuid(), 'tenant_value', ...);
    ```

6. **Schema Changes on Distributed Tables**
    - Standard `ALTER TABLE` commands from the coordinator may fail even when data is valid
    - Use `run_command_on_shards()` to apply schema changes directly to each shard
    - After applying to shards, you must also sync the coordinator's catalog metadata
    - This is especially important for NOT NULL constraints

    Example workflow for adding NOT NULL constraint:
    ```sql
    -- Step 1: Verify and update any NULL values on each shard
    SELECT run_command_on_shards('table_name',
      'UPDATE %s SET column = ''default_value'' WHERE column IS NULL');

    -- Step 2: Check for remaining NULLs
    SELECT run_command_on_shards('table_name',
      'SELECT COUNT(*) FROM %s WHERE column IS NULL');

    -- Step 3: Apply NOT NULL constraint on each shard
    SELECT run_command_on_shards('table_name',
      'ALTER TABLE %s ALTER COLUMN column SET NOT NULL');

    -- Step 4: Sync the coordinator's system catalog
    -- This is CRITICAL - without this, the coordinator still thinks the column is nullable
    UPDATE pg_attribute
    SET attnotnull = true
    WHERE attrelid = 'table_name'::regclass
      AND attname = 'column';

    -- Step 5: Now standard ALTER TABLE commands work from the coordinator
    ALTER TABLE table_name
    ALTER COLUMN column SET NOT NULL,
    ALTER COLUMN column SET DEFAULT 'default_value';
    ```

    **Important notes:**
    - The `%s` placeholder in `run_command_on_shards()` is automatically replaced with each shard table name (e.g., `table_name_111544`)
    - The `pg_attribute` update in Step 4 is essential to sync coordinator metadata with shard state
    - Without Step 4, ALTER TABLE from the coordinator will continue to fail with "contains null values"
    - After completing Steps 3 and 4, standard DDL commands can be used normally

## Foreign Key Constraints

- Foreign keys from reference tables to distributed tables are not supported.
- `ON DELETE SET NULL` is not supported and should be handled at the application level.

## Tenants
We use row level security and store the tenant in the `tenants` table.
Most tables require the tenant to be specified in the `tenant` column when inserting.

## Dates and times in the database:
Dates and times should use the ISO8601String type in the types.d.tsx file. In the database, we should use the postgres timestamp type. 

## Date Handling Standards

1. **Use Centralized Date Utilities**
   - Always use `toPlainDate` from `server/src/lib/utils/dateTimeUtils` for date conversions
   - Never use `Temporal.PlainDate.from` directly in components
   - Example:
     ```tsx
     // Good
     import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
     const date = toPlainDate(someDate);

     // Bad
     import { Temporal } from '@js-temporal/polyfill';
     const date = Temporal.PlainDate.from(someDate);
     ```

2. **Date Type Handling**
   - Use ISO8601String type for dates in interfaces and API responses
   - Keep Temporal.PlainDate objects for internal state when date arithmetic is needed
   - Convert to strings when sending to API or database
   Example:
   ```tsx
   // Component state
   const [startDate, setStartDate] = useState<Temporal.PlainDate | null>(null);
   
   // API call
   await createPeriod({
     start_date: startDate?.toString() || '',
     end_date: endDate?.toString() || ''
   });
   ```

3. **Date Comparisons**
   - Use Temporal.PlainDate.compare for date comparisons
   - Ensure dates are in the correct format before comparison
   Example:
   ```tsx
   if (Temporal.PlainDate.compare(startDate, endDate) >= 0) {
     setError('Start date must be before end date');
   }
   ```

4. **Date Display**
   - Use toLocaleString() for displaying dates to users
   - Format dates consistently across the application
   Example:
   ```tsx
   render: (date: ISO8601String) => toPlainDate(date).toLocaleString()
   ```

## Internationalization (i18n)

The application uses **react-i18next** for internationalization. **All client portal UI must be localized** to support multiple languages for end clients.

**Configuration:**
- Supported locales: en, fr, es, de, nl (default: en)
- Namespaces: `common` (shared components), `clientPortal` (client portal specific)
- Translation files: `server/public/locales/{locale}/{namespace}.json`

**Important**: The client portal is fully internationalized. Any component that displays in the client portal must use translation keys.

### Namespace Usage Guidelines

**Use `clientPortal` namespace for:**
- Client portal specific pages and features
- Content that only client users see
- Example: tickets, billing, projects, dashboard

```tsx
'use client';

import { useTranslation } from 'server/src/lib/i18n/client';

export function ClientTickets() {
  const { t } = useTranslation('clientPortal');

  return (
    <div>
      <h1>{t('tickets.title')}</h1>
      <button>{t('tickets.createButton')}</button>
    </div>
  );
}
```

**Use `common` namespace for:**
- Shared components used in both MSP portal and client portal
- Generic UI elements (buttons, forms, dialogs)
- Reusable features like ClientLocations, DataTable
- Example: `server/src/components/clients/ClientLocations.tsx` uses `common` because it's displayed in both MSP and client portal

```tsx
'use client';

import { useTranslation } from 'server/src/lib/i18n/client';

// Shared component that appears in both MSP and client portal
export function ClientLocations({ clientId }: Props) {
  const { t } = useTranslation('common'); // Use 'common' for shared components

  return (
    <div>
      <h3>{t('clients.locations.listTitle')}</h3>
      <Button>{t('clients.locations.buttons.add')}</Button>
    </div>
  );
}
```

### Basic Usage Patterns

**With interpolation:**
```tsx
const { t } = useTranslation('clientPortal');
<p>{t('pagination.showing', { from: 1, to: 10, total: 100 })}</p>
```

**With fallback values:**
```tsx
// Fallback displays if translation key doesn't exist
<span>{t('tickets.messages.error', 'An error occurred')}</span>

// With both interpolation and fallback
<p>{t('pagination.showing', 'Showing {{from}} to {{to}} of {{total}} results', { from: 1, to: 10, total: 100 })}</p>
```

**Formatting utilities:**
```tsx
import { useFormatters } from 'server/src/lib/i18n/client';

const { formatDate, formatNumber, formatCurrency } = useFormatters();
<p>{formatCurrency(99.99, 'USD')}</p>
```

### Best Practices

1. **Always localize client portal content**: Every user-facing string in the client portal must use translation keys
2. **Choose the correct namespace**:
   - `clientPortal` for client-specific content
   - `common` for shared components between MSP and client portal
3. **Never hardcode user-facing text**:
   ```tsx
   // Bad
   <button>Save Location</button>

   // Good
   <button>{t('clients.locations.buttons.save')}</button>
   ```
4. **Use hierarchical keys**: `tickets.messages.loadingError` not `ticketsLoadingError`
5. **Provide fallback values** for error messages and dynamic content
6. **Use interpolation**, not string concatenation: `{{variable}}` in translation strings
7. **Test with different locales** to ensure layouts work with longer text (e.g., German translations)

# Testing Standards

All tests should follow the conventions outlined in [docs/testing-standards.md](./reference/testing-standards.md).

**Quick Reference:**
- **Unit tests**: `server/src/test/unit/` - Isolated tests with mocked dependencies
- **Integration tests**: `server/src/test/integration/` - Multi-component tests with real database
- **Infrastructure tests**: `server/src/test/infrastructure/` - Complete business workflows
- **E2E tests**: `server/src/test/e2e/` - API endpoints and full user flows

**Naming conventions:**
- Unit: `<feature>.test.ts` or `<ComponentName>.test.tsx`
- Integration: `<feature>Integration.test.ts`
- Infrastructure: `<feature>.test.ts` or `<feature>_<aspect>.test.ts` (when split)
- E2E: `<feature>.e2e.test.ts`

**Key principles:**
- Tests are centralized in `server/src/test/`, not colocated with source code
- Mirror source structure using subdirectories within test directories
- Split large test suites by concern using underscore notation (e.g., `billing_tax.test.ts`)
- Use `TestContext` helpers for infrastructure tests
- Use `setupE2ETestEnvironment()` for E2E tests

See the full [Testing Standards](./reference/testing-standards.md) document for complete guidelines, templates, and the decision tree for test placement.

# Time Entry Work Item Types
They can be:
- Ticket
- Project task

There is a work_item_type column in the time_entries table that can be used to determine the type of work item.
There is also a work_item_id column that can be used to reference the work item.

You will need to join against either the tickets or project_tasks table to get the details of the work item, including the company_id.

### Component ID Guidelines (from the UI reflection system)

1. **Use Kebab Case (Dashes, Not Underscores)**
   - Hard Rule: Always use this-style-of-id rather than this_style_of_id
   - Examples:
     * add-ticket-button
     * quick-add-ticket-dialog
     * my-form-field

2. **Make Each ID Uniquely Identifying**
   - Each ID should uniquely identify a single UI element within its scope
   - Avoid short, ambiguous names like button1 or dialog2
   - Include both the type of element and its purpose
   - Good: add-employee-button
   - Bad: button1

3. **Keep IDs Human-Readable**
   - IDs will be used in test scripts, automation harnesses, and debugging logs
   - A quick glance should communicate an element's function or meaning
   - Good: delete-user-dialog
   - Bad: dlg-du-1

4. **Avoid Encoding Variable Data**
   - Do not include dynamic, user-generated content (like user IDs or timestamps)
   - Store variable data in another attribute (e.g., data-user-id="123")
   - Maintain variable data in the component's internal data

5. **Match UI Terminology**
   - Keep IDs consistent with visible labels or component names
   - Example: If UI shows "Quick Add Ticket" dialog, use quick-add-ticket-dialog

6. **Keep It Short but Descriptive**
   - Balance length and clarity
   - Prefer: submit-application-button
   - Avoid: submit-this-application-to-the-server-now-button

7. **Maintain Consistency**
   - Use common patterns across the codebase
   - Apply same principles to all component types
   - Enable predictable ID patterns for automated tooling

8. **Example Patterns**
   - Buttons: {action}-{object}-button
     * add-ticket-button
     * delete-user-button
     * save-form-button
   - Dialogs: {purpose}-{object}-dialog
     * quick-add-ticket-dialog
     * confirmation-dialog
     * edit-profile-dialog
   - Form Fields: {object}-{field}-field or {object}-input
     * ticket-title-field
     * ticket-description-field
     * user-email-input
   - Data Grids: {object}-grid or {object}-{purpose}-grid
     * tickets-grid
     * users-report-grid
