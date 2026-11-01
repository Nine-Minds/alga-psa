# Design: `InvoiceService.create` is a draft-only creation command

Card: `910b6946-1cf6-5130-b406-2ff3f5a19999` — Security: authz in `InvoiceService.create`
Branch: `feature/security-authz-in-invoiceservice-create`
Finding: **authz · high** — "Invoice creation can bypass lifecycle and credit permissions"
(`server/src/lib/api/services/InvoiceService.ts:683`, fingerprint `...#InvoiceService.create`)

## What the finding actually is

`POST /api/v1/invoices` requires only `invoice:create`
(`server/src/lib/api/controllers/ApiBaseController.ts:131` →
`ApiInvoiceController` `resource: 'invoice'`), then hands the request body to
`InvoiceService.create` (`ApiBaseController.ts:339-346`).

`create` persists caller-controlled `status`, `subtotal`, `tax`, `total_amount`,
`credit_applied`, `is_manual`, `is_prepayment` and `billing_cycle_id`
(`InvoiceService.ts:683-703`). `createInvoiceSchema` accepts all of them
(`schemas/invoiceSchemas.ts:163-202`).

So a caller holding `invoice:create` but **not** `invoice:finalize`, `invoice:send`
or the credit command can:

1. create an invoice already in a non-draft state (`sent`, `paid`, …) — and because
   `finalizeInvoice` refuses anything that is not `draft`
   (`InvoiceService.ts:1193-1195`), that invoice **never** passes the finalize
   engine's line-item, tax-source, export-readiness or hour-block guards; and
2. set `credit_applied` to any value without an allocation, i.e. spend tenant credit
   through the create surface.

The merged PR #3985 narrowed only the **update** surface (the `INVOICE_UPDATE_FIELDS`
/ `LIFECYCLE_OWNED_FIELDS` allowlist at `InvoiceService.ts:755-772`). Creation was
left trusting the caller. Creation is the same class of command and needs the same
treatment.

## Shape of the fix

**One principle: a created invoice is a draft. Lifecycle, money and identity are
owned by commands, not by the create body.** Nothing in the API may produce an
invoice in a state the lifecycle engine did not put it in.

Three parts, in order.

### 1. One field classifier, two surfaces (`invoiceFieldPolicy.ts`)

`schemas/invoiceUpdateFields.ts` already classifies every invoice column once
(`INVOICE_UPDATE_FIELDS` / `LIFECYCLE_OWNED_FIELDS`) and its unit test fails when a
create-schema key is unclassified. That mechanism is right; it is just scoped to one
surface.

Promote it to a surface matrix and keep the existing module as a re-export so no
import or test churns:

```ts
// server/src/lib/api/schemas/invoiceFieldPolicy.ts
export type InvoiceSurface = 'create' | 'update';
export type FieldDisposition =
  | { kind: 'writable' }                       // accepted from the body
  | { kind: 'command-owned'; command: string } // only the named command may set it
  | { kind: 'immutable'; reason: string }
  | { kind: 'engine-derived'; derive: string }; // server computes it, body value ignored

export const INVOICE_FIELD_POLICY: Record<keyof CreateInvoice, FieldDisposition> = { … };
export function checkInvoicePayload(surface, data): { forbidden: Array<{key, disposition}> };
```

Create-surface decisions:

