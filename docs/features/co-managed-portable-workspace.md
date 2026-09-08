# Portable workspace components

The customer export combines explicit, versioned components in an authenticated encrypted archive: identities and configuration, operational records and histories, document blobs, and the [encrypted native vault](co-managed-portable-vault.md). The coordinator validates cross-component references before delivery. Installation operators can restore the supported contents into a new suspended tenant; activation is available with an independent self-hosted license or an already provisioned paid hosted subscription. Remaining content coverage and recovery work are described below.

## Identity and directory component

`packages/co-managed/src/portableCoreExport.ts` captures 16 explicit table projections in a repeatable-read database transaction. It derives the tenant from a tracked customer session, retains customer administration and directory/security read permissions, checks record-level narrowing and redactions, and checks session expiry before returning. Explicit departure and licensing lapse do not disable customer export.

The component contains:

- Workspace name and contact information.
- Local users and reporting relationships, teams and memberships.
- Role definitions, permission definitions, and local assignments.
- Clients, locations, contacts, phone/email values and their custom type definitions.
- Saved collaborator names and qualified historical identities already owned by the customer workspace.

Column allowlists exclude password hashes, MFA secrets, login/account bindings, directory authentication metadata, platform billing identifiers, licenses and active sessions. No live relationship, allocation, MSP user row, or MSP-owned record is copied. Saved collaborator references are historical attribution; they do not provision an external login.

The returned component identifies `kind: alga-workspace-core`, `version: 1`, package UUID, source workspace UUID, snapshot timestamp, records, declared relationships and a restore policy requiring fresh authentication and no sponsorship. Its SHA-256 covers the compact JSON payload before the checksum field is added. This checksum detects content changes; it is not a signature or proof of export authorization. The enclosing archive supplies authenticated integrity and the coordinator captures components at one database cutoff.

Validation requires the complete table/column roster, exactly one workspace owner, unique valid identities, valid reference identities and the presence of referenced records within the component. Document references remain explicit dependencies for the document component. Unknown columns cannot smuggle authentication state into this projection. The 100,000-row limit per table fails explicitly rather than truncating the result.

Restore still needs an isolated destination, complete schema validation, identity mapping, destination permissions and paid entitlement where required, file import and atomic insertion. Reading this component does not execute any of those operations or restore live trust.

## Ticket and project component

`portableWorkCatalog.ts` and `portableWorkExport.ts` define 29 projections for ticket/project records, boards and status configuration, checklists, assignments, task dependencies and ticket links, canonical conversations/reactions, ticket activity and historical handoffs. The collector retains customer ticket/project/configuration permissions and record narrowing in a repeatable-read transaction. It preserves rich-text source, markdown, customer-private and shared audiences, tombstones that still have native rows, and saved foreign author names.

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

The components use `portableRecordValidation.ts` for exact table/column rosters, UUID and composite identities, singleton counts and included parent relationships. The shared reference validator can require cross-section parents after assembly; component-local validation alone does not establish a complete archive. Collectors participate in the coordinated capture described below. A customer export route and UI now provide streamed delivery. Remaining record/file coverage and complete isolated restore admission/activation remain unfinished.

## Coordinated database cutoff

`portableSnapshot.ts` supplies an internal short-lived capture capability, backed by PostgreSQL's [snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION). Collectors import it before their first query, using the [required repeatable-read transaction mode](https://www.postgresql.org/docs/current/sql-set-transaction.html). All imported collectors see one database cutoff and record the same capture timestamp. A capability cannot be copied, reused after capture ends, or passed to a different connection object. It does not grant customer authority.

The transaction retaining the snapshot performs no customer reads and holds no customer-row or authentication locks. Each collector retains its own normal authority and source locks. File and vault collectors import the snapshot only for initial selection; their post-provider source and permission checks use fresh transactions. New commits after capture do not enter the earlier snapshot, while a changed retained row produces a serialization failure instead of authorizing from its old contents.

The workspace coordinator combines this consistent selection with a fresh transaction that rechecks every collected section before local encrypted-file consumption; a frozen snapshot alone cannot observe newly inserted policy restrictions. Snapshot lifetime must remain bounded by the awaited collection operation. Citus distributed snapshot behavior and a complete isolated restore are not yet validated.

## Workflow definitions and engagement records

