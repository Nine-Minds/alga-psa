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
- F004 complete: `TicketDetailScreen` now renders an `Avatar` plus name row for the contact field inside `KeyValue`, with the API key passed through for protected image fetches.
- F005 complete: the client `KeyValue` field now uses the same avatar row pattern so logos render beside the client name instead of plain text only.
- F006 complete: null `contact_avatar_url`/`client_logo_url` now fall back cleanly because the screen always renders the shared `Avatar` component and `KeyValue` accepts rich value content instead of string-only text.
- F010 complete: `POST /api/v1/tickets/{id}/documents` now exists via the ticket documents route plus `ApiTicketController.uploadDocument()`, using API-key auth and ticket update permission checks before delegating to the service upload path.
- F011 complete: the upload controller reads `multipart/form-data` with `req.formData()`, extracts the `file` field, and `TicketService.uploadTicketDocument()` persists the payload through `StorageService.validateFileUpload()` and `StorageService.uploadFile()`.
- F012 complete: `TicketService.uploadTicketDocument()` now inserts a `documents` row and a matching `document_associations` row with `entity_type: 'ticket'` inside one transaction, after resolving the folder path and document type.
- F013 complete: after upload, the service reloads the enriched `IDocument` via `getDocumentById()` and the controller returns that object in the API success payload with HTTP 201.
- F014 complete: `ee/mobile/src/api/documents.ts` now exposes `getTicketDocuments()` as the mobile wrapper around `GET /api/v1/tickets/{ticketId}/documents`, including the required `x-api-key` header and typed `TicketDocument[]` response.
- F015 complete: `uploadTicketDocument()` now posts `FormData` to the same ticket documents endpoint, and `ApiClient.request()` was updated so multipart bodies bypass JSON encoding and omit the JSON content type header.
- F016 complete: `DocumentsSection` is now mounted in `TicketDetailScreen` below the description card and loads ticket documents into a dedicated card section on first render.
- F017 complete: each document row now renders the document name plus a secondary metadata line composed from the resolved type label, formatted file size, and formatted `updated_at` timestamp.
- F018 complete: the documents card header now includes a neutral `Badge` showing the current document count next to the attach action, satisfying the count badge requirement.
- F019 complete: tapping a document row now downloads the file to Expo FileSystem with the API key header and immediately hands the cached URI off to `Linking.openURL()` for the platform handler.
- F020 complete: the attach UI now exposes a Camera option backed by `expo-image-picker`, including explicit camera permission checks and upload of the captured asset through the document API wrapper.
- F021 complete: the same attach affordance now exposes a File option backed by `expo-document-picker`, allowing arbitrary picked files to be posted as ticket documents.
- F022 complete: while an upload request is in flight, `DocumentsSection` switches on an `ActivityIndicator` plus localized uploading text so technicians get explicit progress feedback instead of a dead UI.
- F023 complete: successful uploads now call `loadDocuments()` before clearing the upload state, so the section refreshes immediately and the new attachment appears without reopening the screen.
- F024 complete: when the ticket has no attachments, the documents card now renders a dedicated localized empty-state message instead of an empty container.
- F025 complete: document loading/open/upload failures now surface localized errors in the section, with a specific camera-permission denial path and fallback server/network error messaging for rejected uploads.
- F030 complete: `GET /api/v1/tickets/{id}/materials` now exists through the new ticket materials route plus `ApiTicketController.getMaterials()`, and the service exposes `getTicketMaterials()` for the shared list path.
- F031 complete: `getTicketMaterials()` and `getTicketMaterialById()` both join `service_catalog` so material payloads include `service_name` and `sku` directly from the product catalog.
- F032 complete: `POST /api/v1/tickets/{id}/materials` now exists via `ApiTicketController.addMaterial()` and the dedicated ticket materials route, returning a created material payload with HTTP 201.
- F033 complete: create requests now pass through `createTicketMaterialSchema` for body validation and are revalidated in the service for positive quantity, non-negative rate, and product-backed `service_id` enforcement before insert.
- F034 complete: `addTicketMaterial()` now looks up the ticket first and copies `client_id` from the ticket row into `ticket_materials`, so mobile callers do not send client context explicitly.
- F035 complete: `ee/mobile/src/api/materials.ts` now exposes `getTicketMaterials()` as the typed wrapper around `GET /api/v1/tickets/{ticketId}/materials`.
- F036 complete: the same mobile API module now exposes `addTicketMaterial()` for posting `{ service_id, quantity, rate, currency_code, description? }` to the ticket materials endpoint.

## Commands / Runbooks
- Server targeted test: `cd server && npx vitest run src/test/unit/api/ticketService.avatarUrls.test.ts`
- Mobile targeted test: `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.avatars.test.ts`
- Server targeted tests: `cd server && npx vitest run src/test/unit/api/ticketMaterials.service.test.ts src/test/unit/api/ticketMaterials.contract.test.ts src/test/unit/api/ticketDocumentsUpload.contract.test.ts src/test/unit/api/ticketDocumentUpload.service.test.ts src/test/unit/api/ticketService.avatarUrls.test.ts`
- Mobile targeted tests: `cd ee/mobile && npx vitest run src/api/materials.test.ts src/features/ticketDetail/components/MaterialsSection.test.ts src/api/documents.test.ts src/features/ticketDetail/components/DocumentsSection.test.ts src/screens/TicketDetailScreen.avatars.test.ts`
