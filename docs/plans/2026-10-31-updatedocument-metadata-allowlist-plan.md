# updateDocument: a metadata allowlist, not a document mass-assignment

Card: `587da3be-9823-5929-beba-b601133a1696` — Security: authz in updateDocument
Finding source: security review of PR #3993 (merge `dbf5978b864f`), review card `cfebdd89-cc5d-5695-8257-62dabbe7007e`
Fingerprint: `packages/documents/src/actions/documentActions.ts#updateDocument`

## The defect

`updateDocument` (`packages/documents/src/actions/documentActions.ts:519-563`) is a document
**mass-assignment** sink:

1. It checks `document:update` and authorizes **only the target document** (`getAuthorizedDocumentById`).
2. It then spreads the caller-supplied `Partial<IDocument>` straight into the row update
   (`:535-539`), and `IDocument` (`packages/types/src/interfaces/document.interface.ts:3-40`)
   exposes `file_id`, `preview_file_id`, `thumbnail_file_id`, `storage_path`, `mime_type`,
   `file_size`, `tenant`, `user_id`, `created_by`, `source_template_id`,
   `source_template_version`, `rendered_locale`, `preview_generated_at`, `order_number`.

Because `GET /api/documents/[documentId]/download` authorizes the **document**
(`server/src/app/api/documents/[documentId]/download/route.ts:79-87`) and then serves whatever
`file_id` that document points at (`:117-132`), an updater who knows the UUID of a same-tenant
file they may no longer read can point an accessible document at it and download the bytes. The
preview identifiers give an equivalent rebinding path for rendered previews, and the tenant /
ownership / provenance fields are assignable for the same reason. The finding is pre-existing;
PR #3993 did not introduce it.

Today every production call site passes only `document_name` and `edited_by`
(`packages/documents/src/components/Documents.tsx:917,978,1029,1091`,
`packages/projects/src/components/TaskDocumentsSimple.tsx:360`), so the wire is open but
currently unused — which is exactly why it should be closed narrowly, without a redesign.

## The shape of the fix

Replace the open `Partial<IDocument>` with a **validated command of intentionally mutable
metadata**, and build the row update from that command rather than from a spread.

### 1. `UpdateDocumentCommand` — the mutable surface

Declared next to the action (in `documentActions.ts`, or a small
`packages/documents/src/lib/documentCommands.ts` if the type is needed by more than the action):

```ts
export interface UpdateDocumentCommand {
  /** Display name only. */
  document_name?: string;
  /** Document type (metadata; not an authorization input). */
  type_id?: string | null;
  /** Folder organization. */
  folder_path?: string;
  /** Visibility of the document inside the folder model. */
  is_client_visible?: boolean;
  /** Shared-type metadata. */
  shared_type_id?: string;
}
```

Explicitly **not** in the command, and therefore unassignable through this action:

- identity / tenancy: `document_id`, `tenant`, `user_id`, `created_by`, `order_number`
- bytes: `file_id`, `storage_path`, `mime_type`, `file_size`
- derived artifacts: `preview_file_id`, `thumbnail_file_id`, `preview_generated_at`
- render provenance: `source_template_id`, `source_template_version`, `rendered_locale`
- timestamps: `entered_at`, `updated_at` (the action already stamps `updated_at` itself)
- audit: `edited_by` becomes server-derived, not caller-supplied (see §3)

### 2. Build the update by picking, never spreading

```ts
const ALLOWED_UPDATE_KEYS = ['document_name','type_id','folder_path','is_client_visible','shared_type_id'] as const;

function pickUpdateDocumentCommand(input: unknown): UpdateDocumentCommand
```

The picker keeps string keys that exist in the allowlist, drops everything else, and is applied
**even though the parameter is typed** — the action is exported to the client bundle and is
reachable from untyped call sites, so the runtime guard is the guarantee and the type is the
developer-facing one. An empty pick must not issue an `UPDATE` (or must update only `updated_at`
+ audit, matching current behaviour) — decide once and cover it with a test.

### 3. Audit field is server-derived

Do not trust `data.edited_by`. Stamp `edited_by: user.user_id` (the authenticated session
actor) inside the update, and drop the field from the caller-facing command. Call sites stop
passing it. This closes the "blame another user" variant on the same sink.

### 4. File replacement is a separate, authorized operation

New action in the same module:

```ts
export const replaceDocumentFile = withAuth(async (user, { tenant }, documentId: string, fileId: string) => …)
```