`portableWorkflowExport.ts` captures five definition/configuration tables: workflow drafts, published version history, form definitions and schemas, and task definitions. It requires native workflow administration/read authority and records explicit local, text-form and system-form dependencies. Existing workflow dependency analysis finds schema/action references; secret expressions remain names and never cause a provider lookup. Authored JSON can contain literal sensitive values, so the complete archive must be encrypted, not only its vault section. Restore must leave workflows/forms paused and in draft, retain old published versions only as history, remap embedded identities, rerun validation and require explicit connection/secret review before activation. Execution histories, leases and dispatch queues are not restored by this component.

`portableEngagementExport.ts` captures interactions, appointment requests, availability, meeting/artifact metadata and referenced operational service descriptors. It retains actual native owners and rejects redacted or inaccessible private meetings. Meeting provider IDs, join credentials, connection details, live dispatch and service prices are excluded. Known availability configuration is projected explicitly; approver identities are declared JSON references. Meeting artifact document/file bindings connect to document, supplemental native-file and remote Teams capture components. Destination reconstruction must supply safe inert defaults where the native schema requires provider artifact IDs or commercial service fields. Operational timesheet notes are preserved alongside sheet review history.

## Independent AI ownership

The shared licensing helper `getSelfHostAiGatewayCredential` prevents co-managed and independently upgraded workspaces from borrowing the installation's AI gateway account. Both EE and CE clients use it; a database failure cannot select a hosted-token fallback. Ordinary appliance workspaces retain their existing account, and hosted workspaces use their own tenant JWT identity. No tenant-owned self-host AI connection flow exists yet, so customer workspaces receive a connection-required error. Connection setup and explicit direct-provider bypass ownership remain separate unfinished work.

Service descriptors include task-only references as well as appointment and availability references. A task contributes its service only after retained native project/task admission. Custom service types retain their standard-type mapping and the referenced global definition. No service prices are included. The document, conversation-file and vault final checks intentionally compare their whole current section to the captured source; unrelated additions after cutoff can require a retry on a busy workspace.

## Authenticated archive transport and restore preparation

`portableArchive.ts` encrypts the complete JSON manifest and ordered file bytes with a customer passphrase. Version 1 uses fixed scrypt parameters and AES-GCM frames with the public header, frame index, length and final marker authenticated. Reordering, truncation, substitution and appended bytes fail verification. File identifiers are restricted to typed UUIDs; extraction never uses paths supplied by the archive. All frames are authenticated into private quarantine before parsing the manifest or returning a usable lease. Each extracted blob must match its declared byte count and SHA-256.

The transport accepts only JSON data, checks encoded metadata size before serialization, and bounds metadata, nesting, file count and total bytes. Temporary directories use mode `0700`, files use `0600`, and failures clean up owned staging. Callers dispose successful leases. Opening requires space for both quarantine and extracted bytes, approximately twice the plaintext size; deployment storage admission remains the caller's responsibility. The container transport remains internal; the customer route supplies export authorization and a separate restore admission layer is still required. The authenticated context must match the manifest's package/workspace identity before destination use.

`portableWorkspaceGraph.ts` validates the seven assembled record sections against trusted application catalogs and checks scalar, polymorphic, conditional and known nested approver references. Unknown sections or dangling local dependencies fail. Ticket severity, urgency and impact definitions now accompany their ticket references. Document source-template values are inert render provenance, which may be standard codes or historical UUIDs; they are not incorrectly required to be live custom templates. The outer manifest validates blob membership and vault metadata separately. Arbitrary embedded rich text/workflow identities still require destination adapters.

`portableRestoreIdentity.ts` is a pure remapping engine for an already authenticated and validated record set. Trusted metadata declares local UUID roots, extension aliases, composite keys, preserved text keys and global definitions resolved against destination catalogs. Allocation rejects collisions; references cannot invent another identity domain. Local authors map only when their user exists in the imported set. Foreign authors and deleted local authors retain their original qualified pair as historical attribution, without creating a login. The workspace adapter applies the explicit polymorphic and known nested identity mappings. Authored nested content, file bindings, actual database insertion and destination entitlement/admission remain separate restore work.

`portableSupplementalFileExport.ts` stages native meeting artifact files not already covered by exported document primary/thumbnail/preview references. Native artifact authority is retained before capture and repeated after storage reads; privacy or coverage changes abort delivery. The shared `portableNativeFilePath.ts` validates native customer/PDF storage paths. The EE remote meeting collector captures provider-only recordings and transcripts through retained Graph locators; stored arbitrary content URLs never become fetch targets.


## Package manifest and final export admission

