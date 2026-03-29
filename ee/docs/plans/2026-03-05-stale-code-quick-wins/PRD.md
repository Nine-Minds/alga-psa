# PRD: Stale Code Cleanup -- Orphaned Files, Dual-Copy Redirects, and Avatar Bug Fixes

## Problem Statement

The codebase contains orphaned files, stale dual-copies, and an entire duplicate package (`@alga-psa/media`) that overlap with canonical implementations in `@alga-psa/formatting`, `@alga-psa/user-composition`, and `@alga-psa/documents`. These create confusion about which implementation to use, risk divergent behavior, and bloat the dependency graph.

Additionally, two avatar rendering bugs exist that are directly related to the avatar code being cleaned up:
1. Client portal user avatars don't display on the MSP user list because the avatar lookup always queries `entity_type='user'`, but client portal users store avatars as `entity_type='contact'` via their `contact_id`.
2. Contact avatars show '?' on the contact details page because `ContactAvatarUpload` passes `entityName=""` to `EntityImageUpload`, so the fallback initials compute to '?'.

## Goals

- Delete orphaned files with 0 callers
- Redirect dual-copy callers to canonical packages and delete server-side duplicates
- Delete the entire `@alga-psa/media` package (4 source files, ~600 LOC) by migrating its 3 callers to canonical locations
- Fix client portal user avatars on MSP user list
- Fix contact avatar '?' fallback on contact details page
- Zero re-export shims created -- every caller imports from the canonical location directly
- Build passes after each task

## Non-Goals

- Consolidating the remaining avatar URL duplication between `@alga-psa/formatting` and `@alga-psa/user-composition` (separate future task)
- Reducing cross-package lint violations beyond what naturally drops from this cleanup
- Migrating any other server-side services or models

## Target Users

Internal developers maintaining the codebase.

## Tasks

### Task 1: Delete `server/src/lib/posthog.ts`

**What:** 7-line deprecated wrapper with 0 callers. No imports reference `@/lib/posthog` anywhere.

**Action:** Delete the file. No callers to update.

**Verification:**
- Grep confirms 0 imports of `@/lib/posthog` or `../posthog` (already verified)
- Build passes

### Task 2: Delete `server/src/lib/actions/tenant-secret-actions.ts`

**What:** 222-line server action file. An identical copy already exists at `packages/tenancy/src/actions/tenant-secret-actions.ts` and is exported via the barrel `packages/tenancy/src/actions/index.ts`. Only 2 server callers still import the server copy.

**Callers to update (2):**

| File | Current Import | New Import |
|---|---|---|
| `server/src/components/settings/secrets/SecretsManagement.tsx` | `from '@/lib/actions/tenant-secret-actions'` | `from '@alga-psa/tenancy/actions'` |
| `server/src/components/settings/secrets/SecretDialog.tsx` | `from '@/lib/actions/tenant-secret-actions'` | `from '@alga-psa/tenancy/actions'` |

**Action:**
1. Update 2 callers to import from `@alga-psa/tenancy/actions`
2. Delete `server/src/lib/actions/tenant-secret-actions.ts`

**Verification:**
- Grep for `tenant-secret-actions` in `server/src/` returns 0 results (excluding docs)
- Build passes

### Task 3: Delete `packages/media/` entirely

**What:** `@alga-psa/media` is a horizontal package (4 source files, ~600 LOC) that duplicates functionality available in canonical packages:

| Media File | Duplicate Of | Canonical Location |
|---|---|---|
| `lib/avatarUtils.ts` (87 LOC) | Avatar URL resolution | `@alga-psa/formatting/avatarUtils` (228 LOC, superset) |
| `lib/documentsHelpers.ts` (32 LOC) | Dynamic import wrappers | Only used by media's own EntityImageService |
| `services/EntityImageService.ts` (296 LOC) | Entity image upload/delete | `@alga-psa/documents` `lib/entityImageService.ts` (299 LOC) |
| `index.ts` (3 LOC) | Barrel | N/A |

The media package was created to break the `documents -> users -> media -> documents` cycle by using dynamic imports internally. That cycle has been resolved (confirmed in the known-cycles baseline). The canonical implementations in `@alga-psa/formatting` and `@alga-psa/documents` are now the correct targets.

**Callers to update (3):**

| File | Current Imports from `@alga-psa/media` | New Imports |
|---|---|---|
| `packages/users/src/services/UserService.ts` | `getUserAvatarUrl`, `uploadEntityImage`, `deleteEntityImage` | `getUserAvatarUrl` from `@alga-psa/formatting/avatarUtils`; `uploadEntityImage`, `deleteEntityImage` from `@alga-psa/documents` |
| `packages/users/src/actions/user-actions/userActions.ts` | `uploadEntityImage`, `deleteEntityImage` | from `@alga-psa/documents` |
| `packages/teams/src/actions/team-actions/avatarActions.ts` | `uploadEntityImage`, `deleteEntityImage`, `getTeamAvatarUrl` | `uploadEntityImage`, `deleteEntityImage` from `@alga-psa/documents`; `getTeamAvatarUrl` from `@alga-psa/formatting/avatarUtils` |

