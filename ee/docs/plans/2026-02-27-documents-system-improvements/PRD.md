# PRD: Documents System Improvements

- Slug: `2026-02-27-documents-system-improvements`
- Date: `2026-02-27`
- Status: Draft

## Summary

A 5-phase overhaul of the Alga PSA documents system to add entity-scoped folders, admin-configurable folder templates, client portal visibility controls, shareable document URLs, and a knowledge base foundation. The system is designed so that each phase builds on the previous ones, with the entire document infrastructure serving as the foundation for a full MSP knowledge base.

## Problem

The current documents system has several gaps that limit its value for MSPs:

1. **Flat folders per tenant** — Folders are global to the tenant. A client, project, or ticket cannot have its own private folder tree. This means all users see one giant folder structure that mixes documents from every entity.
2. **No visibility control for clients** — There is no `is_client_visible` flag. MSPs cannot control which documents clients see on the portal. The client portal only shows documents embedded in individual tickets and project tasks — no central Documents page.
3. **No folder templates** — Every folder is manually created. There is no way for an admin to define a standard structure (e.g., "Contracts / Invoices / Meeting Notes") that auto-applies to new clients.
4. **No auto-filing** — Uploading a ticket attachment doesn't place it in any folder. Documents accumulate without organization.
5. **No shareable links** — There is no way to generate a URL that allows external access to a document (public or authenticated).
6. **No knowledge base** — Documents exist as files and rich-text notes, but there is no article concept, publishing workflow, review cycle, or audience targeting. MSPs must use separate tools (IT Glue, Hudu) for KB, losing the integrated advantage.

## Goals

1. **Entity-scoped folders** — Each client, project, ticket, and contract gets its own folder tree, isolated from others.
2. **Visibility toggle** — MSP users can mark documents/folders as client-visible with a single click. Clients never see internal-only documents.
3. **Folder templates** — Admins define folder structures per entity type. Templates are applied lazily on first document access.
4. **Auto-filing** — Uploads are automatically placed in the correct folder based on entity type and context.
5. **Client portal Documents hub** — A dedicated Documents page in the client portal aggregating all client-visible documents with folder browsing, search, and filtering.
6. **Share URLs** — MSP users can generate public, portal-authenticated, or password-protected share links for any document.
7. **Knowledge base foundation** — KB articles built as a document subtype with audience targeting, publishing workflow, review cycles, and category/tag taxonomy. Both internal and client-facing KB supported.

## Non-Goals

- AI-powered article generation or smart suggestions (future work, Phase 5 lays the foundation)
- Real-time collaborative editing of KB articles (existing Hocuspocus/Yjs infrastructure handles this for documents already)
- Document import from IT Glue / Hudu / Confluence (separate migration initiative)
- Credential / password vault (separate feature)
- Document retention policies / auto-archival
- E-signature integration
- Full-text search engine (e.g., Elasticsearch) — uses PostgreSQL text search for now

## Users and Primary Flows

### Personas

| Persona | Description |
|---------|-------------|
| **MSP Admin** | Configures folder templates, manages visibility settings, creates KB articles |
| **MSP Technician** | Uploads documents to entities, uses KB articles for troubleshooting, generates share links |
| **Client Contact (Portal)** | Views shared documents, browses external KB articles, downloads files via share links |
| **External Recipient** | Accesses documents via public share URLs without any account |

### Primary Flows

**Flow 1: MSP Admin configures folder template**
1. Admin navigates to Settings → Document Templates
2. Creates template "MSP Client Default" for entity type "client"
3. Defines folder tree: /Contracts, /Contracts/SLAs, /Invoices, /Meeting Notes, /Technical Documentation
4. Sets /Contracts and /Invoices as client-visible
5. Marks template as default for "client"

**Flow 2: Technician opens client Documents tab (lazy folder init)**
1. Technician navigates to Client → Documents tab
2. System checks `document_entity_folder_init` — no record found
3. System applies default "client" template → creates entity-scoped folders
4. Folder tree renders with pre-created structure
5. Technician uploads a contract → auto-filed to /Contracts

**Flow 3: MSP user toggles document visibility**
1. In Documents list, user sees eye icon next to each document
2. Clicks to toggle `is_client_visible` → eye icon changes state
3. Document is now visible in client portal Documents hub
4. Bulk select + toggle also supported

**Flow 4: Client views Documents hub in portal**
1. Client contact logs into portal
2. Navigates to "Documents" tab in top nav
3. Sees folder tree of only client-visible folders
4. Browses by folder, searches by name, filters by source (tickets/projects/contracts)
5. Views/downloads documents

