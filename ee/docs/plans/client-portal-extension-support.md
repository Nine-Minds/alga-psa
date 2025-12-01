# Plan: Client Portal Extension Support

## Objective
Extend the existing extension system to support the Client Portal. This involves adding a new hook for the client portal menu, implementing the discovery logic, adding the navigation UI, and creating the runtime page for client portal extensions.

Status update (2025-11-21):
- Manifest schema includes `ui.hooks.clientPortalMenu`; backend discovery and client portal menu rendering are implemented (`server/src/app/client-portal/extensions/[id]/page.tsx`, `ClientPortalLayout`, menu component).
- Runtime iframe uses `buildExtUiSrc` and `bootstrapIframe` to load Runner-hosted UI; client portal page exists and matches MSP flow.
- Follow-up: add automated verification/tests and doc links from client portal docs.

## Context
The current extension system works for the MSP portal (`/msp/*`). We need to replicate/adapt this for the Client Portal (`/client-portal/*`).
- **Manifest:** Extensions declare `ui.hooks.appMenu` for MSP. We will add `ui.hooks.clientPortalMenu` for Client Portal.
- **Discovery:** `listAppMenuItemsForTenant` finds MSP extensions. We need `listClientPortalMenuItemsForTenant`.
- **Navigation:** MSP has a dynamic sidebar. Client Portal has a top navbar with hardcoded links.
- **Runtime:** Extensions run in iframes (`/msp/extensions/[id]`). We need `/client-portal/extensions/[id]`.

## Phase 1: Manifest & Schema Updates
- [x] **Update Manifest Schema:**
    - Modify `ee/server/src/lib/extensions/schemas/manifest-v2.schema.ts`.
    - Add `clientPortalMenu` to `uiHooksSchema`.
    - Structure: `{ label: string }`.

## Phase 2: Backend Discovery Logic
- [x] **Create Server Action:**
    - Create `ee/server/src/lib/actions/clientPortalExtActions.ts` (or similar).
    - Implement `listClientPortalMenuItemsForTenant()`:
        - Query `tenant_extension_install` + `extension_version` + `extension_registry`.
        - Filter by `is_enabled` and `ui.hooks.clientPortalMenu`.
        - Return `{ id, label }`.
    - Ensure strictly typed return values.

## Phase 3: Frontend Navigation
- [x] **Create Menu Component:**
    - Create `server/src/components/client-portal/ClientExtensionsMenu.tsx`.
    - Fetch items using `listClientPortalMenuItemsForTenant`.
    - Render as a dropdown or list of links in the top navbar.
    - Use `ClientPortalLayout` styling (Tailwind).
- [x] **Integrate into Layout:**
    - Modify `server/src/components/layout/ClientPortalLayout.tsx`.
    - Add `ClientExtensionsMenu` to the navigation bar (e.g., next to "Appointments" or in a "More" dropdown if needed, or just append to the list).

## Phase 4: Runtime Implementation
- [x] **Create Extension Page:**
    - Create `server/src/app/client-portal/extensions/[id]/page.tsx`.
    - **Auth Check:** Ensure the user is a valid client portal user.
    - **Extension Info:** Fetch extension install info (reuse `getInstallInfo` if compatible, or create client-specific version if permissions differ).
    - **Render:** Use `DockerExtensionIframe` (or a wrapped version) to render the extension.
    - **URL Construction:** Use `buildExtUiSrc` with appropriate paths.
- [x] **Verify Iframe Context:**
    - Ensure the extension receives appropriate context (if any) for the client portal.
    - *Note:* Current `bootstrapIframe` is minimal. If the extension needs to know it's in "Client Mode", we might need to pass query params or handle it in the extension itself. For now, we assume the extension uses the `clientPortalMenu` hook implies it knows how to behave.

## Phase 5: Verification
- [x] **Test Case 1:** Extension with `clientPortalMenu`.
    - Verify it appears in the menu.
    - Verify clicking loads the iframe.
- [x] **Test Case 2:** Extension with `appMenu` ONLY.
    - Verify it does NOT appear in the client portal menu.
- [x] **Test Case 3:** Extension with BOTH.
    - Verify it appears in both (if logged in as appropriate user).
- [x] **Security:** Verify a client user cannot access an MSP-only extension by guessing the ID (if we implement permission checks in the page loader).

## Technical Details
- **Directories:**
    - `ee/server/src/lib/extensions/`
    - `server/src/components/layout/`
    - `server/src/app/client-portal/`
- **Key Files:**
    - `manifest-v2.schema.ts`
    - `ClientPortalLayout.tsx`
    - `DockerExtensionIframe.tsx`