**Why these targets:**
- `uploadEntityImage`/`deleteEntityImage` -> `@alga-psa/documents`: This is where the canonical implementation lives. 4 other packages already import these from documents (`clients`, `client-portal`, `tenancy`, and documents-internal callers). Uses direct imports to `StorageService` and `documentActions` instead of dynamic import hacks.
- `getUserAvatarUrl` -> `@alga-psa/formatting/avatarUtils`: Canonical avatar URL resolution. Already used by `documents/lib/entityImageService.ts`.
- `getTeamAvatarUrl` -> `@alga-psa/formatting/avatarUtils`: Does not exist there yet. Must be added (trivial 4-line convenience wrapper calling `getEntityImageUrl('team', ...)`). The `EntityType` already includes `'team'`.

**Prerequisite edit -- add `getTeamAvatarUrl` to formatting:**

Add to `packages/formatting/src/avatarUtils.ts` (after `getClientLogoUrl`):
```typescript
export async function getTeamAvatarUrl(
  teamId: string,
  tenant: string
): Promise<string | null> {
  return getEntityImageUrl('team', teamId, tenant);
}
```

**Package.json dependency changes:**

| Package | Remove | Add |
|---|---|---|
| `packages/users/package.json` | `"@alga-psa/media": "*"` | `"@alga-psa/documents": "*"`, `"@alga-psa/formatting": "*"` |
| `packages/teams/package.json` | `"@alga-psa/media": "*"` | `"@alga-psa/documents": "*"`, `"@alga-psa/formatting": "*"` |

**Cross-package violation impact:**
- `users -> documents`: Adds **2 new lint warnings** (UserService.ts, userActions.ts). This is consistent with the existing pattern -- `clients`, `client-portal`, and `tenancy` already import the same functions from documents. These warnings are acceptable because entity image upload/delete is document-domain infrastructure that multiple verticals need.
- `teams -> documents`: **No lint warning** (`teams` is not in `VERTICAL_PACKAGES`).
- `users -> formatting`: **No lint warning** (formatting is `type:horizontal`).
- `teams -> formatting`: **No lint warning** (formatting is `type:horizontal`).

**Config files to update (remove `@alga-psa/media` references):**

| File | What to remove |
|---|---|
| `server/next.config.mjs` | 3 lines: alias mapping + transpile entry + alias entry |
| `server/tsconfig.json` | 2 lines: path mapping for `@alga-psa/media` and `@alga-psa/media/*` |
| `ee/server/tsconfig.json` | 2 lines: path mapping for `@alga-psa/media` and `@alga-psa/media/*` |
| `services/workflow-worker/Dockerfile` | 1 line: `--workspace=@alga-psa/media` |
| `packages/users/package.json` | 1 line: `"@alga-psa/media": "*"` dependency |
| `packages/teams/package.json` | 1 line: `"@alga-psa/media": "*"` dependency |

**Test file to update:**

`server/src/test/teams-v2-improvements.test.ts` reads `packages/media/src/lib/avatarUtils.ts` directly via `fs.readFileSync`. After media deletion:
- Update the `read()` path from `packages/media/src/lib/avatarUtils.ts` to `packages/formatting/src/avatarUtils.ts`
- Update assertions that check media-specific content (T085, T089) to check formatting-specific content instead

**Files/directories to delete:**

| Path | Notes |
|---|---|
| `packages/media/src/index.ts` | Barrel |
| `packages/media/src/lib/avatarUtils.ts` | Duplicate of formatting |
| `packages/media/src/lib/documentsHelpers.ts` | Internal to media only |
| `packages/media/src/services/EntityImageService.ts` | Duplicate of documents |
| `packages/media/package.json` | Package manifest |
| `packages/media/project.json` | Nx config |
| `packages/media/tsconfig.json` | TypeScript config |
| `packages/media/tsup.config.ts` | Build config |
| `packages/media/` (entire directory) | Everything above |

**Verification:**
- Grep for `@alga-psa/media` across entire repo returns 0 results (excluding docs/plans, package-lock.json)
- `npm install` succeeds (updates lock file)
- Build passes (`NODE_OPTIONS=--max-old-space-size=32768 npx nx run-many -t build --maxParallel=4`)
- `teams-v2-improvements.test.ts` passes

### Task 4: Fix client portal user avatars on MSP user list

**What:** `server/src/components/settings/general/UserList.tsx` fetches avatar URLs at line 73 using `getUserAvatarUrlAction(user.user_id, user.tenant)` for ALL users. This queries `document_associations` for `entity_type='user'` + `entity_id=user_id`. But client portal users store their avatar as `entity_type='contact'` using their `contact_id` (set during client portal avatar upload in `clientUserActions.ts`). So the query returns null for every client portal user.

**Root cause chain:**
1. Client portal user uploads avatar via `uploadContactAvatar(user.contact_id, formData)` in `clientUserActions.ts:289`
2. This stores `entity_type='contact'`, `entity_id=contact_id` in `document_associations`
3. MSP UserList fetches via `getUserAvatarUrlAction(user.user_id)` which queries `entity_type='user'`, `entity_id=user_id`
4. No match found → null → no avatar displayed

