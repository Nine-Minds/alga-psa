# Invoicing Demo (Manual Invoices)

This sample extension demonstrates creating a **draft manual invoice** using the Invoicing Host API:

- Capability: `cap:invoice.manual.create`
- Host API: `host.invoicing.createManualInvoice(...)`

## What it includes

- A simple iframe UI (`ui/index.html`) with a form for `clientId`, one line item, and optional header fields.
- A WASM handler (`src/handler.ts`) that exposes:
  - `GET /api/status`
  - `POST /api/create-manual-invoice`

## Running locally

From this directory:

- `npm test`
- `npm run build`
- `npm run pack`

Then publish the resulting bundle using the normal extension publish flow.