| field | disposition on create | why |
| --- | --- | --- |
| `status` | `command-owned: 'finalize'` — only `draft` (or absent) accepted | non-draft creation skips the finalize engine entirely |
| `credit_applied` | `command-owned: 'applyCredit'` — must be absent or `0` | credit is an allocation, not a column |
| `subtotal`, `tax`, `total_amount` | `engine-derived` — body value ignored | totals are a function of the charges |
| `is_manual`, `is_prepayment` | `immutable` (set from the request's own intent flags, not free-form? see below) | provenance, not money |
| `billing_cycle_id` | `command-owned: 'invoiceGeneration'` | recurring provenance |
| `tenant` | `immutable` | forced from `context.tenant` |
| `invoice_id`, `invoice_number`, `finalized_at` | already omitted from `createInvoiceSchema` | identity/numbering service |
| `client_id`, `invoice_date`, `due_date`, `payment_method`, `billing_profile_id`, `billing_period_*`, `recurring_*`, `items` | `writable` | legitimate draft inputs |

`is_manual` / `is_prepayment` stay writable: they describe *how the invoice came to
exist* and are only honoured for a draft, so they cannot move money.

The update surface keeps its current matrix (writable terms; everything else
command-owned), which makes the existing update tests the regression suite for the
shared classifier.

### 2. `InvoiceService.create` enforces the policy itself

Not in the controller, and not by trusting `validatePermissions` — that method is a
stub (`InvoiceService.ts:2610-2617`, "TODO: Implement proper permission checking").
The service is the boundary every future caller inherits, including the duplicate
endpoint (`ApiInvoiceController.ts:979`), so:

```ts
async create(data, context) {
  await this.validatePermissions(context, 'invoice', 'create');
  const { forbidden } = checkInvoicePayload('create', data);
  if (forbidden.length) {
    throw new ValidationError(
      `Field '${forbidden[0].key}' is not settable when creating an invoice; use the dedicated invoice command`,
      forbidden.map(f => ({ path: [f.key], message: … })),
    );   // 400, same shape/voice as the update path (InvoiceService.ts:760-772)
  }
  …
}
```

Callers that legitimately need a non-draft invoice already go through the lifecycle:
`finalizeInvoice` (→ `finalizeInvoiceWithKnex`), `sendInvoice`, the payment and credit
commands. The duplicate endpoint already sends `status: 'draft'`, `credit_applied: 0`
(`ApiInvoiceController.ts:966-976`) and therefore keeps working unchanged — that is
the compatibility proof, and it becomes a test.

### 3. Totals come from the charges, in one place

For `items`-bearing creates, the header totals are derived server-side by reusing the
billing engine rather than re-implementing arithmetic in `create`: the same
`calculateAndDistributeTax` already called at `InvoiceService.ts:646-660`, plus the
line-item persistence path (`createInvoiceLineItems`). With no items, `subtotal`,
`tax` and `total_amount` are `0`.

If the derivation currently lives inside `finalizeInvoiceWithKnex`
(`packages/billing/src/actions/invoiceModification.ts:1115`), extract it to a named
helper and call it from both surfaces — **do not** write a second totals function.
`// LEVERAGE: pattern totals-derivation` if the extraction has to wait, but the
default is to do it: one function, two callers.

## Order of work

1. `invoiceFieldPolicy.ts` + re-export from `invoiceUpdateFields.ts`; port the
   existing classification test to the matrix (fails today for the create surface —
   that is the red test).
2. `checkInvoicePayload('create', …)` at the top of `create`, before any DB work.
3. Totals derivation for `items`-bearing creates; drop the caller-supplied header
   totals.
4. Tests (below), then the full invoice suite.

## Tests

Unit (`server/src/test/unit/api/`):
- `invoiceFieldPolicy.test.ts` — every `createInvoiceSchema` key is classified exactly
  once; every `baseInvoiceSchema` key likewise (extend the existing completeness test).
- `invoiceService.createPolicy.test.ts` — `status: 'sent'` → 400 naming `status`;
  `credit_applied: 25` → 400 naming `credit_applied`; `status: 'draft'`,
  `credit_applied: 0`, no status → accepted; caller-supplied `total_amount` is not
  what lands in the row.

Integration (`server/src/test/integration/api/`):
- `POST /api/v1/invoices` with `status: 'sent'` → 400 (API-level, not just service).
- create with items → totals equal the engine's derivation, not the posted values.
- duplicate endpoint still returns 201 with a draft (regression proof).
- existing `invoiceService.*` integration tests keep passing — they create drafts or
  insert rows directly, which the policy does not touch.

## Not doing (and why)

- **Not** adding per-command permissions to create (`invoice:finalize` etc. as an
  escape hatch). A caller that wants a finalized invoice calls finalize; letting the
  create body buy the state would re-create the bypass with extra steps.
- **Not** changing the update allowlist. It is already correct and is the vocabulary
  this design reuses.
- **Not** touching `billing_cycle_id` provenance for the billing engine (it inserts
  directly, never through this method) — the create-surface gate only rejects it on
  the API path.
- **Not** fixing `validatePermissions`'s stub. The real check is `hasPermission` in
  `ApiBaseController`; replacing the stub is a separate, wider card and this fix does
  not depend on it.

## Risks

- **Totals parity.** If derivation differs from finalize's math, a draft would show
  different numbers after finalize. Mitigation: single shared helper (part 3), and the
  integration test compares draft totals with the finalize recomputation.
- **API clients posting non-draft invoices.** That is exactly the behavior being
  removed; a 400 naming the field and the owning command is the contract. If a
  concrete client needs bulk "import as sent", the right answer is a lifecycle import
  command, not a create field.
- **Duplicate path drift.** Guarded by its own test.

## Evidence anchors

- `server/src/lib/api/controllers/ApiBaseController.ts:131,339-346`
- `server/src/lib/api/services/InvoiceService.ts:646-660,677-703,755-772,1180-1222,2610-2617`
- `server/src/lib/api/schemas/invoiceSchemas.ts:163-202`
- `server/src/lib/api/schemas/invoiceUpdateFields.ts`
- `server/src/lib/api/controllers/ApiInvoiceController.ts:966-979`
- `packages/billing/src/actions/invoiceModification.ts:1115`
