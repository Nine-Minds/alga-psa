# Scratchpad: Stale Code Quick Wins

## Key Discoveries

### Media package exists for a reason that no longer applies

The `@alga-psa/media` package was created to break the cycle `documents -> users -> media -> documents`. This cycle was resolved and removed from the known-cycles baseline. The media package's dynamic import workarounds (`getStorageServiceAsync()`, `deleteDocumentAsync()`, `getDocumentTypeIdAsync()`) are no longer needed -- the canonical `documents/lib/entityImageService.ts` uses direct imports to `@alga-psa/storage/StorageService` and internal `documentActions`.

### Three copies of avatarUtils exist

1. `@alga-psa/formatting/avatarUtils.ts` (228 LOC) -- uses `getImageUrlInternal` from `./imageUrl.ts`
2. `@alga-psa/user-composition/lib/avatarUtils.ts` (~95 LOC) -- has its own `getImageUrlInternalLite` inline
3. `@alga-psa/media/lib/avatarUtils.ts` (87 LOC) -- uses dynamic import from documents

This PR deletes #3. Consolidating #1 and #2 is a separate future task.

### `getTeamAvatarUrl` only exists in media

The formatting package's `EntityType` already includes `'team'`, and `getEntityImageUrl` works for any entity type. But there's no `getTeamAvatarUrl` convenience function. Adding one is a trivial 4-line wrapper.

### documents version of EntityImageService is the canonical one

The `@alga-psa/documents` version:
- Uses direct `StorageService` import (not dynamic)
- Uses direct `deleteDocument`/`getDocumentTypeId` calls
- Has `isActionPermissionError` handling
- Already used by 4 other packages (`clients`, `client-portal`, `tenancy`, documents-internal)

The media version:
- Uses dynamic imports to break cycles (no longer needed)
- Less robust error handling (no permission error check)
- Only used by 3 callers (users x2, teams x1)

### Cross-package violations trade-off

Adding `users -> documents` creates 2 new lint warnings. But:
- 4 other packages already do this exact import
- We delete an entire package (8 files) in exchange
- `teams -> documents` creates NO warning (teams not in VERTICAL_PACKAGES)

### Test file reads source files via fs.readFileSync

`server/src/test/teams-v2-improvements.test.ts` does string-content assertions on source files:
```typescript
const mediaAvatarUtils = read('packages/media/src/lib/avatarUtils.ts');
```
This must be updated to point at the formatting file, and assertions T085/T089 need adjustment.

### Avatar Bug 1: Client portal user avatars on MSP user list

Root cause chain:
1. Client portal user uploads avatar via `uploadContactAvatar(user.contact_id, formData)` in `clientUserActions.ts:289`
2. This stores `entity_type='contact'`, `entity_id=contact_id` in `document_associations`
3. MSP UserList fetches via `getUserAvatarUrlAction(user.user_id)` which queries `entity_type='user'`, `entity_id=user_id`
4. No match → null → no avatar displayed

Fix: Branch on `user.user_type` in `UserList.tsx` avatar fetch loop. Use `getContactAvatarUrlAction(user.contact_id)` for client users.

### Avatar Bug 2: Contact avatar '?' fallback

Root cause chain:
1. `ContactAvatarUpload.tsx:38` passes `entityName=""` to `EntityImageUpload`
2. `EntityImageUpload` renders `UserAvatar` with `userName=""`
3. `ContactAvatar.getContactInitials` returns `'?'` when `!name` (line 12 of `ContactAvatar.tsx`)

Fix: Add `contactName: string` prop to `ContactAvatarUpload`, pass it as `entityName`. Update 2 callers (`ContactDetails.tsx`, `ContactDetailsEdit.tsx`) to pass the contact's `full_name`.

## Build Command

Use instead of `npm run build`:
```bash
NODE_OPTIONS=--max-old-space-size=32768 npx nx run-many -t build --maxParallel=4
```

## File Inventory

