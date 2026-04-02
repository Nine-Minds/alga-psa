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
- F037 complete: `listProducts()` now wraps the existing `GET /api/v1/products` endpoint with mobile-friendly search and limit parameters, reusing the catalog’s `default_rate` and `sku` fields for picker display and defaults.
- F038 complete: `MaterialsSection` is now mounted in `TicketDetailScreen` as a dedicated ticket detail card that loads and manages material data independently of comments/documents.
- F039 complete: each material row now renders the product name, SKU, localized quantity/rate line, and a billed or unbilled badge directly in the ticket detail UI.
- F040 complete: the materials card now exposes an `Add Product` action that opens `EntityPickerModal`, loads product results from `/api/v1/products`, and supports search-driven filtering.
- F041 complete: selecting a product now closes the picker and opens a dedicated modal with quantity and rate inputs so the technician can confirm billable details before creation.
- F042 complete: the rate input is seeded from the selected product’s `default_rate`, converted from minor units into a currency input string so the default price is editable rather than blank.
- F043 complete: saving from the material modal now posts the selected product, quantity, and rate, then closes the modal and reloads the materials list so the new row is visible immediately.
- F044 complete: when a ticket has no materials, the section now renders a dedicated localized empty-state message instead of an empty list shell.
- F045 complete: materials loading, product search, input validation, and add failures now surface localized or server-provided errors in the section/modal instead of failing silently.
- T010/T011 complete: added `server/src/test/unit/api/ticketDocuments.service.test.ts` to exercise `TicketService.getTicketDocuments()` directly for both populated and empty ticket attachment lists, closing the remaining gap in document list coverage.
- T001-T005 complete: `server/src/test/unit/api/ticketService.avatarUrls.test.ts` covers populated contact/client image URLs, null helper fallbacks, and the no-contact/no-client branch so the ticket detail API enrichment is exercised end to end at the service layer.
- F050/T006-T008 complete: `ee/mobile/src/screens/TicketDetailScreen.avatars.test.ts` verifies both avatar image rendering paths and the initials fallback path for contact/client rows in the mobile detail screen.
- T012-T016 complete: `ticketDocumentUpload.service.test.ts` and `ticketDocumentsUpload.contract.test.ts` cover document creation, ticket association creation, response reloading, missing-file rejection, and the shared authenticated controller flow for upload requests.
- F052/F053/T017-T026/T051-T052 complete: `ee/mobile/src/api/documents.test.ts` and `ee/mobile/src/features/ticketDetail/components/DocumentsSection.test.ts` cover the document API wrappers, list metadata, count badge, download/open action, camera/file uploads, upload progress, refresh-after-upload, empty state, upload failure messaging, and camera-permission denial behavior.
- T030-T035 complete: `server/src/test/unit/api/ticketMaterials.service.test.ts` and `ticketMaterials.contract.test.ts` exercise list-with-join behavior, empty lists, successful material creation, ticket-derived `client_id`, validation failures, invalid `service_id`, and the controller’s authenticated validation path.
- F055/F056/T036-T043/T053-T054 complete: `ee/mobile/src/api/materials.test.ts` and `ee/mobile/src/features/ticketDetail/components/MaterialsSection.test.ts` cover material API wrappers, rendered product metadata and billed badges, picker search, SKU display, quantity/rate modal defaults, create-and-refresh flow, empty state, and add-failure messaging.
- F051/F054/F057/T050 complete: `cd ee/mobile && npx vitest run` now passes with the new avatar/document/material suites included. The only follow-up needed was mocking `DocumentsSection` and `MaterialsSection` inside the rich-text screen tests so those suites stay isolated from Expo native file-system bindings.
- F058/T055 complete: the final full mobile suite run now passes at `45` test files / `169` tests, confirming the pre-existing suite still passes alongside the new avatar, document, and material coverage.

## Commands / Runbooks
- Server targeted test: `cd server && npx vitest run src/test/unit/api/ticketService.avatarUrls.test.ts`
- Mobile targeted test: `cd ee/mobile && npx vitest run src/screens/TicketDetailScreen.avatars.test.ts`
- Server targeted tests: `cd server && npx vitest run src/test/unit/api/ticketMaterials.service.test.ts src/test/unit/api/ticketMaterials.contract.test.ts src/test/unit/api/ticketDocumentsUpload.contract.test.ts src/test/unit/api/ticketDocumentUpload.service.test.ts src/test/unit/api/ticketService.avatarUrls.test.ts`
- Mobile targeted tests: `cd ee/mobile && npx vitest run src/api/materials.test.ts src/features/ticketDetail/components/MaterialsSection.test.ts src/api/documents.test.ts src/features/ticketDetail/components/DocumentsSection.test.ts src/screens/TicketDetailScreen.avatars.test.ts`