`portableWorkspaceManifest.ts` binds all seven full record components, conversation/supplemental/remote files and the encrypted native vault to one package and source tenant. Record components share the capture timestamp. Component checksums detect accidental mixing; archive authentication supplies integrity. The validator uses the application record graph, checks actual document/artifact/conversation relationships, and requires exact size/hash membership across declared and staged blobs. Multiple bindings can share one native file declaration. Unknown headers, storage paths in descriptors, missing or extra blobs and mismatched credential metadata references fail. Restored credential IDs must additionally match the decrypted vault roster; manifest validation does not unlock secrets. Archive-supplied reference and restore-policy declarations are informational, never executable restore instructions.

`prepareCoManagedPortableWorkspaceExport` collects under one shared database cutoff, stages provider bytes outside admission transactions, seals the complete encrypted archive and removes plaintext staging. Its single-use `consume` handle rechecks all source records, native permissions, file metadata and vault metadata inside one fresh repeatable-read transaction before exposing the encrypted local artifact to a trusted callback. Core and work rows are retained with share locks through this check. Changed source data or revoked authority prevents the callback; failure and unused-handle disposal remove the package. This internal callback must finish local-file consumption before resolving. The dedicated acquireDownload path opens an encrypted file descriptor under admission and hands it to HTTP streaming only after the transaction commits. Preparation runs inside the bounded transfer context described below, including request cancellation propagated from HTTP.

`portableRemoteMeetingExport.ts` derives Teams endpoints only from actual retained meeting creation receipts and the customer's current active profile. OAuth and Graph requests reject redirects, bound time and response size, and never fetch stored arbitrary content URLs. Files use private streaming staging with byte/hash checks. Provider configuration is checked around capture; final coordinator admission repeats retained database metadata checks without provider calls. Native transcript blocks and document-backed files use their existing components.

`prepareCoManagedPortableWorkspaceRecords` now supplies the trusted identity roster for all 113 tables. It remaps scalar/composite/alias identities, conditional associations, thread roots, work-item links and known nested approvers. The four global catalogs must map to existing destination definitions and are explicitly excluded from insertion. Users remain inactive, automation remains paused, and terminal meeting history is preserved. Operational time receives unpriced insertion defaults. The adapter performs no database writes or activation. Native file/vault/database insertion now has tested internal adapters. Authored inline-reference rewriting, isolated destination admission and activation remain required.


## Customer download and isolated native insertion

The flagged `/msp/co-management/export` page loads the current customer's administrator admission and posts a recovery passphrase to `/api/co-management/export`. The route is independent of the release flag, requires the tracked internal home session and a same-origin request, accepts a bounded body, and never puts a passphrase in a URL or job. The native browser download avoids buffering the entire archive in browser memory. Recovery fields are uncontrolled password inputs so their values do not enter UI reflection metadata. All ten locale catalogs include the new screen labels. Co-managed export and file routes now explicitly bypass API-key middleware in favor of their own tracked-session admission; unrelated routes retain API-key checks.

`portableDownload.ts` opens only the sealed regular file with symlink following disabled while current export admission is retained. The coordinator unlinks its staging path after acquisition. HTTP receives the open descriptor after the transaction commits and streams in bounded chunks; EOF, cancellation, truncation and failure close it. This linearizes authorization at download admission, as with already-authorized historical evidence; the stream does not continue reading live source records. A real database test verifies that source updates are no longer blocked before the response body is consumed.

`portableWorkspaceRestoreFiles.ts` maps native/legacy documents, supplemental/remote artifacts and published conversation files to fresh native file IDs. Conversation files become ticket documents with retained audience and qualified historical attribution metadata. A provider-only upload lease checks every source size/hash before writing, verifies again while streaming, and owns only unique destination-attempt paths. Database rollback disposes those objects; the caller releases the lease only after commit. Authored inline URLs still need a separate adapter.

`portableWorkspaceRestoreVault.ts` unlocks exact package credential membership and re-encrypts passwords/OTP seeds through destination secret management. It allocates fresh native credential/grant/association IDs, remaps local ACL and entity references, preserves own-tenant associations, and rejects ID collisions and inconsistent client ownership. The source installation encryption key is not required to use restored values.

`portableWorkspaceRestoreDatabase.ts` is a retained-transaction write engine for an authorized, never-existing destination. It matches the four global catalogs by exact unambiguous semantics, uses actual PostgreSQL foreign keys for insertion order, repairs nullable cycles, and verifies regenerated native columns. Portable handoff history becomes inert ticket activity rather than live relationship rows. Required native values receive explicit inactive defaults; no sessions, trust, provider connections, subscriptions or dispatch events are created. A savepoint prevents a caught restore failure from leaving partial records. The new suspension reason `portable_restore_pending_activation` cannot be cleared by subscription cancellation recovery, and its migration cannot be reversed while a restore awaits activation.

