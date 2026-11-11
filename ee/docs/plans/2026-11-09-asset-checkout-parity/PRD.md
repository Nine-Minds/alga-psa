# PRD — Asset checkout parity (Snipe-IT model)

- Slug: `asset-checkout-parity`
- Date: `2026-11-09`
- Status: Draft
- Origin: alga-2026-0002944
- Builds on: `ee/plans/2026-10-09-asset-fields-assignment-bundles-merge/` (PR #3763)

## Summary

MSPs that run a separate asset tool (Snipe-IT is the common one) use it for one job above all: knowing who has what, since when, until when, and proof that the person accepted it. PR #3763 gave AlgaPSA an assignee contact per asset with history, bundles and shared workspaces. This plan turns that into a full checkout model:

- Anything holdable (an asset, a license seat, or a quantity of a stocked product) can be checked out to any holder (a contact, an MSP user, a client location, another asset, or a client as a whole). It carries an expected check-in date, notes, an optional acceptance requirement, and a check-in that closes it.
- One checkout engine and one ledger serve every kind of item and holder. Existing contact assignment becomes one case of it.
- Overdue check-ins, acceptance requests and checkout or check-in receipts flow through the existing date-trigger, notification-template and event machinery.
- A reusable acceptance engine (signed links, agreement-text hash, signer, IP, user agent) is extracted from the quote-acceptance pattern and used for checkout acceptance.
- License seats, accessories, consumables and components become checkout-able, mostly by building on inventory products and stock rather than adding parallel catalogues.
- A Snipe-IT connector for the migration importer brings hardware, users, locations, open checkouts, licenses, accessories, consumables and components across, so a tenant can leave Snipe-IT in one move.

## Problem

Today on main:

- An asset's assignee can only be a contact of the asset's client (`asset_assignments.contact_name_id NOT NULL`, `shared/models/assetAssignmentModel.ts`). It cannot be an MSP user (loaner laptops held by staff, MSP-owned kit), a location (a conference-room display), or another asset (a dock attached to a laptop).
- An assignment has no expected return date, no overdue state, no check-in step with condition notes, and no acceptance by the holder.
- Assigning from the Identity tile or bulk action emits only `ASSET_UPDATED`. `ASSET_ASSIGNED` and `ASSET_UNASSIGNED` exist in the catalogue but fire only for ticket/project association and client transfer. Workflows and emails cannot react cleanly to a checkout.
- No email tells the holder they now have the device, or reminds them it is due back.
- Loaners (`stock_units.loan_due_at`) have due dates, but only at the client level. They have no person, no reminder and no return notes. Overdue status is computed only in the UI.
- There are no software license or seat records (`software_catalog.is_managed` is a flag only). Nothing issues accessories, consumables or components to a person or an asset.
- The client portal shows a contact their assigned devices but offers no way to accept a checkout or request equipment.
- There is no Snipe-IT importer, and the CSV asset import has no assignee field.

These gaps keep MSPs paying for and double-keying a second system, and they block migration into AlgaPSA's asset module.

## Goals

1. One checkout engine: holdable kinds (asset, license, product) × holder kinds (contact, user, location, asset, client). It has a single ledger of open and closed checkouts with who, when, expected check-in, notes, source and acceptance state.
2. Asset checkout and check-in from every surface that assigns today, with the current holder shown everywhere the assignee is shown now.
3. Expected check-in dates, overdue state, and an overdue date trigger usable by workflows and notifications.
4. Optional end-user acceptance of a checkout through a signed link or the client portal, with a durable acceptance record and a stamped receipt.
5. Checkout, check-in, acceptance-request and overdue emails to the holder, through tenant-overridable notification templates.
6. Software licenses with seats that check out to contacts, users or assets, with seat counts and expiry.
7. Accessories, consumables and components as inventory products held in client-owned or MSP stock locations. They can be checked out (accessories), issued (consumables) or installed into an asset (components).
8. A client-portal "My equipment" view: what I hold, what I must accept, and requesting a requestable asset through a service request.
9. A checkout ledger screen with filters, overdue view, per-holder printable lists and CSV export, plus REST endpoints for checkout and check-in.
10. A Snipe-IT connector for the migration importer covering the data above.

## Non-goals

- Depreciation, book value and EOL dates.
- Moving quote acceptance onto the new acceptance engine. It stays as is; the engine is built so quotes can move later (see SCRATCHPAD).
- Reservations or booking calendars for assets (check out in the future, conflict detection).
- Drawn (handwritten) signature capture. Acceptance is typed-name plus audit trail, matching quotes.
- Continuous two-way sync with Snipe-IT. The connector is a migration import, re-runnable but one-way.
- Mobile write flows beyond check-in by scan (see Mobile).
- License compliance reconciliation against RMM-discovered installs. The software inventory link is shown, not enforced.
- Dropping `asset_assignments`. This plan stops it being the source of truth; removal is a follow-up.

## Users and Primary Flows

- **MSP technician:** checks a laptop out to a new hire with an expected return date and "requires acceptance". The holder gets an email, accepts, and the asset shows "Accepted". Later the tech checks it in with a condition note. The asset returns to "available" status and the history shows the full stay.
- **MSP technician:** checks a dock out to a laptop. The dock follows the laptop's holder in the portal and in "what does this person have".
- **MSP technician:** checks a display out to a client location ("Board room").
- **MSP admin:** checks an MSP-owned loaner out to a staff member (MSP user), or lends it to a customer: to a contact, or to the client as a whole.
- **MSP admin:** creates a Microsoft 365 license with 25 seats and checks seats out to contacts. The seat count shows 18/25 used, with expiry.
- **MSP technician:** issues 2 keyboards from the client's spare stock to a contact (accessory, returned later). Issues toner (consumable, never returned). Installs a 16 GB RAM module into a server (component).
- **Client portal contact:** sees "My equipment" (assets, seats and accessories held), accepts a pending checkout, and requests a requestable asset through a service request form.
- **Dispatcher or service manager:** opens the checkout ledger filtered to "overdue" and sends reminders.
- **Workflow author:** triggers on `ASSET_CHECKED_OUT` or `asset.checkin_due` to open a ticket or send a custom message.
- **Onboarding engineer:** runs the Snipe-IT connector against a Snipe-IT API URL and token, maps companies to clients, previews, and applies.

## UX / UI Notes

- **Assignee row:** the Identity tile's assignee row (`AssetAssigneeRow.tsx`) becomes a holder row. It shows a holder chip with a kind icon (contact, user, location, asset), the expected check-in date with an overdue badge, an acceptance badge (pending, accepted, declined), and Check out / Check in actions.
- **Check out dialog:** a holder-kind segmented control with a picker per kind (ContactPicker, UserPicker, client-location picker, asset picker). It also has an expected check-in date, a note, "Requires acceptance" (default from tenant settings), and "Email the holder" (default on for contact holders). Reuse standard dialog, picker and date components.
- **Check in dialog:** a condition note, the status to set (default: the tenant's default "available"-kind status), and an optional location to return to.
- **History:** a "Checkouts" panel on the asset detail page reads the ledger (holder, out, due, in, accepted, notes, source), alongside the existing timeline.
- **Bulk:** the asset list's bulk Assign becomes bulk Check out (same holder picker and fields), plus bulk Check in.
- **Holder pages:** the contact page "Assets" section becomes "Equipment": assets, license seats, accessories and components (via the assets they hold), with a printable "equipment held" sheet. The MSP user profile gets the same section for user holders. The client-location view gets a section for location holders.
- **Licenses:** a new Licenses tab under Assets, with a list, detail and seat table. Check out / check in a seat uses the same holder dialog, restricted to contact, user or asset.
- **Accessories, consumables and components:** inventory product settings gain an "asset role" (none, accessory, consumable, component). Stock locations can belong to a client. The client's Assets tab shows its stock pools with Check out (accessory), Issue (consumable) and Install (component) actions.
- **Checkout ledger:** Assets → Checkouts: a filterable DataTable (item kind, holder kind, client, status open/overdue/closed, acceptance) with CSV export. Show display names, never ids.
- **Client portal:** "My equipment" page; acceptance page (`/accept/[token]` for email links, inline in the portal for signed-in contacts); the "Request equipment" service-request field.
- **Tenant settings** (Assets settings tab): default "requires acceptance", acceptance agreement text (versioned), default checkout period in days, reminder lead time, and whether to email holders on checkout and check-in.

## Requirements

### Functional Requirements

#### FR-A Checkout engine

- A1. A `checkouts` ledger with one row per checkout. Fields:
  - item: `item_kind` (asset, license, product), `item_id`, `quantity`
  - holder: `holder_kind` (contact, user, location, asset, client), `holder_id`
  - client: `client_id`, the item's owning client; MSP-owned items use the tenant's own client record (`tenant_companies.is_default`), so it is never null
  - dates and people: `checked_out_at` and by, `expected_checkin_at`, `checked_in_at` and by
  - notes: `checkout_note`, `checkin_note`
  - `source` (manual, api, rmm, bundle, import, merge, system, request)
  - `acceptance_state` (not_required, pending, accepted, declined) and `acceptance_request_id`
  - `origin_stock_location_id` for product checkouts
- A2. One engine function checks an item out to a holder and another checks it in. Each validates the item/holder pair for its kind (see A3–A6), writes the ledger, maintains denormalised current-holder columns, writes `asset_history`, and publishes events after commit.
- A3. Asset items have at most one open checkout. Checking out an asset already out is refused unless the caller passes "transfer", which checks in and out atomically.
- A4. Holder rules:
  - user: must be an active MSP user
  - asset: must belong to the item's client, and must not be the item itself or a descendant through asset-holder chains (no cycles)
  - client-owned item (`assets.ownership='client'`, or a client stock location): contact, location and client holders must belong to the item's client
  - MSP-owned item (`assets.ownership='msp'`, or an MSP stock location): contact, location and client holders may belong to any client of the tenant (loaners)
  - contacts must not be shared mailboxes (as today); locations must be active
- A5. Every asset's effective contact is resolved through asset-holder chains: a dock out to a laptop out to Jane resolves to Jane. `assets.contact_name_id` keeps holding the effective contact so portal visibility and existing filters keep working.
- A6. New columns `assets.holder_kind` and `assets.holder_id` carry the direct holder. `assets.location_id` is set when the holder is a location of the item's client. Checking out to a location, user or client clears `contact_name_id` unless the chain resolves to a contact. MSP-owned assets lent to another client's contact do not change `assets.client_id`; portal visibility for the borrowing contact comes from the open checkout (H1).
- A7. `setAssetAssignee` and every existing caller (form, bulk, REST, RMM auto-assign, bundles, merge, import) route through the engine. Bundles check out each member to the bundle owner with source `bundle`, and shared workspaces stay holder-less.
- A8. Backfill:
  - every open and closed `asset_assignments` row becomes a contact checkout
  - every `stock_units` row `on_loan` becomes a checkout to its client (holder kind client), keeping `loan_due_at` as the expected check-in. The item is the unit's asset when it has one, otherwise one unit of its product
  - `asset_assignments` keeps receiving writes until a follow-up removes it
- A9. Checking in an asset sets its status to the chosen status, defaulting to the tenant's first active status of kind "available". It optionally sets the location.

#### FR-B Asset checkout UX

- B1. The detail-page holder row shows the holder (kind icon and link), expected check-in, overdue badge and acceptance badge, with Check out / Check in actions.
- B2. The Check out dialog supports all four holder kinds, expected check-in, note, requires-acceptance and email-holder.
- B3. The Check in dialog captures the note, status and optional return location.
- B4. A Checkouts panel on the asset detail page lists the ledger history for the asset.
- B5. The asset list "Assigned to" column becomes "Held by" (all kinds, effective contact shown for asset holders), with a "Due" column and filters for holder kind, overdue and acceptance state.
- B6. Bulk Check out and bulk Check in on the asset list replace bulk Assign.
- B7. The full asset form and quick-add keep a holder field (all kinds) that checks out through the engine.
- B8. The asset drawer, client Assets tab and contact page show the holder with the same chip.
- B9. Accepting an RMM signed-in-user suggestion checks the asset out to the contact with source `rmm`.

#### FR-C Expected check-in and overdue

- C1. Expected check-in defaults to the tenant's default checkout period when one is set. It can be blank (open-ended).
- C2. Overdue is derived: open, `expected_checkin_at` in the past. It is shown consistently in the UI and API.
- C3. A date-trigger source `asset.checkin_due` (modelled on `asset.maintenance_due`) emits once per checkout at the due date. A lead-time variant emits at the tenant's reminder lead time before it.
- C4. Changing the expected check-in date on an open checkout is allowed and re-arms the trigger.
- C5. Loaners are checkouts. `loanOut`, `loanReturn` and `updateLoanDueDate` (`packages/inventory/src/actions/loanerActions.ts`) call the engine. The loan dialog takes a client and optionally a contact. `stock_units.status='on_loan'` and `loan_due_at` remain as the stock-side mirror the engine maintains, and the Loaners screen and loaners-out report read the ledger.

#### FR-D Acceptance

- D1. A generic acceptance engine with three tables:
  - `acceptance_requests`: subject kind and id, recipient contact or user, agreement text, agreement version and hash, state, expiry
  - `acceptance_links`: token hash, expiry, revocation, use count
  - `acceptance_decisions`: append-only; decision, method (email_link, portal, msp_marked), signer name and email, comment, agreement hash, ip, user agent, decided_at
  The design follows `quote_access_links` / `quote_decisions`.
- D2. A checkout with requires-acceptance creates an acceptance request for the holder (contact or user holders only). It sets `acceptance_state=pending`.
- D3. A public page `/accept/[token]` shows the item(s), the agreement text and the holder's name. The holder accepts with a typed name, or declines with a comment.
- D4. A signed-in portal contact can accept or decline pending checkouts from "My equipment".
- D5. The MSP can mark a checkout accepted on the holder's behalf (method msp_marked, with a note) or resend the request.
- D6. On accept, a receipt PDF (items, agreement text, signer, time, IP) is stored as a document on the asset and the holder. On decline, the checkout stays open with `acceptance_state=declined` and the MSP is notified.
- D7. The agreement text is tenant-configurable and versioned. Each request records the version and hash it was shown.

#### FR-E Notifications and events

- E1. The engine publishes `ASSET_CHECKED_OUT` and `ASSET_CHECKED_IN` with item kind, holder kind and id, expected check-in, source and acceptance state. Asset checkouts also publish `ASSET_ASSIGNED` / `ASSET_UNASSIGNED` with `newOwnerType` = holder kind, so the existing catalogue entries carry real data.
- E2. `CHECKOUT_ACCEPTED` and `CHECKOUT_DECLINED` events are published from acceptance decisions.
- E3. A notification category "Assets" with subtypes "Checkout receipt", "Check-in receipt", "Acceptance request", "Check-in reminder" and "Checkout overdue". Templates are seeded in every supported locale, with tenant overrides through `tenant_email_templates`.
- E4. An event-bus subscriber sends:
  - the receipt or acceptance-request email to contact and user holders, when enabled for the tenant and requested in the dialog
  - the reminder and overdue emails from the `asset.checkin_due` triggers
  - an in-app notification to the checking-out MSP user on decline and overdue
- E5. Location and asset holders receive no email. Their effective contact (A5) receives none either unless the tenant enables "notify effective holder".

#### FR-F Licenses

- F1. A `software_licenses` table:
  - identity: name, client (nullable for MSP-internal), optional `software_catalog` link, manufacturer, vendor
  - seats, product key (stored through the tenant secret provider, masked in UI and API), licensed-to name and email
  - purchase date, purchase cost and currency, order number
  - expiration date and termination date
  - notes, `reassignable` flag, `requires_acceptance` default
- F2. License seats check out through the engine (`item_kind=license`, quantity 1 per seat) to contact, user or asset holders. Checking out beyond the seat count is refused.
- F3. Licenses list and detail screens show seats used/total, expiry and seat holders, with check out / check in actions. A non-reassignable license refuses check-in of a seat (the seat is consumed).
- F4. A license appears on the holder's Equipment section and on any asset holding a seat.
- F5. A date-trigger source `license.expiration` fires at the expiration date and at the reminder lead time.
- F6. REST CRUD for licenses, plus seat checkout and check-in.

#### FR-G Accessories, consumables, components

- G1. Stock locations can belong to a client (`stock_locations.client_id`, location type `client_site`), so a client's spare pool is ordinary inventory stock.
- G2. Product inventory settings gain `asset_role` (none, accessory, consumable, component).
- G3. Accessory checkout: quantity N from a stock location to a contact, user, location or client holder. It decrements on-hand through a stock movement (`issue_out`), opens a checkout with quantity N, and check-in returns stock (`issue_in`). Partial check-in is supported by splitting the checkout.
- G4. Consumable issue: quantity N to a contact, user, location or client holder. It decrements stock through a movement and records a closed checkout (out and in at the same moment) for history. It is never returned.
- G5. Component install: quantity N into an asset holder. It decrements stock and opens a checkout to the asset. Removal checks in and returns stock to a chosen location.
- G6. The client's Assets tab shows its stock pools by role with on-hand and checked-out counts and the actions above. The contact and asset Equipment sections list held accessories and components.
- G7. Product checkouts respect inventory locking and concurrency (reuse the stock-movement locks) and never drive on-hand negative.

#### FR-H Client portal

- H1. A "My equipment" page lists what the signed-in contact holds directly or effectively: assets, license seats and accessories, including MSP-owned loaners checked out to them. It shows due dates and acceptance state. Contact-scope users see only their own (and reports-to subtree) holdings; client-scope users also see items held by the client's locations and by the client itself.
- H2. Pending acceptances appear at the top with Accept / Decline.
- H3. Assets and products can be flagged `requestable`. The service-request form builder gains an "Equipment" field type that offers the requester's client's requestable assets and products (availability shown).
- H4. A service-request answer-mapping destination "Check out to requester" turns an approved request into a checkout with source `request` once fulfilled by the MSP.
- H5. Portal users with client asset scope see the client's checkout ledger (read-only), with commercial fields hidden.

#### FR-I Ledger, reports, API, mobile, import

- I1. An Assets → Checkouts ledger screen with filters (item kind, holder kind, client, open, overdue, closed, acceptance, date range) and CSV export.
- I2. A printable "equipment held" sheet per contact, user and location.
- I3. REST:
  - `POST /api/v1/checkouts` (check out any item)
  - `POST /api/v1/checkouts/{id}/checkin`
  - `PATCH /api/v1/checkouts/{id}` (expected check-in, note)
  - `GET /api/v1/checkouts` (filters as I1)
  - `GET /api/v1/assets/{id}/assignments` keeps working, served from the ledger
  - OpenAPI docs for all of them
- I4. Mobile: the asset detail shows holder, due and acceptance. A Check in action by scan is offered to technicians with asset update permission.
- I5. The CSV asset import gains holder columns (holder email, username or location name) and expected check-in, resolved to holders on import.
- I6. The existing CE asset export includes holder kind, holder name and due date.

#### FR-J Snipe-IT connector

- J1. A `snipeit` connector in `packages/migration-connectors` pulls from the Snipe-IT REST API (base URL plus API token):
  - reference data: companies, locations, users, categories, manufacturers, models, status labels, suppliers
  - hardware with custom fields
  - licenses and seats, accessories, consumables, components
  - open checkouts and checkout history (activity log)
- J2. Mapping:
  - companies → clients (match or create, operator confirms)
  - users → contacts (by email, within the mapped company) or MSP users (for users flagged as MSP staff)
  - locations → client locations
  - models and categories → asset types and manufacturer/model fields
  - status labels → asset statuses by kind
  - suppliers → vendors
- J3. Hardware → assets with serial, tag, purchase fields, warranty, notes and custom fields (into custom asset fields). Open checkouts become engine checkouts with source `import`, keeping checkout dates and expected check-in.
- J4. Licenses, accessories, consumables and components map to FR-F and FR-G records:
  - accessory, consumable and component quantities land in a client stock location per Snipe-IT location
  - seat and accessory holders map through J2
- J5. Historic checkout activity imports as closed ledger rows, so asset history starts complete.
- J6. The connector runs through the existing migration preview/apply flow and is idempotent on re-run (external identifiers recorded).
- J7. The connector ships in two parts so hardware migration does not wait on licenses and stock: part 1 is J1 reference data and hardware, J2, J3 and J5 (needs only the engine); part 2 is J1 licenses, accessories, consumables and components, plus J4 (needs FR-F and FR-G).

### Non-functional Requirements

- Tenant isolation follows the existing pattern: app-layer scoping, tenant in every primary key, Citus distribution on new tables, composite FKs only where Citus allows.
- New migrations are additive and safe for code already on main. Partial unique indexes include the distribution column.
- The engine is the only writer of checkouts and current-holder columns (one function, one set of invariants).

## Data / API / Integrations

- **New tables:** `checkouts`, `acceptance_requests`, `acceptance_links`, `acceptance_decisions`, `software_licenses`, `asset_checkout_settings` (or columns on an existing assets settings table, per the code at implementation time).
- **New columns:**
  - `assets.holder_kind`, `assets.holder_id`, `assets.requestable`
  - `stock_locations.client_id`
  - `product_inventory_settings.asset_role`, `product_inventory_settings.requestable`
  - new `stock_movements` types `issue_out` / `issue_in`
- **Partial unique index:** one open asset checkout per asset, on `(tenant, item_id) WHERE item_kind='asset' AND checked_in_at IS NULL`.
- **Events:** see E1–E2. Register the new events in `eventBusSchema.ts` and `workflowEventCatalog.ts`, with builders in `assetEventBuilders.ts`, and add catalogue rows for the designer.
- **Date triggers:** `asset.checkin_due`, `license.expiration` in `packages/jobs/src/lib/dateTriggers/sources/` and `dateTriggerSourceDefinitions.ts`.
- **Email:** category, subtypes and templates seeded per `20251217211644_add_project_task_assigned_email_templates.cjs`. Sending follows `projectEmailSubscriber.ts` and `sendEventEmail`.
- **Service requests:** new field type in `basicFormBuilder.ts` and a new destination in `mapping/destinations/`.
- **Migration importer:** connector in `packages/migration-connectors` with spec additions in `packages/migration-spec` and appliers in `server/src/lib/migrations/appliers/entityAppliers.ts`.

## Security / Permissions

- **MSP permissions:** checking out and checking in assets requires `asset:update` plus record-level update authorization for the asset (not only readability). License CRUD and seat checkout use a new `license` resource (create, read, update, delete). Product checkout requires the inventory permission that governs stock movements.
- **Holders:** user holders must be MSP users in the tenant. Contact, location and asset holders must belong to the item's client.
- **Acceptance links:**
  - single-purpose and token-hashed at rest, with expiry and revocation
  - the public page shows only the items being accepted and the holder's name
  - decisions record IP and user agent
- **Product keys:** stored through the tenant secret provider, never returned in list endpoints, and revealed only to users with `license:update`.
- **Portal visibility:** portal users see only checkouts allowed by their asset scope.

## Observability

No additions beyond existing event and job logging.

## Rollout / Migration

- The backfill (A8) runs in the migration that creates `checkouts`, so every existing assignment and loan appears in the ledger on deploy.
- Until the asset UI slices land, the existing assignee UI keeps working through the engine (A7). Main stays releasable after each slice.
- Emails default off for existing tenants (no surprise mail to end users). New tenants default receipts on. The acceptance default is off.
- Feature flag `asset-checkout` (off by default) gates the changed MSP assignment surfaces (holder row, Check out / Check in dialogs, list columns and bulk actions, Checkouts panel, ledger screen), the client-portal My equipment page and acceptance, and the Equipment service-request field. Dark slices (schema, engine, backfill, events, triggers, API) need no flag. Licenses and stock pools are new screens that change nothing existing and ship `complete`. Holder emails are additionally off per tenant by default.
- Enable the flag for the requesting tenant first as a beta.

## Decisions (settled 2026-11-09)

1. Loaners become ordinary checkouts (C5). Existing client-level loans backfill to a new holder kind `client`, which is also a real case on its own (equipment lent to a company rather than a person).
2. `assets.client_id` stays required. MSP-owned items use the tenant's own client record (`tenant_companies.is_default`) with `ownership='msp'`. Holder rules depend on ownership (A4), so MSP-owned loaners can go to any client's contact, location or the client.
3. Location-held assets are visible in the portal to client-scope users only. Showing them to contacts at that location is a follow-up once contact locations land (`ee/plans/2026-10-28-contact-locations`): one rule in `applyAssetVisibilityFilter`.
4. The Snipe-IT connector stays in this plan as two slices (J7). Part 1 (hardware and checkouts) lands as soon as the engine is on main.
5. One feature flag, `asset-checkout`, off by default, scoped as in Rollout / Migration.

## Open Questions

None outstanding.

## Acceptance Criteria (Definition of Done)

- A technician can check an asset out to a contact, MSP user, client location or another asset, with expected check-in and acceptance. They can check it in with a note and status. The asset's history, holder row, list and contact page all reflect it.
- Overdue checkouts appear in the ledger and asset list, fire `asset.checkin_due`, and send the holder a reminder when enabled.
- A holder can accept a checkout from an emailed link or the portal. The decision is recorded with signer, time, IP, user agent and agreement hash, and a receipt PDF is stored.
- License seats, accessories, consumables and components can be checked out, issued or installed with correct counts and stock movements.
- A portal contact sees their equipment and can request a requestable asset through a service request.
- `ASSET_CHECKED_OUT` / `ASSET_CHECKED_IN` / `ASSET_ASSIGNED` fire for every checkout path, including the Identity tile and bulk actions.
- A Snipe-IT instance can be imported through the migration importer with assets, holders, open checkouts, licenses and stock. A re-run creates no duplicates.
