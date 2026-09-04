# Password Vault: the audit log screen

Card: `b1075e0b-5662-4228-8fb5-52607a8257a0`
Branch: `feature/missing-audit-log-screen`
Scope: EE credentials vault. A read-only surface for the audit trail the vault
already writes.

Defaults chosen where the brief left room are marked **[default]** so they are
easy to override in review.

## Why this work

The credentials vault is fail-closed by construction. Every sensitive action —
a reveal, a create, an edit, a grant change, an attach — writes an audit row in
the same transaction as the operation, and a reveal writes its row *before* any
value is returned, so a failed insert means no value leaves the server
(`ee/server/src/lib/credentials/audit.ts`). The point of that machinery is
accountability: who revealed this password, and when.

Nothing reads it back. The rows land in `audit_logs` and stay there. A grep of
`ee/server/src/components` and both `lib/actions` trees turns up no component,
server action, or data-access function that ever `SELECT`s the vault's audit
rows. The one capability the audit system exists to provide — answering "who
touched this credential" — is unreachable from the product. An admin who
suspects a leaked password has no way to see who opened it.

This card builds that surface: a read-only audit log for the vault, reachable
per-credential (this password's history) and vault-wide (everything, filtered),
scoped by the same authorization that governs the credentials themselves so the
log can never reveal activity on a credential the viewer could not otherwise
see.

## What ships

1. A new server action, `getCredentialAuditEvents`, that reads `audit_logs` for
   the vault, resolves actor identity, and applies the credential read-scope so
   restricted-credential activity is never leaked.
2. A per-credential **History** panel, opened from a row action in
   `CredentialsScreen`, showing that credential's events newest-first.
3. A vault-wide **Audit log** screen at `/msp/credentials/audit`, with filters
   (operation, actor, client, date range) and keyset pagination.
4. A new `credential:audit` permission gating both surfaces, defaulting to
   supervisory roles.
5. Value-free enrichment of the write sites so `credential_updated` records
   *which field names* changed and `credential_grants_changed` records grant
   deltas — names and counts only, never values — so the log reads as more than
   a list of timestamps.
6. Locale copy for operation labels, column headers, filters, and empty states
   across all shipped locales.

## Out of scope

- Exporting the audit log (CSV/PDF) — a follow-up once the read surface exists.
- Audit rows for *reads of metadata* (listing the vault). Only the eight
  sensitive operations already written are surfaced; the vault does not audit
  plain list/browse and this card does not add that.
- A tenant-wide audit console spanning tables other than `credentials`. This
  screen is vault-scoped (`table_name = 'credentials'`). The generic
  `audit_logs` viewer that would serve tickets, billing, etc. is a larger,
  separate effort; this card deliberately does not try to be it, though its
  data-access shape is written so that generalization is not blocked later.
- Retention / archival policy for `audit_logs`.

## Current state (as read)

- **The table.** `audit_logs` (`server/migrations/20250129214635_create_audit_logs.cjs`):
  `audit_id` (uuid pk), `tenant`, `user_id` (nullable — system actions),
  `operation`, `table_name`, `record_id`, `changed_data` (jsonb), `details`
  (jsonb), `timestamp`. RLS isolates by `app.current_tenant`; a `BEFORE INSERT`
  trigger stamps `tenant` from the GUC. Indexes: `(table_name, record_id)` for
  entity history, `timestamp` for time queries, `tenant`.
- **The writer.** `ee/server/src/lib/credentials/audit.ts` →
  `writeCredentialAudit(knex, tenant, operation, params, details)`. It sets the
  tenant GUC inside a nested transaction and calls the shared
  `auditLog` helper (`server/src/lib/logging/auditLog.ts`), which inserts with
  `table_name` set by the caller. For the vault, `table_name = 'credentials'`
  and `record_id = credentialId`.
- **The operation vocabulary** (`CredentialAuditOperation`, eight values):
  `credential_reveal`, `credential_otp_seed_reveal`, `credential_created`,
  `credential_updated`, `credential_deleted`, `credential_grants_changed`,
  `credential_associated`, `credential_detached`.
- **The `details` shape.** Always `{ integration: 'alga', tenant,
  credential_id, client_id }`. Association events add `{ entity_type, entity_id }`
  (`associations.ts` lines 243, 274, 406, 417). `changed_data` is always `{}` —
  no field-level diff is recorded today. Audit `details` never contain secret
  values, by contract.
- **`record_id` is not always a native UUID.** Native credentials use the
  credential UUID (`nativeSource.ts` lines 375, 408, 450, 524, 542, 588, 623).
  Hudu-sourced credentials use a *synthetic* id from
  `buildHuduCredentialId(companyId, huduId)` (`huduSource.ts` line 444), e.g.
  `hudu:…`. Any scope join that assumes `record_id` is a row in the native
  `credentials` table will silently drop Hudu activity. The vault-wide read
  scope must handle both (see Implementation §2).
- **The screen.** `/msp/credentials` → `server/src/app/msp/credentials/page.tsx`
  (server component, session-gated) renders `@enterprise/.../CredentialsScreen`.
  In CE the `@enterprise` alias resolves to a render-null stub. The screen
  re-checks `release-v1-5-feature` + `getCredentialsContext` (tier) and renders
  nothing when unavailable. The same screen body is reused, scoped by
  `clientId`, in the unified client Passwords tab via
  `EntityCredentialsSection.tsx`. Row actions already carry the `credentials-*`
  id convention and a `Timer`/reveal/`Pencil` action set
  (`CredentialsScreen.tsx`).
- **Authorization.** `credentialActions.ts` gates every action with `withAuth`
  + `hasPermission(user, 'credential', <action>)` + `assertTierAccess`. The
  permission catalog (`server/migrations/utils/permissions/catalog.cjs` lines
  93–97) defines `credential:create|read|reveal|update|delete`. `read` =
  "View credential metadata and the credentials vault", granted broadly
  (Admin, Dispatcher, Manager, Project Manager, Technician). Per-item ACLs live
  in `credentialAuthorization.ts`: `createCredentialAuthorizationContext` +
  `compileCredentialReadScopeSql` produce the SQL predicate
  `is_restricted = false OR created_by = :userId OR EXISTS(user/team grant)`,
  ANDed with bundle-narrowing rules. This is the exact predicate the list uses
  to hide restricted credentials; the audit surfaces must reuse it.
- **A second write path.** Hudu reveals also audit through
  `ee/server/src/lib/integrations/hudu/revealAudit.ts`, which writes `audit_logs`
  via the same helper. Any vault-wide query filtered by `table_name='credentials'`
  picks these up automatically; the scope logic (§2) must therefore treat them
  as Hudu rows, not assume every row came through `writeCredentialAudit`.
- **No *credential* viewer, but a pattern to mirror.** Nothing reads the vault's
  audit rows for display — the credential path is write-only. But two existing
  readers of the shared `audit_logs` table are the template:
  - `listWorkflowAuditLogsAction` (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`)
    + `WorkflowDesignerAuditPanel.tsx`: `where({ table_name, record_id })`,
    `orderBy('timestamp','desc').orderBy('audit_id','desc')`, `limit+1` cursor
    pagination, CSV/JSON export, and a `redactSensitiveValues(...)` pass over
    `changed_data`/`details` before returning. This is the closest thing to copy.
  - `listRbacAuditLogs` (`server/src/lib/api/services/PermissionRoleService.ts`)
    behind `GET /api/v1/rbac/audit`, gated on `role:read` — precedent for gating
    an audit reader on a resource permission and for the filter/pagination shape.
  This screen is built from scratch but follows those two directly.

## Design decisions

**A dedicated `credential:audit` permission, not `credential:read`.** Reading a
password's *value* is a technician's daily job; seeing *who else read it* is a
supervisory, compliance-shaped capability. Folding audit visibility into
`credential:read` would hand every technician a report of their colleagues'
reveals. A distinct permission keeps the trail an oversight surface.
**[default]** default grants: `msp:Admin` and `msp:Manager`; `client: false`
(MSP-only, like the rest of the credential permissions). Reviewers who want
technicians to see *their own* history can widen this later; the action is
written so a self-only fallback is a one-line predicate change.

**The audit read-scope is the credential read-scope, not weaker.** A restricted
credential is invisible to non-grantees in the list; its *activity* must be
equally invisible, or the audit log becomes a side channel that reveals a
credential exists and is being used. The vault-wide query therefore filters
`record_id` through the same authorization the list uses (§2), on top of the
`credential:audit` gate. The two gates are independent: `credential:audit`
decides *whether you see any audit at all*; the read-scope decides *which
credentials' rows* are in it. Precedent is mixed and supports treating this as
elevated: the RBAC audit reader reuses `role:read`, but the workflow audit panel
requires workflow `admin`. A password trail sits nearer the latter, so it gets
its own key rather than riding on `credential:read`.

**Hudu activity is scoped by client, native activity by per-item ACL.** Native
`record_id`s join to `credentials` and get the full ACL predicate. Hudu
`record_id`s (`hudu:…`) do not exist in that table; they are client-bound and
carry `details->>'client_id'`. They are shown when the viewer may read that
client's credentials (Hudu credentials are not per-item restricted). The scope
is a union of the two, so neither source silently vanishes.

**Value-free enrichment now, because the log is thin without it.** Today a
`credential_updated` row says only "someone edited this at 14:03" — not what.
`changed_data` is `{}`. Recording the *field names* that changed (never values)
turns "edited" into "changed the username and URL", which is the difference
between an audit log and a timestamp list. This is a small, safe extension of
existing write sites and is included here rather than deferred, because the
screen's usefulness depends on it. See §5.

## Copy

New keys under `credentials.` in
`server/public/locales/<locale>/msp/credentials.json`. Apply to `en` first,
then `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`. The `xx`/`yy` pseudo-locales are
generated — run `npm run test:i18n`, which regenerates and validates parity.

### Operation labels (`audit.op.*`)

| Key | Value |
|---|---|
| `audit.op.credential_reveal` | `Revealed the password` |
| `audit.op.credential_otp_seed_reveal` | `Revealed the two-factor key` |
| `audit.op.credential_created` | `Created the credential` |
| `audit.op.credential_updated` | `Edited the credential` |
| `audit.op.credential_deleted` | `Deleted the credential` |
| `audit.op.credential_grants_changed` | `Changed who can access it` |
| `audit.op.credential_associated` | `Linked it to {{entity}}` |
| `audit.op.credential_detached` | `Unlinked it from {{entity}}` |

### Enrichment detail (`audit.detail.*`)

| Key | Value |
|---|---|
| `audit.detail.fieldsChanged` | `Changed: {{fields}}` |
| `audit.detail.grantsAdded` | `Granted access to {{count}}` |
| `audit.detail.grantsRemoved` | `Removed access from {{count}}` |
| `audit.detail.systemActor` | `System` |
| `audit.detail.unknownActor` | `A removed user` |

### Screen chrome (`audit.*`)

| Key | Value |
|---|---|
| `audit.pageTitle` | `Password audit log` |
| `audit.historyTitle` | `History` |
| `audit.historySubtitle` | `Everything that has happened to this password.` |
| `audit.col.when` | `When` |
| `audit.col.who` | `Who` |
| `audit.col.action` | `Action` |
| `audit.col.credential` | `Password` |
| `audit.filter.operation` | `Action` |
| `audit.filter.actor` | `User` |
| `audit.filter.client` | `Client` |
| `audit.filter.dateRange` | `Date range` |
| `audit.filter.allOperations` | `All actions` |
| `audit.empty` | `No activity yet.` |
| `audit.emptyFiltered` | `No activity matches these filters.` |
| `audit.loadMore` | `Load more` |
| `audit.forbidden` | `You do not have access to the audit log.` |
| `audit.rowAction` | `View history` |

## Implementation

### 1. Permission

Add to the catalog (`server/migrations/utils/permissions/catalog.cjs`, in the
`credential` block):

```js
{ resource: 'credential', action: 'audit', msp: true, client: false,
  description: 'View the credentials vault audit log',
  products: ['algadesk', 'psa'],
  defaultGrants: { algadesk: ['msp:Admin'],
                   psa: ['msp:Admin', 'msp:Manager'] } },
```

The catalog is the single source of truth (`syncPermissionCatalog.cjs` +
`auditPermissionCatalog.cjs` reconcile it); a new reconciliation migration
(`server/migrations/<ts>_add_credential_audit_permission.cjs`) invokes the sync
so existing tenants gain the permission and its default grants. Extend the
catalog contract fixtures (`server/src/test/unit/migrations/permissionCatalog.contract.test.ts`)
to expect the new row.

### 2. Server action + data access

New `ee/server/src/lib/actions/credentials/credentialAuditActions.ts`, exporting
one action, following the `credentialActions.ts` gating pattern exactly
(`withAuth` → `hasPermission(user, 'credential', 'audit')` →
`assertTierAccess(TIER_FEATURES.CREDENTIALS)` → `withTransaction`).

```ts
export interface CredentialAuditFilter {
  credentialId?: string;          // per-credential history
  operations?: CredentialAuditOperation[];
  actorUserId?: string;
  clientId?: string;
  from?: string; to?: string;     // ISO timestamps
  cursor?: { timestamp: string; auditId: string } | null;  // keyset
  limit?: number;                 // default 50, max 200
}

export interface CredentialAuditEvent {
  auditId: string;
  timestamp: string;
  operation: CredentialAuditOperation;
  actor: { userId: string | null; name: string | null } // null name ⇒ removed/system
  credentialId: string;
  credentialName: string | null;  // resolved for native rows; null for deleted/Hudu
  clientId: string | null;
  clientName: string | null;
  entity?: { type: string; id: string } | null;   // association events
  changedFields?: string[];                        // from enrichment
  grantsDelta?: { added: number; removed: number } // from enrichment
}

export interface CredentialAuditPage {
  events: CredentialAuditEvent[];
  nextCursor: { timestamp: string; auditId: string } | null;
}
```

Query, inside the tenant transaction (GUC already set by `withTransaction`):

- Base: `audit_logs` where `tenant = :tenant AND table_name = 'credentials'`.
- **Scope.** Build `createCredentialAuthorizationContext(trx, tenant, user)` and
  `compileCredentialReadScopeSql`. Restrict `record_id` to:
  - native: `record_id IN (SELECT credential_id FROM <read-scoped credentials>)`,
    the subquery being the read-scope predicate the list already compiles; **OR**
  - Hudu: `record_id LIKE 'hudu:%' AND details->>'client_id' IN (:authorizedClientIds)`,
    where `authorizedClientIds` is the set of clients whose credentials the user
    may read (derived once from the same context).
  These two are ORed. This is the security core — it is not optional and it is
  covered by tests in §6.
- **Filters.** `credentialId` (per-credential history — still ANDed with scope,
  never instead of it), `operations` (`operation = ANY`), `actorUserId`
  (`user_id`), `clientId` (`details->>'client_id'`), `from`/`to` (`timestamp`).
- **Order + paging.** `ORDER BY timestamp DESC, audit_id DESC`, keyset on
  `(timestamp, audit_id) < (:cursor.timestamp, :cursor.auditId)`, `LIMIT
  :limit + 1` to compute `nextCursor`. The `(table_name, record_id)` index
  serves per-credential history; the `timestamp` index serves the vault-wide
  ordering.
- **Actor resolution.** Left-join `users` on `user_id` for a display name;
  `null` user_id → `audit.detail.systemActor`, non-null but missing →
  `audit.detail.unknownActor`. Do not expose email beyond what the vault already
  shows.
- **Credential/client names.** Left-join `credentials` (native only) for
  `credential_name`; left-join `clients` on the resolved client id for
  `client_name`. Deleted credentials keep their audit rows but resolve to
  `null` name — the screen shows the id-less "Deleted credential" affordance.

No values ever leave this action; it reads metadata columns and `details`
only, and `details` is value-free by the writer's contract. As defense in depth
— and to match the workflow reader — run the returned `details`/`changed_data`
through the same `redactSensitiveValues(...)` pass `listWorkflowAuditLogsAction`
uses, so a future write site that carelessly adds a value is caught here rather
than shown.

The whole action mirrors `listWorkflowAuditLogsAction` (same `orderBy` +
`limit+1` cursor shape); the delta is the `table_name='credentials'` filter, the
credential read-scope, and actor/name resolution.

### 3. Per-credential History panel

New `ee/server/src/components/credentials/CredentialAuditPanel.tsx` — a
presentational timeline (icon per operation reusing the `lucide-react` set
already imported in `CredentialsScreen`: `Eye`, `Pencil`, `Plus`, `Trash2`,
`Users`, `Link2`, `Unlink`, `KeyRound`). Props `{ credentialId, clientId }`; it
calls `getCredentialAuditEvents({ credentialId })` and renders rows as
"{actor} {operation label} · {relative time}", with enrichment detail
(`audit.detail.fieldsChanged`, grant deltas) as a secondary line.

Mount it from a new row action in `CredentialsScreen.tsx`, gated on the screen
knowing the user has `credential:audit` (surfaced through
`getCredentialsContext` — see §4). Use a `History`/`Timer` icon button with
id `credentials-screen-history-<id>`, opening the panel in the existing
`Dialog` shell. Because the row is only present for credentials the list
already shows (i.e. the viewer can read), the per-credential path is naturally
scoped; the action's server-side scope predicate is the belt to that
suspenders.

### 4. Vault-wide Audit log screen

- Route: `server/src/app/msp/credentials/audit/page.tsx` — server component,
  session-gated exactly like `credentials/page.tsx`, rendering a new EE
  `CredentialAuditScreen` via `@enterprise`. `generateMetadata` →
  `audit.pageTitle`. `export const dynamic = 'force-dynamic'`.
- `ee/server/src/components/credentials/CredentialAuditScreen.tsx`: the
  flag/tier gate (identical three checks), a `credential:audit` forbidden state
  (`audit.forbidden`), a filter bar (operation multiselect, actor picker, client
  `ClientPicker`, date range), a table (`When / Who / Action / Password`), and
  keyset "Load more". Reuse `useCredentialsList`'s error/loading idiom; the data
  hook is new (`useCredentialAudit.ts`) but mirrors its shape.
- **Nav + discoverability.** Add an "Audit log" entry alongside the vault. Two
  options: a secondary tab within the vault screen header, or a sibling nav
  item. **[default]** a header link/tab on `CredentialsScreen` ("Audit log")
  visible only when the context reports `credential:audit`, avoiding a new
  top-level nav entry. Surface `canAudit: boolean` from
  `getCredentialsContext` (compute via `hasPermission(user,'credential','audit')`)
  so both the tab and the per-credential row action gate on one server-provided
  flag rather than a client guess.

### 5. Value-free enrichment of write sites

Extend `CredentialAuditParams`/`writeCredentialAudit` callers — **names and
counts only, never values**:

- `credential_updated` (native `nativeSource.ts` line 524; Hudu `huduSource.ts`
  line 489): pass `details.changed_fields: string[]` — the set of column keys
  that differed between existing and input (`name`, `username`, `password`,
  `otp_secret`, `url`, `description`, `client_id`). For secret-bearing fields
  record only the *fact* of change (the field name), never the old/new value.
  The `password`/`otp_secret` entries mean "the secret was rotated", which is
  itself audit-worthy and value-free.
- `credential_grants_changed` (`nativeSource.ts` line 588): pass
  `details.grants_added: number` and `details.grants_removed: number` computed
  from the grant diff already available at that call site.
- Leave reveal/create/delete/associate/detach as-is; their operation name is
  already the full story.

This touches only the `details` object passed to an existing helper; the audit
transaction contract is unchanged. Update the write-through unit tests
(`huduSource.writeThrough.test.ts`, `credentialActions.gates.test.ts`) that
assert on the audited `details` argument.

### 6. Tests

- **Scope (security core).** New
  `ee/server/src/__tests__/integration/credential-audit-scope.integration.test.ts`:
  seed two users, a restricted native credential granted only to user A, an
  unrestricted one, and a Hudu credential for a client user B cannot read.
  Assert `getCredentialAuditEvents` (vault-wide) returns the restricted
  credential's events to A and *not* to B; returns Hudu events only to users
  who may read that client; and that a user without `credential:audit` is
  refused outright.
- **Paging + filters.** Keyset pagination returns a stable, non-overlapping
  sequence across pages; `operations`/`actorUserId`/date filters narrow
  correctly; per-credential `credentialId` history is ordered newest-first.
- **Actor/name resolution.** `null` user_id → system label; deleted user →
  unknown label; deleted credential → null name without error.
- **Enrichment.** Extend `nativeSource`/`huduSource` write-through tests to
  assert `changed_fields` lists exactly the changed columns and never carries a
  value, and that `grants_added`/`grants_removed` match the diff.
- **Component.** New
  `ee/server/src/__tests__/unit/credentials/credentialAuditScreen.component.test.tsx`
  (jsdom + testing-library, action mocked via `vi.hoisted`, the model used by
  `credentialsScreen.component.test.tsx`): filters call the action with the
  right args, empty vs empty-filtered states render, "Load more" advances the
  cursor, and the per-credential row action opens the panel.
- **Permission catalog.** Contract test expects the new `credential:audit` row
  and its default grants.

## Verification

On the dev stack (`/msp/credentials`), as an `msp:Admin`:

1. Reveal a password, edit its username, change a grant, link it to a ticket.
   Open the row's **History** and confirm four events appear newest-first with
   the right actor, and that the edit says "Changed: username" and the grant
   change shows the delta.
2. Open **Audit log**, confirm the same events appear vault-wide, and that
   filtering by "Revealed the password" and by date range narrows correctly.
   Page past the first 50 with "Load more" and confirm no duplicates or gaps.
3. As a `msp:Technician` (has `credential:read` but not `credential:audit`):
   confirm the History row action and the Audit log tab are absent, and that
   hitting `/msp/credentials/audit` directly renders the forbidden state.
4. Create a restricted credential granted to user A only. As user B (who may
   read the vault but not that credential), confirm neither the vault-wide log
   nor any direct query surfaces A's reveal of it.
5. With Hudu connected, reveal a Hudu-sourced credential and confirm the event
   appears for a user who may read that client and is absent for one who may
   not.
6. Delete a credential and confirm its prior events remain in the log, labelled
   as a deleted credential, with no crash from the missing join row.
7. Run `npm run test:i18n` and confirm locale parity across all shipped locales.
