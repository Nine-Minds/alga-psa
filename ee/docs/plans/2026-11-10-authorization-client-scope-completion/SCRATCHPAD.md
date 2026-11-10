# Scratchpad — Authorization completion: client-restricted users

Rolling notes. Append as cards learn things.

## Origin (2026-11-10)

- Written while planning the co-managed seat. A code survey of the authorization kernel found that a client restriction holds on a minority of read paths. Authorization bundles are a shipped Pro feature, so those gaps are defects independent of co-managed.
- Code baseline: `origin/main` at `88c634d5b5`. A local `main` checkout can lag well behind; read from `origin/main`.

## Discoveries

### Kernel

- `packages/authorization/src/kernel/engine.ts`: RBAC evaluator first; then `builtinProvider.evaluate` and `bundleProvider.evaluateNarrowing`; scopes intersected with `intersectAuthorizationScopes`.
- `kernel/providers/bundleProvider.ts`: no matching rule returns `ALLOW_ALL_SCOPE`. Matching is exact on resource and action; `delete` falls back to `update` (`actionAliases.ts`).
- `kernel/providers/builtinProvider.ts`: `resolveDefaultBuiltinRelationshipRules` gives client users `same_client` and internal users no rules. The provider accepts a `resolveRelationshipRules` function, which is the seam for the resolver registry.
- Templates (`kernel/relationshipTemplates.ts`): `own`, `assigned`, `managed`, `own_or_assigned`, `own_or_managed`, `same_client`, `client_portfolio`, `selected_clients`, `same_team`, `selected_boards`, `contact_visibility`. Each has a matcher and a SQL compiler.
- Constraint keys (`bundles/catalog.ts`): `not_self_approver`, `client_visible_only`, `hide_sensitive_fields`. Redaction is actually driven by `config.redactedFields`.
- Tables: `authorization_bundles`, `authorization_bundle_revisions`, `authorization_bundle_rules`, `authorization_bundle_assignments`. `effect` is check-constrained to `narrow`.
- Assignment targets: role, team, user, API key (`bundles/service.ts`).
- Starter bundles: `packages/authorization/src/bundles/starterBundles.ts`, with a drifted copy at `server/src/lib/authorization/bundles/starterBundles.ts`.
- Authoring UI and actions are EE and Pro-gated (`ADVANCED_AUTHORIZATION_BUNDLES`). Evaluation is not tier-checked.

### Where it is consulted today

- Tickets: list compiles SQL through `applyTicketReadAuthorizationSql` in `packages/tickets/src/actions/optimizedTicketActions.ts`; record checks through `authorizeTicketRecordAccess`. REST: `ApiTicketController`, `TicketService`.
- Projects: `packages/projects/src/lib/projectReadAuthorization.ts`, list filtered per row.
- Assets: `packages/authorization/src/assetReadAuthorization.ts`; REST `AssetService`.
- Documents (read): `shared/lib/documentAuthorization.ts`.
- Quotes, EE credentials.

### Where it is not

- `packages/clients` has no kernel use (clients, contacts, interactions).
- `packages/search/src/runAppSearch.ts`: `resolveClientAccess` returns `all` for every non-client user. `acl.ts` documents the seam. Indexers for client, contact, interaction, document and time entry set no `clientScopeId`.
- Time-entry lists, schedule actions, reports, tag lists, document folder tree and stats.
- REST controllers: Client, Contact, TimeEntry, TimeSheet, Invoice, ContractLine, Financial, Interaction, KbArticle, Document (list), Opportunity, ProjectTaskComment, Search, User, Team.
- `scheduling/actions/ticketLookupActions.ts` and `workItemActions.ts`: ticket reads with no permission check (reported).
- `getTicketFormOptions`: all users with no user-type filter, all tag text.
- `ApiTicketController`: SQL narrowing is skipped when a rule redacts fields; the path falls back to per-row filtering.

### Ownership