- authorize the **target** document with the existing `document:update` + `getAuthorizedDocumentById`;
- resolve and authorize the **source** file's owning document with
  `getAuthorizedDocumentByFileId(trx, tenant, user, fileId)` (the same helper the download route
  already uses) — refuse when it does not resolve, so the caller must be able to read the bytes
  they are attaching;
- write `file_id` (and only `file_id`) plus `updated_at`;
- regenerate derived artifacts with the existing `generateDocumentPreviews(document, buffer)` flow
  and write `preview_file_id` / `thumbnail_file_id` / `preview_generated_at` from **inside that
  flow only** (the same single-writer discipline `uploadDocument` already follows at `:2670-2685`);
- publish `publishDocumentUpdatedSearchEvent` with the fields that actually changed.

This card ships the action and its tests. No UI caller is added here — the product has no
replace-file affordance yet, and inventing one is out of scope. The action exists so that the
next feature that needs replacement never reaches for `updateDocument` with a `file_id`.

### 5. Call-site migration

The signature becomes `updateDocument(documentId, command: UpdateDocumentCommand)`. TypeScript
lists the callers; all five pass `document_name` + `edited_by`. Remove `edited_by` from each
(the action stamps it) and keep `document_name`.

## Tests (unit, colocated with the actions)

`packages/documents/src/actions/documentActions.update.test.ts` (new), using the existing
tenant-scoped action test pattern in `documentSmallActionsTenantScoped.contract.test.ts`:

1. **Rebinding is impossible** — for each of `file_id`, `preview_file_id`, `thumbnail_file_id`,
   `storage_path`, `mime_type`, `file_size`, `tenant`, `user_id`, `created_by`,
   `source_template_id`, `rendered_locale`: call `updateDocument` with that key plus a changed
   `document_name`, then read the row back and assert the identifier field is **unchanged**
   while `document_name` did change. (Proves the picker, not merely the type.)
2. **Allowlisted metadata still applies** — `document_name`, `type_id`, `folder_path`,
   `is_client_visible`, `shared_type_id` persist.
3. **`edited_by` is the session user**, even when the payload carries another id.
4. **Empty command** — no field changes beyond the audit stamp; no crash.
5. **`replaceDocumentFile`** — allows a file whose owning document the caller can read; refuses a
   file from another tenant and a file whose owning document the caller cannot read; the row's
   `file_id` is the only identifier that changes on success.
6. **Exploit-chain regression** — after a rejected rebinding attempt, the download route's
   resolution (`getAuthorizedDocumentById` → `file_id`) still points at the original file.

## Deliberately not doing

- **No schema-validator dependency.** `packages/documents` has no zod today; a typed command with
  an explicit runtime picker is the minimum mechanism that actually closes the sink. If the repo
  later standardizes action-input validation, this picker becomes one caller of it.
- **No change to the download route.** It is behaving correctly: it authorizes the document it is
  asked for. The defect is that a document's bytes were rebindable. Adding a second authorization
  in the route would paper over the sink and leave the preview path open.
- **No tenant/RLS plumbing changes** — `tenantScopedTable` and the tenant root stay as they are.
- **No broad `IDocument` split.** `IDocument` stays the read model; only the write surface narrows.
- **No UI for replacing a document's file.**

## Risks and open questions

- **Product parity for `type_id` / `folder_path` / `is_client_visible` / `shared_type_id`.** They
  are included because they are legitimate metadata an administrative edit may set; no current
  caller sends them. If a reviewer prefers the strictly minimal set (`document_name` only), the
  cost is that document type/folder/visibility edits have no authorized path — recommend keeping
  them and letting the tests pin them as non-authorization-bearing.
- **`replaceDocumentFile` is new, uncalled surface.** It is deliberately exercised by tests only;
  the alternative (leaving a `file_id` path open for a future caller) is what the finding forbids.
- **Search-event field list** must be derived from the picked keys, or downstream indexing will
  claim fields changed that did not.

## Order of work

1. Add `UpdateDocumentCommand` + picker (no behaviour change beyond dropping unknown keys).
2. Switch `updateDocument` to pick-and-update; stamp `edited_by` server-side.
3. Migrate the five call sites (drop `edited_by`).
4. Add `replaceDocumentFile` + preview regeneration discipline.
5. Tests 1-6 above; run the documents package suite plus the download-route tests.
6. No commits beyond the implementation + tests (no evidence-only commits); the plan file is the
   only doc commit, and it is this file.
