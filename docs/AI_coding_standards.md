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

Always use commands like "cd server && npx knex migrate:make <name> --knexfile knexfile.cjs" to create a new migration. Do the same for seeds.

The knexfile is located in the /server/knexfile.cjs file and is used to configure the database connection.

Use createTenantKnex() from the /server/src/lib/db/index.ts file to create a database connection and return the tenant as a string.

Migrations should have a .cjs extension and should be located in the /server/migrations folder.

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