The native integration case restores real records, file bytes and usable vault values into a new suspended tenant, including thread roots, generated phone normalization and customer/MSP handoff history. It checks caller rollback, caught mid-restore constraint failure, duplicate destination rejection and suspension recovery isolation. The installation coordinator below now supplies destination admission and committed retry identity for these adapters. Hosted destination billing setup, local crash-staging cleanup, full worker activation review and remaining content coverage are still required before the complete backup/restore requirement is satisfied.


## Transfer resource admission

`portableTransfer.ts` carries request cancellation, a maximum 30-minute deadline, a cumulative temporary-write budget (default 3 TiB plus 256 MiB for archive framing), and a minimum free-space requirement (default 1 GiB). The physical-write budget counts source staging, encrypted copies, quarantine and extracted files. Each bounded write checks current free space; writes are serialized within the process. This preserves headroom but is not a filesystem quota against other processes. Public export passes the request signal through native/remote staging, archive streams and credential provider waits. A stream returned after cancellation is destroyed, and temporary files are removed on failure. KDF work already running is bounded but not interrupted midway.

## Installation restore command

Restore admission belongs to the installation operator who controls the destination database. Ordinary workspace administrators are not granted authority to create arbitrary destination tenants. The command is an installation operation and has no release-flag check; the customer export UI remains gated by `release-v1-6-feature`.

From `server`, inspect a backup with:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --inspect --archive /absolute/customer.alga
```

The hidden prompt requests the exact archive passphrase. Inspection authenticates the archive and lists eligible source workspace administrators. Automation can use `--passphrase-stdin` with a protected pipe containing exact UTF-8 bytes, without a trailing newline. Passphrases are not command arguments, environment variables or job parameters.

Restore using an explicitly allocated destination UUID, retaining that UUID for retries:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --restore --archive /absolute/customer.alga --destination-tenant <new-UUID> --administrator-user-id <source-admin-UUID>
```

The actual PostgreSQL role must be a superuser or belong to the database owner role. The coordinator captures the encrypted input in private storage before hashing and authenticating it, remaps records and file/credential identities, stages destination files, and inserts the tenant and immutable restore receipt atomically. The selected administrator must be an active internal source user with workspace-management permission in the authenticated archive. No imported user is activated by restoration.

A retry with the same archive bytes, destination and source administrator returns the committed receipt without writing files or decrypting the vault again. A conflicting destination is rejected. Concurrent insertion rechecks the receipt under a destination advisory lock; a losing attempt disposes only its own file objects. Provider failure after storing bytes is cleaned up before returning, and no tenant is inserted. The receipt records both administrator identities, source/package identity and archive hash, and gives restored tenants their own licensing scope even before a license is installed. It cannot fall back to an installation license or installation AI credentials.

Restored workspaces initially remain suspended with inactive users and paused operational dispatch. Both activation modes are described below; hosted billing setup and review of authored inline references remain unfinished work. Interrupted uploads are tracked by the durable recovery journal described below. Cancellation stops waiting for a provider, destroys its input stream and removes a successful result that arrives later. The journal also recovers partial or late results after a process exits. Provider recovery is scheduled as described below; cleanup of process-crash temporary archive directories remains open.


## Self-hosted restored workspace activation

After acquiring a Pro license signed for the new destination tenant, the installation operator can activate that tenant:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --activate --destination-tenant <restored-UUID> --operation-id <retained-UUID> --license-file /absolute/customer-pro-license.jwt
```

The license is read from a bounded regular file without following symlinks. A hidden prompt requests and confirms a new administrator password; automation may supply exact password bytes using `--password-stdin`. The password follows the shared application policy and is hashed through destination authentication secret management. Neither secret appears in command arguments or the activation receipt.

Activation requires installation database-owner authority and the original pending restore. All imported users must still be inactive, and the selected administrator must still have the disabled restore password marker. The transaction stages and verifies only the tenant's own current Pro license, performs the same additive PSA setup as paid upgrades, grants the selected administrator the PSA Admin role, enables that user, records activation, and clears only the restore suspension. Other users remain inactive. All imported workflows and new standard workflows created by PSA setup remain paused; scheduled comments, maintenance and meeting dispatch must remain inactive. The new administrator must review restored workflow references and configure connections before explicitly enabling them.

The activation receipt is immutable. Repeating its operation UUID returns the receipt without resetting the password, rerunning setup or clearing a later suspension. A different operation UUID cannot activate the same tenant again. Failure rolls back license staging, new roles/configuration, password changes, activation receipt and suspension changes together. The installation license and MSP capacity are not changed. The wider worker/content review remains open; this command does not complete those parts of the plan.


## Hosted restored workspace activation

When the destination tenant already has its own current paid PSA subscription in the native billing records, a hosted installation operator can activate it:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --activate-hosted --destination-tenant <restored-UUID> --operation-id <retained-UUID>
```