**Flow 5: MSP user generates share link**
1. Right-clicks document → "Share"
2. Dialog opens with share type selector (Public / Portal Auth / Password Protected)
3. Sets optional expiry and max downloads
4. Clicks "Generate" → URL with copy button appears
5. Shares URL with recipient

**Flow 6: MSP user creates KB article**
1. Navigates to Knowledge Base section
2. Clicks "New Article" → selects template (e.g., "Troubleshooting Guide")
3. Editor opens with template structure pre-filled
4. Sets audience to "client", category to "FAQs"
5. Writes content using BlockNote editor
6. Submits for review → reviewer approves → article published
7. Published article automatically appears in client portal KB section

## UX / UI Notes

### Phase 1 — Entity Mode Folder Tree
- Documents component in entity mode gains a collapsible folder sidebar (same as global folder mode, but scoped to entity)
- Eye icon (visibility toggle) appears on each document row/card and each folder in the tree
- Eye icon only rendered for MSP users, not in client portal context

### Phase 3 — Client Portal Documents Hub
- New top-level nav item "Documents" between "Projects" and "Appointments"
- Left sidebar: folder tree (read-only, no create/delete)
- Main area: document grid/list with cards showing name, type icon, date, source entity badge
- Filter bar: search, source type dropdown (Tickets / Projects / Contracts / All), date range

### Phase 4 — Share Link Dialog
- Modal dialog launched from document context menu
- Three share type cards with radio selection
- Password input, date picker, number input for max downloads
- Generated URL shown in copyable input field
- List of existing share links below with status, copy, and revoke actions

### Phase 4 — Public Share Landing Page
- Minimal standalone page (not wrapped in MSP or portal layout)
- Shows: document name, file type icon, file size, expiry countdown
- Password input if password-protected
- Large "Download" button
- Tenant branding (logo) if available

### Phase 5 — KB Article Editor
- Same BlockNote editor as regular documents
- Metadata sidebar panel: audience selector, article type, category picker, review cycle, related articles
- Status bar at top: Draft / In Review / Published / Archived with transition buttons

## Requirements

### Functional Requirements

#### Phase 1: Entity-Scoped Folders + Visibility

| ID | Requirement |
|----|-------------|
| FR-1.1 | `document_folders` gains `entity_id` and `entity_type` columns. When set, folder is scoped to that entity. When NULL, folder is global (current behavior). |
| FR-1.2 | Same `folder_path` can exist for different entities (unique constraint includes entity scope). |
| FR-1.3 | `documents` and `document_folders` gain `is_client_visible` boolean column, default `false`. |
| FR-1.4 | `getFolderTree()` accepts optional `entityId`/`entityType` params and returns only matching folders. |
| FR-1.5 | `getDocumentsByFolder()` respects entity scope. |
| FR-1.6 | `createFolder()` accepts `entityId`, `entityType`, `isClientVisible`. |
| FR-1.7 | `toggleDocumentVisibility(documentIds, isClientVisible)` bulk-toggles visibility. |
| FR-1.8 | `toggleFolderVisibility(folderId, isClientVisible, cascade?)` toggles folder and optionally cascades to contained documents. |
| FR-1.9 | Documents component in entity mode shows folder tree sidebar. |
| FR-1.10 | Visibility toggle (eye icon) shown on documents and folders in MSP context only. |
| FR-1.11 | `document_folders` has RLS tenant isolation policies. |
| FR-1.12 | `ensureEntityFolders(entityId, entityType)` stub returns empty tree (Phase 2 fills in logic). |

#### Phase 2: Folder Templates + Auto-Filing

| ID | Requirement |
|----|-------------|
| FR-2.1 | `document_folder_templates` table stores template name, entity type, and default flag per tenant. |
| FR-2.2 | `document_folder_template_items` table stores the folder tree structure for each template. |
| FR-2.3 | `document_entity_folder_init` table tracks which entities have had folders initialized. |
| FR-2.4 | At most one template per entity type per tenant can be marked as default (partial unique index). |
| FR-2.5 | Admin can CRUD folder templates via Settings → Document Templates. |
| FR-2.6 | `ensureEntityFolders()` checks init tracker, applies default template if uninitialized, records init. |
| FR-2.7 | Template application is idempotent — skips folders that already exist. |
| FR-2.8 | `uploadDocument()` auto-files: if entity has a matching folder, sets `folder_path`. Best-effort — never fails the upload. |
| FR-2.9 | Template editor supports drag-and-drop reorder, add/remove folders, client-visibility toggles per folder. |
| FR-2.10 | Documents component in entity mode calls `ensureEntityFolders()` on mount. |