- 632 tenant tables. 44 have a direct client column, 80 reach a client through parents (66 one hop, 11 two, 3 three), 25 are polymorphic.
- About 30 of those links are columns with no foreign key, so a declaration is not enforced by the database.
- About 10 tables need alternative parents: `comment_threads`, `comments`, `email_reply_tokens`, `project_ticket_links`, `asset_service_history`, `online_meetings` and others.
- Client foreign keys not named `client_id`: `contracts.owner_client_id`, `purchase_orders.drop_ship_client_id`.
- `tickets.client_id`, `contacts.client_id` and `interactions.client_id` are nullable.
- A null client means "every client" for `ticket_templates`, `checklist_templates` and some `inbound_ticket_defaults` rows.
- Existing per-entity client mappings to reuse: `RelationshipSqlAdapter.clientColumn` in the authorization package, and search `client_scope_id`.

## Decisions

- Authorization stays at the action boundary. A row guard in the tenant query facade was investigated and rejected (bypasses, missing user context in background work, silent corruption of derived writes).
- Portfolio on the user; closed on the bundle; ownership declared on the table; built-in resolvers registered by packages.

## Related cards

- "Security: authz in getBoardListStats": board badge counts. Not repeated here.
- "Client merge misses drop-ship purchase orders": the merge roster's per-table client column. The ownership declaration in segment A should be the same fact; coordinate so there is one declaration.

## Leverage notes

Hypotheses only.

- `pattern authorization-subject-resolution`: each package builds its own subject. Segment A extracts one.
- `pattern starter-bundles-copy`: two definitions of the starter bundles. Segment I removes one.
- `friction bundle-default-allow`: callers that need deny-by-default have to enumerate every resource. Segment B adds the closed baseline.
- `friction client-column-by-name`: checks that look for a column literally named `client_id`. Segment A replaces name matching with a declaration.

## Gotchas

- Citus: unique indexes include `tenant`; no triggers; no volatile function in an `UPDATE` on a distributed table.
- Post-query filtering breaks counts and pagination. Lists must narrow in SQL.
- The request cache key for RBAC includes the whole subject, because one request can evaluate several principals.

## S1 — stored portfolio (2026-11-10)

- Table `user_client_portfolios (tenant, user_id, client_id)`: migration `20261110130000_create_user_client_portfolios.cjs`. Primary key `(tenant, user_id, client_id)`; a second unique index `(tenant, client_id, user_id)` is built concurrently and serves client-side lookups. Both foreign keys (`users`, `clients`) cascade on delete.
- Commands: `readUserClientPortfolio`, `setUserClientPortfolio` (atomic replace; locks the user row; refuses a user or client outside the tenant), `clearUserClientPortfolio` in `packages/authorization/src/portfolios/service.ts`, exported from the package index and as `@alga-psa/authorization/portfolios/service`. Read returns sorted client ids, ready to assign to `subject.portfolioClientIds`.
- The `client_portfolio` template needed no change. Both facets already deny on an empty or missing portfolio; T002 (`server/src/test/integration/authorization/clientPortfolio.integration.test.ts`) pins that against the real table.
- A new tenant table is registered in five places: `tenantTableMetadata.ts`, the migration shim `server/migrations/utils/tenantDb.cjs`, `tenantTableManifest.ts`, the FK snapshot `tenantTableForeignKeys.ts`, and `TENANT_TABLES_DELETION_ORDER` in `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`. Two golden tests pin the table count.
- A table with a `client_id` column must also be classified in `packages/clients/src/lib/clientMergePlan.ts` (TM019 reads the schema) and carry `clientKeyed: true` in the manifest. The portfolio moves with the client on merge; where the user already holds the target, the source row is dropped. S3 turns `clientKeyed` into the ownership declaration and should keep this entry.
- The kernel exists twice: `packages/authorization/src/kernel` (live, what tests import) and a drifted copy at `server/src/lib/authorization/kernel`. S1 touched neither.
- Tests that use `TestContext` drop and recreate the suite database. Set `TEST_DB_NAME` per worktree.
