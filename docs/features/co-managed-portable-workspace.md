# Portable workspace components

The customer export is being assembled from explicit, versioned components. A component is not a complete workspace backup. The public export and restore flow must combine identities and configuration, operational records and histories, document blobs, and the [encrypted native vault](co-managed-portable-vault.md), then validate their cross-component references before delivery or restore.

## Identity and directory component

`packages/co-managed/src/portableCoreExport.ts` captures 16 explicit table projections in a repeatable-read database transaction. It derives the tenant from a tracked customer session, retains customer administration and directory/security read permissions, checks record-level narrowing and redactions, and checks session expiry before returning. Explicit departure and licensing lapse do not disable customer export.

The component contains:

- Workspace name and contact information.
- Local users and reporting relationships, teams and memberships.
- Role definitions, permission definitions, and local assignments.
- Clients, locations, contacts, phone/email values and their custom type definitions.
- Saved collaborator names and qualified historical identities already owned by the customer workspace.

Column allowlists exclude password hashes, MFA secrets, login/account bindings, directory authentication metadata, platform billing identifiers, licenses and active sessions. No live relationship, allocation, MSP user row, or MSP-owned record is copied. Saved collaborator references are historical attribution; they do not provision an external login.

The returned component identifies `kind: alga-workspace-core`, `version: 1`, package UUID, source workspace UUID, snapshot timestamp, records, declared relationships and a restore policy requiring fresh authentication and no sponsorship. Its SHA-256 covers the compact JSON payload before the checksum field is added. This checksum detects content changes; it is not a signature or proof of export authorization. The enclosing package still needs authenticated integrity and coordinated component capture.

Validation requires the complete table/column roster, exactly one workspace owner, unique valid identities, valid reference identities and the presence of referenced records within the component. Document references remain explicit dependencies for the document component. Unknown columns cannot smuggle authentication state into this projection. The 100,000-row limit per table fails explicitly rather than truncating the result.

Restore still needs an isolated destination, complete schema validation, identity mapping, destination permissions and paid entitlement where required, file import and atomic insertion. Reading this component does not execute any of those operations or restore live trust.

## Ticket and project component

`portableWorkCatalog.ts` and `portableWorkExport.ts` define 26 projections for ticket/project records, boards and status configuration, checklists, assignments, task dependencies and ticket links, canonical conversations/reactions, ticket activity and historical handoffs. The collector retains customer ticket/project/configuration permissions and record narrowing in a repeatable-read transaction. It preserves rich-text source, markdown, customer-private and shared audiences, tombstones that still have native rows, and saved foreign author names.

MSP private stores are never queried. Comment/email transport metadata, provider thread identifiers, scheduling job/dispatch IDs, billing-profile pointers and live co-management relationship tables are absent. Ticket activity retains curated operational changes and explicit scalar detail fields; arbitrary metadata cannot introduce transport credentials. Handoffs are exported as inert `handoff_history` events without relationship IDs or command fingerprints. Restore must convert these to historical activity and leave imported scheduled publication paused.

The work component declares source relationships and rejects missing included parents or invalid conversation roots. Additional cross-component user/service/SLA references, legacy histories with physically missing roots, project mutation audit coverage, attachments/blobs and complete destination reconstruction still need to be handled by the full package flow. This component alone is not a restorable workspace.

## Document and KB component

`portableDocumentCatalog.ts` and `portableDocumentExport.ts` select 15 document/KB projections, including versions, block/text content, associations, folders, templates and article review records. The collector reuses the normal document association resolver from `shared/lib/documents/authorizationRecords.ts`, with optional retained association/parent locks. It requires current document and system-configuration permissions, applies document narrowing/redactions, and retains the existing co-managed meeting-artifact admission.

Referenced native files and legacy documents with a storage path are streamed into a private temporary directory. File byte counts must match the selected source metadata. Each staged file has a SHA-256 digest and mode `0600`; the directory has mode `0700`. Storage paths must match the customer's native or generated-PDF layout and cannot contain traversal segments. File bindings connect the portable blob identity to the document's main, thumbnail or preview slot.