#### Phase 3: Client Portal Documents Hub

| ID | Requirement |
|----|-------------|
| FR-3.1 | New "Documents" page in client portal at `/client-portal/documents`. |
| FR-3.2 | "Documents" link added to client portal top navigation. |
| FR-3.3 | `getClientDocuments()` returns paginated docs where `is_client_visible = true` AND associated with authenticated user's client. |
| FR-3.4 | Aggregates documents across: direct client associations, client's tickets, client's project tasks, client's contracts. |
| FR-3.5 | `getClientDocumentFolders()` returns folder tree for client-visible folders only. |
| FR-3.6 | Client portal documents page shows folder tree (read-only), document grid/list, search, and filters. |
| FR-3.7 | Client A can NEVER see client B's documents (enforced at query level via client_id filter). |
| FR-3.8 | `downloadClientDocument()` verifies both `is_client_visible` and client ownership before serving. |
| FR-3.9 | File view API route extended to check `is_client_visible` for client users. |
| FR-3.10 | Existing inline ticket document display continues working unchanged (does not require `is_client_visible`). |

#### Phase 4: Document Share URLs

| ID | Requirement |
|----|-------------|
| FR-4.1 | `document_share_links` table stores share token, type, password hash, expiry, max downloads, revocation status. |
| FR-4.2 | `document_share_access_log` table records every access with IP, user agent, timestamp. |
| FR-4.3 | `createShareLink()` generates 256-bit cryptographically random token. |
| FR-4.4 | Three share types: `public` (no auth), `portal_authenticated` (portal login required), `password_protected`. |
| FR-4.5 | Share links support optional expiry date and max download count. |
| FR-4.6 | Public share route (`/api/share/[token]`) works without session. |
| FR-4.7 | Password-protected links require password verification before download. |
| FR-4.8 | Portal-authenticated links require active client portal session and verify client access. |
| FR-4.9 | Share info route (`/api/share/[token]/info`) returns document metadata without downloading. |
| FR-4.10 | Public landing page at `/share/[token]` shows document info and download button. |
| FR-4.11 | `ShareLinkDialog` component allows creating/listing/revoking share links from document context menu. |
| FR-4.12 | Access is logged and download count incremented on each access. |
| FR-4.13 | MSP users can revoke any share link at any time. |

#### Phase 5: Knowledge Base Foundation

| ID | Requirement |
|----|-------------|
| FR-5.1 | `kb_articles` table extends `documents` — every article has a parent document (inherits content, versions, associations). |
| FR-5.2 | Article types: sop, runbook, troubleshooting, faq, how_to, reference, policy. |
| FR-5.3 | Audience targeting: internal, client, public. |
| FR-5.4 | Publishing workflow: draft → in_review → published → archived. |
| FR-5.5 | Publishing an article with `audience = 'client'` auto-sets parent document's `is_client_visible = true`. |
| FR-5.6 | Archiving clears `is_client_visible` on parent document. |
| FR-5.7 | Review cycle: configurable review_cycle_days, next_review_due, staleness indicators. |
| FR-5.8 | Review assignment: submit for review to specific users, reviewers approve or request changes. |
| FR-5.9 | `kb_article_relations` for related/prerequisite/supersedes linking. |
| FR-5.10 | `kb_article_templates` for pre-built article structures (BlockNote JSON). |
| FR-5.11 | MSP KB section: article list with filters, article editor with metadata sidebar, publishing controls, review dashboard. |
| FR-5.12 | Client portal KB section: published client-audience articles with category browsing, search, "was this helpful?" feedback. |
| FR-5.13 | Articles can be tagged via existing tag system (`tagged_type = 'knowledge_base_article'`). |
| FR-5.14 | `createArticleFromTicket()` pre-populates article from ticket data (foundation for AI enhancement). |
| FR-5.15 | View count and helpfulness tracking (helpful_count, not_helpful_count). |
| FR-5.16 | URL-friendly slug per article, unique per tenant. |

### Non-functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | All new tables use composite keys with `tenant` and RLS tenant isolation policies. |
| NFR-2 | All new tables include inline `distributeIfCitus()` calls within the same migration file (not separate Citus migrations). Pattern: define helper at top of migration, call after each `createTable`. See `server/migrations/20260219000001_create_sla_policies.cjs` for reference. |
| NFR-3 | No database triggers (Citus constraint). |
| NFR-4 | Share token validation must not use tenant-scoped connection (uses admin connection). |
| NFR-5 | Client portal queries must always filter by authenticated user's client_id — no exceptions. |
| NFR-6 | Existing document flows (upload, download, entity mode, folder mode) must not regress. |

