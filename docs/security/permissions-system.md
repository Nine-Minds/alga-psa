# Permissions System

How Alga PSA stores permissions, which roles every tenant starts with and what they hold, how those defaults reach a tenant, and how a permission is checked at request time.

For what each screen and task checks, see [Permission Reference](permission-reference.md). For how to add, reword or remove a permission, see the [permission catalog README](../../server/migrations/utils/permissions/README.md).

## Data model

Four tables, all tenant-scoped and all local (undistributed) on Citus:

| Table | Holds |
| --- | --- |
| `permissions` | One row per permission the tenant has: `resource`, `action`, `msp`, `client`, `description` |
| `roles` | The tenant's roles: `role_name`, `msp`, `client` |
| `role_permissions` | Which role holds which permission |
| `user_roles` | Which user holds which role |

A permission's identity is `(resource, action, msp, client)`. The `msp` and `client` flags say which portal it applies to. A row can be MSP-only, client-only, or both, and `ticket:read` for MSP users and `ticket:read` for portal users are separate rows. The tenant is supplied by the table, never by the catalog.

The resource and action are free text. A permission exists in a tenant only if a row was written for it, so code that checks a resource:action with no row grants it to nobody, Admin included.

## Products and default roles

Each tenant has a `product_code`. It decides which catalog permissions the tenant is provisioned with and which roles it starts with.

| Product | MSP roles | Client portal roles |
| --- | --- | --- |
| `psa` | Admin, Technician, Dispatcher, Project Manager, Finance | Admin, Finance, User |
| `algadesk` | Admin, Agent | Admin, User |
| `co_managed` | Admin, Technician, Dispatcher, Project Manager | Admin, User |

The onboarding seeds create these roles (`ee/server/seeds/onboarding/<product>/01_roles.cjs`). Other role kinds:

- **Required roles.** MSP Admin and client portal Admin. The product protects them from deletion and renaming, and catalog sync refuses to run on a tenant that has none or duplicates of either.
- **Legacy roles.** `Manager` is marked `legacy` in `roleGrants.cjs`. No product creates it, so no hosted tenant has it. The developer seed `server/seeds/dev/46_roles.cjs` still creates it, which is why it appears on local databases. Its catalog grants apply only where the role already exists.
- **Capability roles.** `Seat Technician` exists only in a PSA tenant admitted to the co-managed seat capability. Its grants are a closed list in `CAPABILITY_ROLES` (`roleGrants.cjs`), not the catalog's `defaultGrants`, so a new catalog permission never reaches it by default.
- **Custom roles.** Anything a tenant creates. Catalog sync never grants to them.

Admins can edit every role's permissions in Settings > Security > Permissions except Admin's. That lock is enforced in the matrix UI, not on the server.

## Where defaults come from

`server/migrations/utils/permissions/catalog.cjs` is the single source of truth. Each entry in `ACTIVE_PERMISSIONS` declares:

- its identity and description;
- `products`: the products whose tenants get the row;
- `defaultGrants`: per product, the default roles that hold it (for example `psa: ['msp:Admin', 'msp:Finance']`);
- optionally `capabilities`: the row is provisioned only where the tenant holds that capability.

