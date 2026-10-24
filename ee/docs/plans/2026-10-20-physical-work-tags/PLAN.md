# Physical work tags, equipment custody, and project logistics — basic plan

This is the starting plan for PSA ticket alga-2026-0002683. Read `ANALYSIS.md` first: it maps what exists, with file references, so no card needs to redo the audit. Each card turns its slice of this plan into a full PRD, feature list and test list during its own design session (alga-plan, in its own plan folder). Where a card's design session settles something differently from this plan, the card wins.

## How cards get this material

The branch `feature/physical-work-tags` is pushed to origin and holds only this folder. A card copies it into its own worktree with:

```bash
git fetch origin feature/physical-work-tags
git checkout origin/feature/physical-work-tags -- ee/docs/plans/2026-10-20-physical-work-tags/
```

## Work breakdown and stacking

Each card is one PR. Cards stack in "after" mode, so a child starts implementing only once its parent has merged.

```text
C1 Label rendering foundation + record link resolver
├── C2 Print work tags: tickets and assets (single + batch)
│   ├── C4 Equipment custody and intake
│   │   └── C5 Warranty review and RMA for client-owned equipment
│   └── C6 Project staging, boxes, and manifests   (also needs B1 merged)
└── C3 Scan to open: mobile scanner, app links, unit/RMA detail routes

B1 Bug: materials consume stock reserved for sales orders   (independent)
B2 Bug: inventory scan lookup skips asset permission         (independent)
```

Not carded here: vendor-only conversation audiences on tickets. The XO card "Ticket conversations: vendor email threads, AI participation, sharing and synthesis" (branch `feature/ticket-conversations-vendor-email-threads-ai-par`, PR in CI as of 2026-10-20) already covers it. C5 should use that conversation model for vendor correspondence once it merges, and record the vendor case as an external link and on the RMA either way.

### C1 — Label rendering foundation and record link resolver

Goal: make it possible to render any record as a small-format label PDF with a scannable code. This card ships no end-user feature on its own.

- **Shared record link resolver.** One function maps `(entityType, id)` to a canonical app path and absolute URL, for ticket, asset, project, project task, stock unit and RMA. Then replace the copies in:
  - search indexers
  - `notificationLinkResolver.ts`
  - `buildTeamsFullPsaUrl.ts`
  - mobile `hostedUrls.ts`, where the package boundary allows it
- **Custom page sizes.** Print settings accept explicit width/height (in or mm) as well as the Letter/A4/Legal presets. `resolve*PdfPrintOptions` emits `width`/`height` and sets `preferCSSPageSize`. The designer can set and preview custom sizes.
- **`barcode` template AST node.** It takes `symbology: qr | code128` and a value expression, and renders server-side to inline SVG: QR through `qrcode`, Code 128 through a new dependency such as bwip-js. It needs a quiet zone and a minimum module size so it stays scannable at 2 inches.
- **Label document types.** Add them to the document-template registry, either one generic label type with per-entity bindings or one type per label class (decide in design). Each gets a standard AST, bindings, sample data and designer support (`DesignerDocumentKind`).
- **Batch rendering.** One PDF from N records, in two layouts:
  - one label per page, for thermal and roll printers
  - n-up on Letter/A4 with a configurable grid (Avery-style sheets)

  Record order is preserved.
- **Location.** The service lives where both tickets/assets and inventory can call it without importing billing, or behind a server route the same way as the sales-order document route.

### C2 — Print work tags: tickets and assets (stacks on C1)

Goal: the customer's first ask, "open the ticket, click Print work tag, get a label".

- **Ticket detail:** a `Print work tag` action. Temporary work tag fields:
  - MSP name/logo
  - client (can be hidden by a template setting)
  - short item description
  - ticket number
  - work reason
  - optional linked asset tag and the last digits of the serial number
  - QR code linking to the ticket
- **Asset detail:** a `Print asset label` action. Permanent identity label fields: asset tag, name, client, QR code linking to the asset, optional Code 128 of the asset tag.
- **Batch printing:** from the ticket list and asset list selections, one label per record.
- **Defaults exclude sensitive data:** no comments, credentials or full serial numbers. Tenant templates control which fields appear.
- **Side effects:** none. A print may write a document/provenance row if the design calls for print history, but it never touches stock, billing, asset state or time.
- **Permissions:** the existing `ticket:read` and `asset:read` plus record-level checks. Batch printing skips records the user can't read and says so.

### C3 — Scan to open (stacks on C1)

Goal: scanning any Alga label lands on the live record, with permissions applied.

- **Mobile scanner** (`ScanView.tsx`): when the code is a URL on the connected server's host (or a known Alga host) and matches a resolver path, route in-app to TicketDetail, AssetDetail, StockUnitDetail and so on. Otherwise keep today's code lookup.
- **Mobile deep links** (`linking.ts`): add asset and stock-unit paths. The server's app-link files (`mobileAppLinks.ts`) claim the same paths.
- **Web detail views** for records that have none: honour `?unitId=` on Inventory › Units (or add `/msp/inventory/units/[id]`) and add an RMA detail view. These are what stock-unit and RMA labels link to.
- **Stock-unit label** (permanent identity: product, serial number, QR code) from the unit view.
- **Not-allowed scans** show "not found or no access" and leak no record content. This must hold for cross-tenant scans too.