The same hidden new-password prompt and optional `--password-stdin` apply. This mode takes no license file. The installation must have its Stripe secret and supported PSA monthly/annual price configuration. The command reads the destination's own customer/subscription/item/price, releases database locks, retrieves the current Stripe customer and expanded subscription invoice, and verifies tenant metadata, price, seat quantity, ownership, a paid invoice and current validity. It then rechecks the local billing fingerprint under fresh admission before using the shared atomic activation transaction. An unpaid or foreign provider result, expired entitlement or changed local subscription cannot activate the tenant. Completed retries perform no Stripe reads.

This operation does not purchase a subscription or transfer MSP billing. Hosted billing records and the corresponding provider subscription must already have been provisioned for the new destination tenant through installation billing operations. A dedicated hosted restore billing setup flow remains open. Neither activation mode restores old connections, grants live MSP trust, activates the other imported users or unpauses workflows.


The native file adapter honors exact, category (`application/*`) and all-type (`*/*`) MIME allowances; an explicit empty list permits no types. A real local-provider test covers upload, byte reads and cleanup with those capability settings. After a final restore transaction throws, the coordinator resolves the destination advisory lock and checks native references before disposing files. A lost COMMIT acknowledgement therefore cannot delete already committed file objects. If the database cannot resolve the outcome, files are retained instead of guessing rollback; the durable recovery journal resolves them later.


## Durable restore upload recovery

Before any destination provider write, `packages/co-managed/src/portableRestoreUploads.ts` records the package/archive identity, destination, random attempt ID, allocated file IDs and a hash identifying the actual storage location. Paths are derived exclusively from those UUIDs. The journal contains no customer record contents, passphrases, login secrets or provider credentials. Local storage identity fixes its absolute base path at provider construction; S3 identity binds region, endpoint and bucket, while credential rotation preserves the same location identity.

The attempt's 35-minute fixed lease exceeds the transfer's maximum 30-minute lifetime. Native insertion and the journal's committed state share one transaction; an expired or abandoned attempt cannot commit. Error cleanup resolves the journal under the destination advisory lock and preserves committed or natively referenced objects. When the database outcome is unavailable, the record remains for later recovery. Provider cancellation removes a successful late return; the journal covers partial and late writes that survive process exit.

An installation operator can sweep one known destination, including a destination for which no tenant was ever created:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --cleanup-uploads --destination-tenant <destination-UUID>
```

To process a bounded batch across due destinations in the current storage location:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --cleanup-uploads --all-destinations
```

Cleanup requires actual database-owner authority and does not ask for an archive passphrase. It claims and abandons eligible attempts transactionally, then deletes provider objects outside database locks. It excludes committed attempts, respects unexpired leases, refuses storage-location mismatches and protects every native reference to an object path even if the file was copied under another ID. Native path lookups have a tenant/path index. A database trigger retains the attempt row when any writer creates or changes a native file reference; abandoned attempts reject new references, closing the check/delete race. Earlier unjournaled paths remain compatible because this sweep cannot select them. Portable restore paths cannot acquire foreign-tenant native references. Failure records a bounded error code and retries after one minute; interrupted claims become eligible after ten minutes. Live attempts are rescheduled to lease expiry, and referenced objects are deferred for a day to avoid blocking other due work. The command exits nonzero if provider cleanup fails.

Abandoned records remain after successful cleanup and are revisited daily: a provider request from a crashed process can finish after an earlier sweep. These tombstones deliberately survive tenant deletion and contain only restore identity metadata. Operators must restore the previous storage configuration to sweep attempts from another location. The existing application maintenance system also runs portable-restore-upload-cleanup every 15 minutes: PG Boss registers one global schedule, and EE uses its Temporal maintenance workflow. It is a system job and does not enumerate active tenants, so absent, suspended and deleted destinations remain recoverable. The handler skips a rolling schema until the journal table exists and reports failed sweeps to the runner for retry. The recovery kernel lives in the shared co-managed package and has no edition, product-tier or UI-flag gate. EE command paths remain compatibility re-exports. Cleanup of abandoned local archive/staging directories remains separate work.
