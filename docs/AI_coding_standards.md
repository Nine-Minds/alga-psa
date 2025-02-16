# Note to AI editor Claude / GPT-4 / O1 / etc

- If you need to see any additional files before you are sure you have enough context, ask the user to provide the file to the context before continuing.
- If you would like to search for the contents to files, offer to use the run command and grep command to search for the contents.
- Do not proceed to updating files until you have enough context to do so.


# UI coding standards

Prefer radix components over other libraries

## UI Components

- Use component from `@/components/ui' folder
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

## DataTable Action Menus

When implementing action menus in DataTable components, follow these guidelines:

1. **Component Structure**
   - Use Radix UI's DropdownMenu components from '@/components/ui/DropdownMenu':
     ```tsx
     import {
       DropdownMenu,
       DropdownMenuTrigger,
       DropdownMenuContent,
       DropdownMenuItem,
     } from '@/components/ui/DropdownMenu';
     ```

2. **Trigger Button Implementation**
   - Use the Button component from '@/components/ui/Button'
   - Import MoreVertical icon from 'lucide-react'
   ```tsx
   <DropdownMenuTrigger asChild>
     <Button
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
   <Button id="billing-plan-actions-menu">
   <DropdownMenuItem id="edit-billing-plan-menu-item">
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

## User session handling
To get the current user on server side actions, use the getCurrentUser function from the server/src/lib/actions/user-actions/userActions.ts file.

## Server Communication

We use server actions that are located in the `/server/src/lib/actions` folder.

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

Migrations should have a .cjs extension and should be located in the /server/migrations folder.

Run migrations with the migration environment (env) flag.

Every query should filter on the tenant column (including joins) to ensure compatibility with citusdb.

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

## Tenants
We use row level security and store the tenant in the `tenants` table.
Most tables require the tenant to be specified in the `tenant` column when inserting.

## Dates and times in the database:
Dates and times should use the ISO8601String type in the types.d.tsx file. In the database, we should use the postgres timestamp type. 

## Date Handling Standards

1. **Use Centralized Date Utilities**
   - Always use `toPlainDate` from `@/lib/utils/dateTimeUtils` for date conversions
   - Never use `Temporal.PlainDate.from` directly in components
   - Example:
     ```tsx
     // Good
     import { toPlainDate } from '@/lib/utils/dateTimeUtils';
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