### Files to delete (10 total)
- `server/src/lib/posthog.ts` (7 LOC)
- `server/src/lib/actions/tenant-secret-actions.ts` (222 LOC)
- `packages/media/src/index.ts` (3 LOC)
- `packages/media/src/lib/avatarUtils.ts` (87 LOC)
- `packages/media/src/lib/documentsHelpers.ts` (32 LOC)
- `packages/media/src/services/EntityImageService.ts` (296 LOC)
- `packages/media/package.json`
- `packages/media/project.json`
- `packages/media/tsconfig.json`
- `packages/media/tsup.config.ts`

### Files to edit (15 total)
- `server/src/components/settings/secrets/SecretsManagement.tsx` (import path)
- `server/src/components/settings/secrets/SecretDialog.tsx` (import path)
- `packages/formatting/src/avatarUtils.ts` (add getTeamAvatarUrl)
- `packages/users/src/services/UserService.ts` (import paths)
- `packages/users/src/actions/user-actions/userActions.ts` (import path)
- `packages/users/package.json` (dependencies)
- `packages/teams/src/actions/team-actions/avatarActions.ts` (import paths)
- `packages/teams/package.json` (dependencies)
- `server/next.config.mjs` (remove media alias)
- `server/tsconfig.json` (remove media paths)
- `ee/server/tsconfig.json` (remove media paths)
- `services/workflow-worker/Dockerfile` (remove media workspace)
- `server/src/test/teams-v2-improvements.test.ts` (update file paths + assertions)
- `server/src/components/settings/general/UserList.tsx` (avatar fetch branch)
- `packages/clients/src/components/contacts/ContactAvatarUpload.tsx` (add contactName prop)
- `packages/clients/src/components/contacts/ContactDetails.tsx` (pass contactName)
- `packages/clients/src/components/contacts/ContactDetailsEdit.tsx` (pass contactName)

## Execution Order

1. Task 1: Delete posthog.ts (independent, no deps)
2. Task 2: Redirect tenant-secret-actions callers, delete server copy (independent)
3. Task 3: Media deletion (depends on nothing, but do in sub-steps):
   a. Add `getTeamAvatarUrl` to formatting
   b. Update 3 caller files (import paths)
   c. Update 2 package.json files (dependencies)
   d. Update test file
   e. Update config files (next.config, tsconfig x2, Dockerfile)
   f. Delete `packages/media/` directory
   g. `npm install` to update lock file
4. Task 4: Fix UserList.tsx avatar fetch for client portal users
5. Task 5: Fix ContactAvatarUpload.tsx and its 2 callers
6. Build verification

## Gotchas

- The `teams-v2-improvements.test.ts` test does string matching on file content -- it will ENOENT if media files are deleted before the test path is updated.
- `server/next.config.mjs` has media referenced in 3 separate places (aliases object, transpilePackages array, resolve.alias). All 3 must be removed.
- `package-lock.json` will have stale entries for `@alga-psa/media` until `npm install` is run.
- The Dockerfile `--workspace=@alga-psa/media` line is in a `COPY` instruction context -- verify the line can be cleanly removed without breaking the multi-line command.
- T102 in `teams-v2-improvements.test.ts` checks that `@alga-psa/media` is in teams package.json deps -- must update to check for `@alga-psa/documents` and `@alga-psa/formatting` instead.

## Progress Log
- F001: Deleted `server/src/lib/posthog.ts` after validating the deprecated wrapper path had no remaining imports.
- F002: Pointed `SecretsManagement.tsx` at `@alga-psa/tenancy/actions` so it uses the canonical tenant secret actions barrel.
- F003: Updated `SecretDialog.tsx` to import secret CRUD helpers from the canonical `@alga-psa/tenancy/actions` barrel.
- F004: Deleted `server/src/lib/actions/tenant-secret-actions.ts` once both settings callers had been redirected to `@alga-psa/tenancy/actions`.
- F005: Added `getTeamAvatarUrl` to `packages/formatting/src/avatarUtils.ts` as the canonical wrapper over `getEntityImageUrl('team', ...)`.
- F006: Repointed `packages/users/src/services/UserService.ts` to import avatar URL lookup from formatting and image mutations from documents.
- F007: Updated `packages/users/src/actions/user-actions/userActions.ts` to consume entity image mutations from `@alga-psa/documents`.
- F008: Split `packages/teams/src/actions/team-actions/avatarActions.ts` imports across canonical documents and formatting packages.