**Fix in `server/src/components/settings/general/UserList.tsx`:**

1. Import `getContactAvatarUrlAction` from `@alga-psa/user-composition/actions` (already imported `getUserAvatarUrlAction` from there)
2. In the avatar fetch loop (lines 71-78), branch on `user.user_type`:

```typescript
const avatarPromises = usersToFetch.map(async (user) => {
  try {
    let avatarUrl: string | null = null;
    if (user.user_type === 'client' && user.contact_id) {
      avatarUrl = await getContactAvatarUrlAction(user.contact_id, user.tenant);
    } else {
      avatarUrl = await getUserAvatarUrlAction(user.user_id, user.tenant);
    }
    return { userId: user.user_id, avatarUrl };
  } catch (error) {
    console.error(`Error fetching avatar for user ${user.user_id}:`, error);
    return { userId: user.user_id, avatarUrl: null };
  }
});
```

**Verification:**
- Client portal users on the MSP user list display their contact avatar
- Internal users still display their user avatar
- Users with no avatar show initials (not broken)

### Task 5: Fix contact avatar '?' fallback on contact details page

**What:** `ContactAvatarUpload.tsx:38` passes `entityName=""` to `EntityImageUpload`. When no avatar image exists, `EntityImageUpload` renders `UserAvatar` with `userName=""`. The avatar fallback logic in `UserAvatar` computes initials from an empty string, which returns `'?'`.

**Root cause:** `ContactAvatarUpload` component interface doesn't accept a contact name prop:

```typescript
// Current - no name prop
interface ContactAvatarUploadProps {
  contactId: string;
  currentAvatarUrl?: string | null;
  onAvatarUpdated?: (newUrl: string | null) => void;
}
```

**Fix in `packages/clients/src/components/contacts/ContactAvatarUpload.tsx`:**

1. Add `contactName` prop to `ContactAvatarUploadProps`
2. Pass it to `EntityImageUpload` as `entityName`

```typescript
interface ContactAvatarUploadProps {
  contactId: string;
  contactName: string;
  currentAvatarUrl?: string | null;
  onAvatarUpdated?: (newUrl: string | null) => void;
}

// ... in the component:
<EntityImageUpload
  entityType="contact"
  entityId={contactId}
  entityName={contactName}   // was: ""
  ...
/>
```

**Callers to update (pass `contactName`):**

| File | Line | Change |
|---|---|---|
| `packages/clients/src/components/contacts/ContactDetails.tsx` | ~925 | Add `contactName={editedContact.full_name}` |
| `packages/clients/src/components/contacts/ContactDetailsEdit.tsx` | ~170 | Add `contactName={contact.full_name}` |

**Verification:**
- Contact details page shows contact initials (e.g. "JD" for John Doe) instead of '?' when no avatar exists
- Contact avatar upload still works correctly
- Contact avatar display still works when an avatar image exists

## Risks

1. **Media's EntityImageService uses dynamic imports; documents' version uses direct imports.** The documents version calls `StorageService.uploadFile()` directly and `deleteDocument()` / `getDocumentTypeId()` via direct imports. The media version used `getStorageServiceAsync()` and `deleteDocumentAsync()` via dynamic imports. Since we're redirecting to the documents version (which is what other packages already use), this is safe -- the documents version is the canonical implementation that's been in production.

2. **Test file reads source files via `fs.readFileSync`.** The `teams-v2-improvements.test.ts` file does string-content assertions on source files. These assertions must be updated to reference the new file paths. If not updated, the test will fail at runtime with ENOENT.

3. **2 new cross-package lint warnings.** `users -> documents` adds 2 warnings. This is a conscious trade-off: 2 warnings in exchange for deleting an entire duplicate package. The same import pattern already exists in 4 other packages.

## Acceptance Criteria

- [ ] `server/src/lib/posthog.ts` deleted, 0 grep hits for `@/lib/posthog`
- [ ] `server/src/lib/actions/tenant-secret-actions.ts` deleted, 2 callers import from `@alga-psa/tenancy/actions`
- [ ] `packages/media/` directory deleted entirely
- [ ] `getTeamAvatarUrl` exists in `@alga-psa/formatting/avatarUtils`
- [ ] 3 media callers import from canonical packages (documents, formatting)
- [ ] All `@alga-psa/media` references removed from config files (next.config, tsconfig, Dockerfile, package.json)
- [ ] `NODE_OPTIONS=--max-old-space-size=32768 npx nx run-many -t build --maxParallel=4` passes
- [ ] `teams-v2-improvements.test.ts` passes
- [ ] Zero re-export shims created
- [ ] No new circular dependencies introduced
- [ ] UserList.tsx fetches contact avatar for `user_type='client'` users using `contact_id`
- [ ] ContactAvatarUpload passes contact name to EntityImageUpload (no more '?' fallback)
- [ ] ContactDetails.tsx passes `editedContact.full_name` to ContactAvatarUpload