### C4 — Equipment custody and intake (stacks on C2)

Goal: know where every piece of equipment held at the MSP is, who has it and who owes the next action, without treating client property as stock.

- **Ownership on assets:** client-owned or MSP-owned (decide the field and its default in design).
- **Custody record for an asset held by the MSP:**
  - holder (user)
  - MSP-side location: a stock location plus a free-text bin/shelf
  - purpose: repair, warranty evaluation, loaner prep or staging
  - next-action party: us, client or vendor
  - follow-up date
  - condition and accessories, with optional photos as documents
- **Custody events** in an append-only history: received, moved, handed off, shipped, returned. Each records actor, time and from/to location. Asset history gets a summary entry.
- **`Receive equipment` from a ticket:** link an existing client asset, or create a lightweight client asset in a held status. Never create a `stock_units` row, stock movement, cost or invoice line.
- **Held-equipment queue:** a filterable list of items in the office, waiting on a vendor, waiting on client pickup, or overdue for follow-up. It is independent of ticket status.
- **Work tags** (from C2) show the custody location and next action when present.

### C5 — Warranty review and RMA for client-owned equipment (stacks on C4)

Goal: the Dell case end to end, from "Dell is deciding" to shipping and replacement.

- **`rma_cases` changes:**
  - Accept `asset_id` with no `returned_unit_id`.
  - Add `ticket_id`.
  - Add a pre-authorization `warranty_review` status, with transitions to the standard or advance track on approval and to closed on denial.
- **Shipping:** outbound and inbound tracking numbers and carrier, plus a return-by date.
- **Vendor case:** stored in `rma_reference` and mirrored as a ticket external link through a custom external system. The ticket shows its RMA, and the RMA shows its ticket.
- **RMA tag and return slip** printed from the RMA, using C1's label types.
- **Inventory invariants hold:**
  - A client-owned device on an RMA never enters sellable on-hand stock.
  - A replacement that comes back for the client goes back to the client asset, not into stock.
  - The existing stock-unit RMA paths are unchanged.

### C6 — Project staging, boxes, and manifests (stacks on C2; B1 must be merged first)

Goal: stage hardware for an installation, label it, and know what is in each box.

- **Reserve stock for project materials before consuming it:** reserve → stage → consume. Copy the sales-order allocation model: `reserved_quantity` for non-serialized stock, `allocated` status for serialized units. Consumption follows the existing rules once the material is marked installed.
- **Client-provided items** can join a project's staging as held client assets, linked to C4 custody when C4 has merged. Otherwise they are tracked as plain staging lines.
- **Staging containers:** a box/tote record on a project or task, with members (serialized units, quantities, client assets), an "n of m" label, and a manifest PDF.
- **Bulk-print labels** for a project's staged equipment.
- **Later, not in this card:** dispatch and on-site receipt scans as auditable events.

### B1 — Bug: materials consume stock reserved for sales orders (independent)

- **Problem:** `packages/inventory/src/lib/consume.ts:141` checks only `quantity_on_hand` and ignores `reserved_quantity` / `held_quantity`.
- **Fix:**
  - Start with a failing integration test: a sales order allocates stock, then a ticket material takes it.
  - Hard holds must never be consumed.
  - Soft reservations need an explicit override, or the add is refused. Follow the inventory PRDs.
  - Check every other consumption path.
- **Done:** a clear error in the material dialog, and a PR.

### B2 — Bug: inventory scan lookup skips asset permission (independent)

- **Problem:** `InventoryService.lookup()` returns asset rows when the caller has only `inventory` read.
- **Fix:**
  - Start with a failing API test.
  - Filter asset matches by `asset:read` plus the asset record-level check, and drop the asset results when the permission is missing.
  - Product and unit results don't change.
  - The mobile result card copes with the asset-less response.
- **Done:** a PR.

## Open product questions (settle in the named card's design session)

1. **C4:** Is custody a property of assets (the recommendation), or a separate handling record that can exist with no asset? It turns on how often items with no asset arrive (cables, PSUs, walk-in hardware) and whether creating a held client asset for them pollutes the client's asset list.
2. **C4:** Is MSP-side location a stock location plus a free-text bin, or do stock locations get a bin hierarchy? Bins would also serve inventory.
3. **C1:** One generic label document type, or one per label class? This affects how tenants manage templates.
4. **C2:** Is printing a work tag recorded? Options: a stored document with provenance, an asset/ticket history entry, or nothing.
5. **C1:** Which barcode library? It must be server-safe, have no native build step, and support Citus/edge constraints (bwip-js is the default candidate).
6. **C6:** Do project reservations reuse `stock_levels.reserved_quantity` shared with sales orders, or get a separate project counter?
7. **C1–C3:** Edition: CE, EE or both? Mobile is EE (`ee/mobile`); label printing on the web is presumably CE.
