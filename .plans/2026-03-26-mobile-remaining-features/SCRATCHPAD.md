# Scratchpad — Mobile Remaining Features (10, 11, 15)

## Key Discoveries

### Feature 10: Documents
- `GET /api/v1/tickets/{id}/documents` exists, returns `IDocument[]` via `createSuccessResponse`
- No upload endpoint in API v1 — uploads use server action `uploadDocument()` via FormData
- **Need to create:** `POST /api/v1/tickets/{id}/documents` for mobile upload
- Document download: `GET /api/documents/download/{fileId}` (different base path, not v1)
- Documents have: `document_name`, `type_name`, `type_icon`, `file_size`, `mime_type`, `created_by_full_name`, `updated_at`
- `getTicketDocuments()` already returns enriched data with joins
- `StorageService.uploadFile()` handles actual storage (Local or S3 provider)
- Auto-files into `/Tickets/Attachments` folder
- Document types resolved from MIME via `getDocumentTypeId()`

### Feature 11: Inventory/Products (Materials)
- Products live in `service_catalog` table with `item_kind = 'product'`
- Product-ticket link via `ticket_materials` table (quantity, rate, currency, description)
- **No API v1 endpoint for materials** — web app uses server actions
- **Need to create:** `GET /api/v1/tickets/{id}/materials` and `POST /api/v1/tickets/{id}/materials`
- Web component: `TicketMaterialsCard` — searchable product picker with multi-currency prices
- Key actions: `searchServiceCatalogForPicker()`, `getServicePrices()`, `listTicketMaterials()`, `addTicketMaterial()`
- Material fields: `service_id`, `quantity`, `rate`, `currency_code`, `description`, `is_billed`
- Products have SKU, vendor, manufacturer fields
- `GET /api/v1/products` exists for listing/searching products

### Feature 15: Contact & Client Avatars
- `getContactAvatarUrl(contactId, tenant)` in `@alga-psa/formatting/avatarUtils`
- `getClientLogoUrl(clientId, tenant)` in same file
- Both use `getEntityImageUrl()` which queries `document_associations` + `documents` + `external_files`
- Returns URL like `/api/documents/view/{fileId}?t={timestamp}` or null
- Comments already use this pattern: batch-fetch user avatar URLs, map into response
- `TicketService.getById()` has `contact_name_id` and `client_id` available from the ticket
- **Simple addition:** call both functions after ticket query, add to response
- Mobile `TicketDetail` type uses `& Record<string, unknown>` so new fields work without type changes

## Decisions
- Feature 15 is the quickest win (server change only + minor mobile UI)
- Feature 10 needs a new upload endpoint — can follow the pattern from `ApiAssetController`
- Feature 11 needs two new endpoints (list + create materials)
- For mobile, simplified product picker without multi-currency (use `default_rate`)

## Key File Paths
- `server/src/lib/api/services/TicketService.ts` — main ticket service
- `server/src/lib/api/controllers/ApiTicketController.ts` — ticket API controller
- `packages/formatting/src/avatarUtils.ts` — avatar/logo URL helpers
- `packages/documents/src/actions/documentActions.ts` — document upload action
- `packages/tickets/src/actions/materialCatalogActions.ts` — material actions
- `ee/mobile/src/screens/TicketDetailScreen.tsx` — mobile ticket detail
- `ee/mobile/src/api/tickets.ts` — mobile ticket API

## Progress Log
- F001 complete: `TicketService.getById()` now resolves `contact_avatar_url` via `getContactAvatarUrl()` when `contact_name_id` is present; implemented together with the rest of Feature 15 to avoid partial dead code.
- F002 complete: the same `Promise.all` enrichment in `TicketService.getById()` now resolves `client_logo_url` via `getClientLogoUrl()` when `client_id` is present, matching the PRD’s server contract.
- F003 complete: ticket detail responses now include both `contact_avatar_url` and `client_logo_url` alongside the existing enriched ticket payload and documents list.

## Commands / Runbooks
- Server targeted test: `cd server && npx vitest run src/test/unit/api/ticketService.avatarUrls.test.ts`
- Mobile targeted test: `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.avatars.test.ts`
