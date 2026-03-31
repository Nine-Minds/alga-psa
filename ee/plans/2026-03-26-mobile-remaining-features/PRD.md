# PRD: Mobile App — Documents, Products, and Avatars

## Problem Statement

The Alga PSA mobile app is missing three capabilities that exist in the web app:

1. **Documents** — No way to view, download, or attach files to tickets from mobile. Technicians in the field need to photograph issues and attach documentation.
2. **Products/Materials** — No way to add inventory items (products) to tickets. Technicians need to record parts used during on-site work.
3. **Contact & Client Avatars** — Ticket detail shows contact and client names as plain text without avatars/logos, making it harder to quickly identify entities.

## Goals

- Allow mobile users to view attached documents and upload new files (photos + files) to tickets
- Allow mobile users to add products from the catalog to tickets as materials
- Show contact avatar and client logo in the ticket detail view

## Non-Goals

- Document editing/renaming from mobile
- Document preview/inline viewing (just list + download + open)
- Multi-currency product pricing (use default rate)
- Product creation from mobile (only pick existing products)
- Deleting materials from mobile (can be added later)

## Target Users

Field technicians and support staff who use the mobile app to manage tickets on the go.

---

## Feature 15: Contact & Client Avatars in Ticket Detail

### Overview

Add `contact_avatar_url` and `client_logo_url` to the ticket detail API response, then display them in the mobile ticket detail UI next to the contact and client names.

### Server Changes

1. In `TicketService.getById()`, after fetching the ticket, call:
   - `getContactAvatarUrl(ticket.contact_name_id, context.tenant)` if contact exists
   - `getClientLogoUrl(ticket.client_id, context.tenant)` if client exists
2. Return both URLs in the response as `contact_avatar_url` and `client_logo_url`

### Mobile Changes

1. In `TicketDetailScreen.tsx`, render `<Avatar>` next to the contact name in the KeyValue component
2. Render `<Avatar>` next to the client name
3. No type changes needed (`TicketDetail` uses `Record<string, unknown>`)

### Acceptance Criteria

- Contact avatar shows next to contact name (or initials fallback)
- Client logo shows next to client name (or initials fallback)
- No avatar/logo fields = graceful fallback (no crash, just initials)

---

## Feature 10: Documents on Tickets

### Overview

Show document list in ticket detail with count, allow downloading, and allow uploading new files (camera photos and file picker).

### Server Changes

1. **New endpoint: `POST /api/v1/tickets/{id}/documents`**
   - Accepts `multipart/form-data` with file
   - Uses `StorageService.uploadFile()` to store
   - Creates document record + association with ticket
   - Returns the created `IDocument`
   - Follow pattern from `uploadDocument()` server action

2. **Existing endpoint: `GET /api/v1/tickets/{id}/documents`**
   - Already exists and works — returns `IDocument[]`

### Mobile Changes

1. **API layer** (`src/api/documents.ts`):
   - `getTicketDocuments(ticketId)` — GET endpoint
   - `uploadTicketDocument(ticketId, file)` — POST with FormData

2. **Documents section in ticket detail**:
   - New `DocumentsSection` component below description
   - Shows document count badge
   - Lists documents: name, type icon, size, upload date
   - Tap document to download/open via `Linking.openURL` or `expo-sharing`
   - "Attach" button with options: Camera (expo-image-picker) or File (expo-document-picker)
   - Upload progress indicator

3. **Dependencies**: `expo-image-picker`, `expo-document-picker`, `expo-file-system`

### Data Model (from server)

```
IDocument {
  document_id, document_name, type_name, type_icon,
  mime_type, file_size, created_by_full_name, updated_at,
  file_id (for download URL)
}
```

### Acceptance Criteria

- Document list visible in ticket detail with count
- Tap to download/open a document
- Upload photo from camera
- Upload file from file picker
- Upload shows progress, refreshes list on completion
- Empty state when no documents

---

## Feature 11: Products/Materials on Tickets

### Overview

Allow mobile users to add products (inventory items) to tickets as materials, recording quantity and rate.

### Server Changes

1. **New endpoint: `GET /api/v1/tickets/{id}/materials`**
   - Returns `ITicketMaterial[]` for the ticket
   - Joins `service_catalog` for `service_name` and `sku`

2. **New endpoint: `POST /api/v1/tickets/{id}/materials`**
   - Accepts: `{ service_id, quantity, rate, currency_code, description? }`
   - Requires ticket's `client_id` (fetched internally)
   - Returns created `ITicketMaterial`

3. **Existing endpoint: `GET /api/v1/products`**
   - Already exists — used for product search/listing

### Mobile Changes

1. **API layer** (`src/api/materials.ts`):
   - `getTicketMaterials(ticketId)` — GET
   - `addTicketMaterial(ticketId, data)` — POST
   - Product listing already available via `GET /api/v1/products`

2. **Materials section in ticket detail**:
   - New `MaterialsSection` component
   - Lists existing materials: product name, SKU, quantity, rate, billed status
   - "Add Product" button opens product picker (EntityPickerModal with search)
   - After selecting product, prompt for quantity (default 1) and rate (pre-filled from product default_rate)
   - Submit creates material

3. **Product picker**:
   - Reuse `EntityPickerModal` with search
   - Show product name + SKU as subtitle
   - After selection, show quantity/rate input modal

### Data Model

```
ITicketMaterial {
  ticket_material_id, service_id, service_name, sku,
  quantity, rate (cents), currency_code, description,
  is_billed, created_at
}
```

### Acceptance Criteria

- Materials list visible in ticket detail
- Add product via searchable picker
- Set quantity and rate before adding
- Billed/unbilled status badge shown
- Empty state when no materials

---

## Risks

- **Document upload endpoint** doesn't exist yet — needs server-side implementation following the existing `uploadDocument` pattern
- **Materials endpoints** don't exist yet — need two new API routes
- **expo-image-picker** and **expo-document-picker** may need Expo plugin configuration in `app.json`
- Large file uploads on mobile networks may timeout — consider reasonable file size limits

## Testing Requirements

Each feature must include actual test files that are written and verified to pass. The mobile app uses **Vitest** with React Test Renderer. Run tests with `npx vitest run` from `ee/mobile/`.

### Feature 15 Tests
- `ee/mobile/src/screens/TicketDetailScreen.avatars.test.ts` — Verify Avatar components render with contact/client URLs from ticket data, and fallback to initials when URLs are null

### Feature 10 Tests
- `ee/mobile/src/api/documents.test.ts` — Unit tests for `getTicketDocuments()` and `uploadTicketDocument()` API wrappers (mock API client)
- `ee/mobile/src/features/ticketDetail/components/DocumentsSection.test.ts` — Verify document list renders items, empty state, upload trigger

### Feature 11 Tests
- `ee/mobile/src/api/materials.test.ts` — Unit tests for `getTicketMaterials()`, `addTicketMaterial()`, `listProducts()` API wrappers (mock API client)
- `ee/mobile/src/features/ticketDetail/components/MaterialsSection.test.ts` — Verify materials list renders items with product name/SKU/quantity/rate, empty state, add product flow

### Test Execution
After implementing each feature, run `npx vitest run` from `ee/mobile/` and verify all tests pass (both new and existing). Fix any failures before moving to the next feature. The existing test suite has 126 tests that must continue to pass.

## Implementation Order

1. **Feature 15** (avatars) — smallest, server + mobile UI only, no new endpoints
2. **Feature 10** (documents) — medium, needs new upload endpoint
3. **Feature 11** (materials) — medium, needs two new endpoints + product picker