Provider reads happen outside database transactions. Before returning the staging lease, the collector repeats source selection and authority checks and rejects a changed snapshot. Failures remove staged files. The trusted archive assembler must call the lease's `dispose()` in `finally`; temporary filesystem paths must never be returned to a browser. The portable component contains blob identities, sizes, names, MIME types, checksums and document bindings, without provider buckets or storage paths.

This stages bytes for the archive; it does not yet publish a downloadable backup or insert files into a destination. Other inline/media references, archive-wide authenticated integrity and coordinated capture remain part of the full package work.

## Published conversation files

`portableConversationExport.ts` selects ready customer-owned files attached to published canonical ticket comments. It uses the existing published-attachment query and purpose-specific path validation, retains the actual ticket/comment/root and read permissions, and preserves each attachment's thread, audience and qualified author. A surviving reply can retain its file when the root is a soft-deleted tombstone. Pending/unpublished uploads, discarded/purged files, and MSP-private stores are excluded. Customer-owned published files remain exportable after departure.

The shared `portableBlobStaging.ts` transport handles both document and conversation bytes. Conversation files must match their previously stored SHA-256 as well as their declared size. After streaming, the collector rechecks its source and current authority; failures dispose the lease. The component contains no storage path or live relationship identity. Its restore policy requires converting the bindings to native ticket documents and rewriting file links, without restoring co-management download routes or trust. That destination conversion remains part of the unfinished full restore.

## Focused validation

From `server/`, run:

```sh
SECRETS_PATH=../secrets npm exec -- vitest run src/test/integration/coManagedBootstrap.integration.test.ts -t 'portable workspace core|portable vault export|portable work export|portable document export|portable conversation export'
```

The selected tests use a disposable schema-only copy of the development database. They cover actual record projections, secret/trust exclusion, saved attribution, reference integrity and customer permission/session denial. The vault cases exercise its audit and post-encryption authority checks. They do not prove a complete isolated workspace restore.

## Inventory and operational configuration

`portableAssetExport.ts` adds 19 explicit projections covering assets, custom types, typed device details, software inventory, relationships, maintenance history and document/ticket associations. It retains native asset association-derived access and rejects denied or redacted assets. RMM connection identifiers, integration bindings and procurement pointers are excluded, including direct copies in asset change history. Observed device facts remain historical snapshots. Restore must leave maintenance paused and require fresh integration authorization; notification dispatch rows are not exported.

`portableOperationalExport.ts` adds 17 projections covering time entries, sheets and review records, time periods, schedules and assignments, working hours, holidays and SLA configuration. It reuses native employee, work-source, calendar privacy and field-redaction rules. Another employee's private event can therefore prevent a complete export under current permissions; this component does not introduce an administrator bypass. Time timestamps preserve elapsed effort: native co-managed time is operational and its persisted billing fields are empty by invariant. Running timers, commercial links and live notification dispatch are excluded. Interaction and appointment references are declared dependencies on future sections.

The components use `portableRecordValidation.ts` for exact table/column rosters, UUID and composite identities, singleton counts and included parent relationships. The shared reference validator can require cross-section parents after assembly; component-local validation alone does not establish a complete archive. Each collector still captures its own snapshot. Coordinated capture, authenticated archive integrity, full reference remapping, workflow/interaction records, public export delivery and isolated restore remain unfinished.

## Coordinated database cutoff

`portableSnapshot.ts` supplies an internal short-lived capture capability, backed by PostgreSQL's [snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION). Collectors import it before their first query, using the [required repeatable-read transaction mode](https://www.postgresql.org/docs/current/sql-set-transaction.html). All imported collectors see one database cutoff and record the same capture timestamp. A capability cannot be copied, reused after capture ends, or passed to a different connection object. It does not grant customer authority.

The transaction retaining the snapshot performs no customer reads and holds no customer-row or authentication locks. Each collector retains its own normal authority and source locks. File and vault collectors import the snapshot only for initial selection; their post-provider source and permission checks use fresh transactions. New commits after capture do not enter the earlier snapshot, while a changed retained row produces a serialization failure instead of authorizing from its old contents.

This provides consistent selection, not a completed archive coordinator. Final archive delivery still needs fresh authorization across all included records and a complete authenticated manifest; a frozen snapshot alone cannot observe newly inserted policy restrictions. Snapshot lifetime must remain bounded by the awaited collection operation. Citus distributed snapshot behavior and a complete isolated restore are not yet validated.
