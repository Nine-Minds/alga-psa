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

Lucide icons can (and should) be used from the `lucide` package.

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

## Tenants
We use row level security and store the tenant in the `tenants` table.
Most tables require the tenant to be specified in the `tenant` column when inserting.

## Dates and times in the database:
Dates and times should use the ISO8601String type in the types.d.tsx file. In the database, we should use the postgres timestamp type. 

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