MSP Admin is marked `allMsp` in `roleGrants.cjs`, so it receives every MSP-scoped permission of its product, whatever `defaultGrants` says. Every other default role receives only the entries that name it. The full result is in [Default grants](#default-grants) below.

## How defaults reach a tenant

All paths go through `reconcileAllTenants` (`reconcileTenants.cjs`), which compares the tenant with the catalog and applies the difference:

| Path | When |
| --- | --- |
| Onboarding seeds `ee/server/seeds/onboarding/<product>/02_permissions.cjs` and `03_role_permissions.cjs` | A new tenant is created |
| Developer seeds `server/seeds/dev/47_permissions.cjs` and `48_role_permissions.cjs` | A local or test database is seeded |
| A numbered migration that calls `reconcileAllTenants` | A new permission or grant ships to existing tenants |

Sync is additive. For each tenant it inserts missing catalog permissions, rewrites descriptions that differ from the catalog, and inserts any missing grant to a default role. It never deletes a permission, a grant or a role, and it never touches custom roles.

Because it re-adds missing default grants, a reconcile migration also restores a default grant that a tenant's admin removed on purpose. Use it only when you mean to provision permissions. A wording change needs a description-only migration instead (see the catalog README).

`auditPermissionCatalog.cjs` runs the same comparison read-only and reports drift without writing.

## How a check runs

Server actions and API routes call `hasPermission(user, resource, action)` (`packages/auth/src/lib/rbac.ts`), usually inside a `withAuth` wrapper:

1. It loads the user's roles and their permissions from the database on every call. Nothing is cached in the session, so a role change applies on the user's next request.
2. It keeps only roles and permissions for the user's portal. An MSP user counts roles and permissions flagged `msp`, and a client portal user counts those flagged `client`.
3. It returns true if any remaining permission matches the resource and action exactly.

There is no Admin bypass in `hasPermission`. Admin passes because it holds every row.

Common helpers built on it:

- `assertMspPermission` and `assertInternalReadAccess` throw instead of returning false, and refuse client portal users.
- `hasCommercialReadPermission` (`packages/auth/src/lib/commercialAccess.ts`) passes an internal user holding `service:read` or `billing:read`. It gates the Billing page and service catalog lookups.

**Record narrowing comes after the role check.** The authorization kernel (`packages/authorization`) decides which records a user may read or change: client scope, own records, co-managed seat rules, and in Enterprise Edition the authorization bundles managed under Settings > Security > Policies. A user can hold `ticket:update` and still be refused on a ticket outside their scope.

**The sidebar loads permissions once.** Menu entries with a `requiredPermission` (`server/src/config/menuConfig.ts`) are filtered by `getCurrentUserPermissions` when the layout mounts, so they change only after a reload. Most entries have no `requiredPermission` and are shown to every user. The check happens when the screen loads its data.

## Exceptions to the model

These checks do not follow the resource:action pattern. Keep them in mind when answering "the user has the permission but still can't":

- **Role-name checks.** Resetting another user's password, managing every user's API keys, outbound webhooks and the MCP server settings require a role named `Admin` (case-insensitive). `user:reset_password` and the `webhook` permissions are not consulted on those screens. The Technician Dispatch board also lets a role named `Admin` skip its `technician_dispatch` check.
- **Client portal admin.** Managing portal users and visibility groups from the portal requires the portal role named `Admin`. Its holder's contact is flagged `is_client_admin` (`packages/db/src/lib/clientPortalAdminFlag.ts`). A custom portal role with the same `user` permissions is not enough.
- **App and REST API differ.** Some catalog permissions are checked only by the REST API, for example `invoice:finalize`, `invoice:send`, `invoice:credit`, the `financial` resource and the `role` resource. The app checks other permissions for the same tasks. Each permission's description says which.
- **A resource name is not always the screen.** Quotes, contracts and contract lines use `billing`. Project task edits use `project:update`, while `project_task` covers task comments and tags only.

## Default grants

Generated from `catalog.cjs` and `roleGrants.cjs`. "all" means the role is `allMsp` and holds every MSP permission of the product. A dash means the role has no permission on that resource. Legacy roles are left out.

These are the grants a new tenant starts with. A tenant's admin can change them, so check the tenant's Settings > Security > Permissions for its current state.

#### PSA: MSP roles

| Resource | Admin | Finance | Technician | Project Manager | Dispatcher |
| --- | --- | --- | --- | --- | --- |
| `account_management` | all | - | - | - | - |
| `accounting_integrations` | all | catalog_read, exports_execute, mappings_manage | - | - | - |
| `asset` | all | read | create, read, update | read | read |
| `billing` | all | create, delete, read, update | - | read | - |
| `billing.recurring_service_periods` | all | - | - | - | - |
| `billing_profile_report` | all | read | - | - | - |
| `billing_settings` | all | create, delete, read, update | - | read | - |
| `canned_response` | all | - | create, delete, read, update | read | read |
| `client` | all | create, delete, read, update | delete, read | create, read, update | read |
| `contact` | all | create, delete, read, update | delete, read | create, read, update | read |
| `credential` | all | - | create, delete, read, reveal, update | read, reveal | read, reveal |
| `credit` | all | create, delete, read, transfer, update | - | - | - |
| `cycle_count` | all | - | - | - | - |
| `document` | all | create, delete, read, update | create, read, update | create, read, update | read |
| `email` | all | - | - | - | - |
| `extension` | all | - | - | - | - |
| `financial` | all | create, delete, read, transfer, update | - | - | - |
| `import_export` | all | - | - | - | read |
| `inbound_webhook` | all | - | - | - | - |
| `interaction` | all | create, delete, read, update | create, read, update | create, read, update | create, read, update |
| `inventory` | all | - | - | - | - |
| `invoice` | all | create, credit, delete, finalize, generate, payment, read, send, update, void | - | read | - |
| `job` | all | - | - | - | - |
| `list_view` | all | - | - | - | share |
| `marketing` | all | - | - | - | - |
| `metadata` | all | - | - | - | - |
| `notification` | all | - | - | - | - |
| `opportunities` | all | - | - | - | - |
| `priority` | all | - | - | - | - |
| `project` | all | read, update | read | create, delete, read, update | read |
| `project_task` | all | read, update | create, read, update | create, delete, read, update | read |
| `purchase_order` | all | - | - | - | - |
| `quotes` | all | - | - | - | - |
| `recurring_ticket` | all | - | read | - | create, delete, read, update |
| `reports` | all | read | read | read | read |
| `rmm` | all | - | - | - | - |
| `role` | all | - | - | - | - |
| `sales_order` | all | - | - | - | - |
| `secrets` | all | - | - | - | - |
| `security_settings` | all | - | - | - | - |
| `service` | all | read | read | read | read |
| `service_principal` | all | - | - | - | - |
| `settings` | all | - | - | - | - |
| `sla_policy` | all | - | read | read, update | - |
| `stock_location` | all | - | - | - | - |
| `stock_transfer` | all | - | - | - | - |
| `storage` | all | - | - | - | - |
| `system_settings` | all | - | - | - | - |
| `tag` | all | create, read | create, read, update | create, read, update | create, read, update |
| `tax` | all | - | - | - | - |
| `team` | all | - | - | - | - |
| `technician_dispatch` | all | read | read | read | create, read, update |
| `ticket` | all | read, update | create, read, update | create, read, update | create, read, update |
| `ticket_settings` | all | - | read | - | - |
| `ticket_template` | all | - | read | read | read |
| `time_entry` | all | create, delete, read, update | create, read, update | create, read, update | read |
| `time_period` | all | - | - | - | - |
| `time_sheet` | all | read, read_all, submit | read, read_all, submit, update | approve, read, read_all, reverse, submit, update | read |
| `user` | all | read | - | invite, read | read |
| `user_schedule` | all | read | read | read | create, read, update |
| `user_settings` | all | - | - | read | read |
| `vendor` | all | - | - | - | - |
| `vendor_bill` | all | - | - | - | - |
| `warranty` | all | - | create, read, update | - | - |
| `webhook` | all | - | - | - | - |
| `workflow` | all | - | - | - | - |

#### PSA: client portal roles

| Resource | Admin | Finance | User |
| --- | --- | --- | --- |
| `billing` | create, read, update | read | - |
| `client` | create, delete, read, update | create, read, update | create, read, update |
| `document` | create, read, update | create, read, update | create, read, update |
| `project` | create, delete, read, update | read | read |
| `settings` | read, update | read | - |
| `ticket` | create, read, update | create, read, update | create, read, update |
| `user` | create, delete, read, reset_password, update | read | - |

#### AlgaDesk: MSP roles

| Resource | Admin | Agent |
| --- | --- | --- |
| `account_management` | all | - |
| `billing.recurring_service_periods` | all | - |
| `billing_profile_report` | all | - |
| `canned_response` | all | create, delete, read, update |
| `client` | all | read |
| `contact` | all | read |
| `credential` | all | - |
| `cycle_count` | all | - |
| `document` | all | create, read, update |
| `import_export` | all | - |
| `list_view` | all | - |
| `marketing` | all | - |
| `metadata` | all | - |
| `priority` | all | - |
| `quotes` | all | - |
| `recurring_ticket` | all | read |
| `reports` | all | read |
| `role` | all | - |
| `secrets` | all | - |
| `security_settings` | all | - |
| `settings` | all | - |
| `system_settings` | all | - |
| `tag` | all | create, read, update |
| `tax` | all | - |
| `team` | all | - |
| `ticket` | all | create, read, update |
| `ticket_settings` | all | read |
| `ticket_template` | all | read |
| `user` | all | read |
| `user_settings` | all | read |
| `vendor_bill` | all | - |
| `webhook` | all | - |

#### AlgaDesk: client portal roles

| Resource | Admin | User |
| --- | --- | --- |
| `client` | read, update | read |
| `contact` | read, update | read |
| `document` | create, read, update | create, read, update |
| `settings` | read, update | - |
| `ticket` | create, delete, read, update | create, read, update |
| `user` | create, delete, read, reset_password, update | - |

#### Co-managed: MSP roles

| Resource | Admin | Technician | Project Manager | Dispatcher |
| --- | --- | --- | --- | --- |
| `canned_response` | all | create, delete, read, update | read | read |
| `client` | all | read | create, read, update | read |
| `co_management` | all | - | - | - |
| `contact` | all | read | create, read, update | read |
| `interaction` | all | create, read, update | create, read, update | create, read, update |
| `knowledge_base` | all | read | read | read |
| `list_view` | all | - | - | share |
| `metadata` | all | - | - | - |
| `notification` | all | - | - | - |
| `priority` | all | - | - | - |
| `recurring_ticket` | all | read | - | create, delete, read, update |
| `security_settings` | all | - | - | - |
| `settings` | all | - | - | - |
| `system_settings` | all | - | - | - |
| `tag` | all | create, read, update | create, read, update | create, read, update |
| `team` | all | - | - | - |
| `ticket` | all | create, read, update | create, read, update | create, read, update |
| `ticket_attachment` | all | create, read | create, read | create, read |
| `ticket_settings` | all | read | - | - |
| `ticket_template` | all | read | read | read |
| `user` | all | - | invite, read | read |
| `user_settings` | all | - | read | read |

#### Co-managed: client portal roles

| Resource | Admin | User |
| --- | --- | --- |
| `client` | create, delete, read, update | create, read, update |
| `knowledge_base` | read | read |
| `project` | read | read |
| `project_task_comment` | create | create |
| `settings` | read, update | - |
| `ticket` | create, read, update | create, read, update |
| `ticket_attachment` | create, read | create, read |
| `user` | create, delete, read, reset_password, update | - |