## Data / API / Integrations

### New Database Tables (by phase)

**Phase 1**: Columns added to `document_folders` (entity_id, entity_type) and `documents`/`document_folders` (is_client_visible).

**Phase 2**: `document_folder_templates`, `document_folder_template_items`, `document_entity_folder_init`

**Phase 4**: `document_share_links`, `document_share_access_log`

**Phase 5**: `kb_articles`, `kb_article_relations`, `kb_article_templates`, `kb_article_reviewers`

### New API Routes

| Route | Phase | Auth | Description |
|-------|-------|------|-------------|
| `GET /api/share/[token]` | 4 | None/Conditional | Download shared document |
| `GET /api/share/[token]/info` | 4 | None | Get share metadata |
| `GET /share/[token]` (page) | 4 | None | Public share landing page |

### New Server Action Files

| File | Phase | Description |
|------|-------|-------------|
| `packages/documents/src/actions/folderTemplateActions.ts` | 2 | Template CRUD, apply template |
| `packages/documents/src/actions/shareActions.ts` | 4 | Share link CRUD, token validation |
| `packages/documents/src/actions/kbActions.ts` | 5 | Article CRUD, publishing, review |
| `packages/client-portal/src/actions/client-portal-actions/client-documents.ts` | 3 | Client portal document queries |

## Security / Permissions

- **Tenant isolation**: All tables use RLS. All queries include tenant filter.
- **Client isolation**: Client portal queries derive client_id from authenticated user → contact → client chain. Never trust client-provided IDs.
- **Share URL security**: Tokens are 256-bit cryptographically random. Public routes use admin connection for lookup, then set tenant context. Password-protected links use bcrypt hashing.
- **Visibility enforcement**: `is_client_visible = false` by default. MSP explicitly controls what clients see.
- **RBAC**: Existing `document:read/create/update` permissions enforced for client portal users. MSP users require corresponding entity permissions.

## Rollout / Migration

### Phase Order and Dependencies

```
Phase 1 (Entity-Scoped Folders + Visibility)
  ├──→ Phase 2 (Folder Templates + Auto-Filing)
  ├──→ Phase 3 (Client Portal Documents Hub)
  ├──→ Phase 4 (Share URLs) — can parallel with P2/P3
  └──→ Phase 5 (Knowledge Base) — needs P1 + P3
```

### Migration Safety

- Phase 1 migrations add nullable columns and a new default-false boolean — **no data transformation needed**.
- Unique constraint change on `document_folders` must handle existing NULL entity_id rows correctly (uses COALESCE).
- `is_client_visible` defaults to `false` — all existing documents remain invisible to clients until explicitly toggled. This is intentionally conservative.

## Open Questions

1. Should the client portal Documents page be behind a feature flag initially?
2. Should folder templates be seeded with defaults (e.g., "MSP Client Default") or start empty?
3. For KB articles, should `audience = 'public'` articles be accessible without any login at all?

## Acceptance Criteria (Definition of Done)

### Phase 1
- [ ] Entity-scoped folders can be created for clients, projects, tickets, contracts
- [ ] Two different clients can have folders with the same path
- [ ] `is_client_visible` toggle works on documents and folders
- [ ] Existing global folders still work (regression test)
- [ ] Documents component in entity mode shows folder tree sidebar

### Phase 2
- [ ] Admin can create/edit/delete folder templates
- [ ] Default template is applied lazily on first entity document access
- [ ] Template application is idempotent
- [ ] Document uploads auto-file into matching entity folders
- [ ] Admin UI for template management is functional

### Phase 3
- [ ] Client portal has "Documents" nav item and page
- [ ] Only `is_client_visible = true` documents appear
- [ ] Client A cannot see client B's documents
- [ ] Folder tree, search, and source filters work
- [ ] Download works with proper permission checks

### Phase 4
- [ ] Public share link works in incognito (no auth)
- [ ] Portal-authenticated link requires login
- [ ] Password-protected link requires password
- [ ] Expiry and max download limits enforced
- [ ] Revocation immediately invalidates the link
- [ ] Access logging records every download

### Phase 5
- [ ] KB article created as document subtype (dual identity)
- [ ] Publishing with audience='client' makes article visible in portal
- [ ] Archiving removes portal visibility
- [ ] Review cycle and staleness indicators work
- [ ] Article templates populate editor with structure
- [ ] Tags and categories are functional
- [ ] Client portal KB section shows published client articles with feedback
