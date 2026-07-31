# QBO simulator for sync-engine tests

`qboSimulator.ts` is a stateful, in-memory QuickBooks Online. It implements
the public surface of `QboClientService` (`create`, `read`, `update`, `query`,
`fetchChanges`, `getPreferences`, `voidInvoice`, `deleteCreditMemo`,
`findCustomerByDisplayName`, `createOrUpdateCustomer`) with real QBO
semantics, so a test can drive the actual sync code through a multi-step
sequence — export, edit, CDC poll, apply — and assert both sides: what Alga
recorded *and* what QBO now contains.

## When to use it

Use the simulator whenever a test spans more than one QBO interaction or
depends on QBO state changing between steps:

- anything involving SyncTokens, balances, CDC ordering, or idempotent replay
- race conditions (QBO consumed a credit first; a document changed under us)
- shape-fidelity checks (does the payload our applier receives from real CDC
  actually look like what our canned mocks claim?)

Keep using plain `vi.fn()` mocks for single-call unit tests where the QBO
response is incidental — the simulator adds nothing there.

## Wiring

The appliers and adapter reach QBO through
`@alga-psa/integrations/lib/qbo/qboClientService`. Point that seam at a
simulator instance:

```ts
const simRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn(async () => simRef.current.client) },
  getDefaultQboRealmId: vi.fn(async () => 'realm-sim')
}));

// in each test:
const sim = new QboSimulator();
simRef.current = sim;
```

## The scenario pattern

```ts
// 1. Seed QBO state
const customer = sim.seedCustomer({ name: 'Acme Corp' });
const invoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

// 2. Take a CDC cursor, then act "inside QBO"
const cursor = sim.now();
sim.receivePaymentInQbo({ invoiceId: invoice.Id, amountCents: 15000 });

// 3. Poll changes the way the cycle service does, run the real applier
const changeSet = await sim.client.fetchChanges(cursor);
for (const change of changeSet.changes.filter((c) => c.entityType === 'Payment')) {
  await applyExternalPaymentChange(deps, change as any);
}

// 4. Assert both sides
expect(recordExternalPayment).toHaveBeenCalledWith(/* Alga side */);
expect((await sim.client.read('Invoice', invoice.Id))!.Balance).toBe(0); // QBO side
```

Seeding helpers: `seedCustomer` (supports `active: false`), `seedInvoice`,
`seedCreditMemo`, `applyCreditInQbo` (a bookkeeper applying credit),
`receivePaymentInQbo` (a check arriving). Inspect state with
`sim.entities('Payment')` or `sim.client.read(...)`.

## What it models

| Behavior | Detail |
| --- | --- |
| Ids & SyncTokens | Tokens start at `"0"`, increment on every mutation; stale-token updates throw error code `5010` |
| Customer names | Uniqueness enforced across active **and inactive** customers (`6240`); name queries return **active only**, like QBO's default query filter |
| Document totals | Computed from `Line` amounts — the caller's `TotalAmt` is ignored, like QBO. `taxAdjustmentCents` option models Automated Sales Tax changing the total at create time |
| Payments | `Line[].LinkedTxn` allocations reduce Invoice/CreditMemo balances; over-application throws `6210`; balance movement bumps the target's token and journals a CDC change |
| Credit application | A zero-dollar Payment linking CreditMemo → Invoice, same shape the real integration pushes and receives |
| Auto-apply credits | `new QboSimulator({ autoApplyCredits: true })` consumes open customer credit the moment an invoice is created — QBO's `SalesFormsPrefs.AutoApplyCredit` race |
| Voids | `voidInvoice` zeroes amounts and stamps a `Voided` private note — the exact shape the drift detector's heuristic matches |
| CDC | Every mutation journals against a deterministic logical clock; `fetchChanges(since)` replays latest entity state with `deleted` flags. Use `sim.now()` as the cursor between phases |
| Preferences | `getPreferences()` reports `AutoApplyCredit` from the option |

## What it refuses to fake

Unsupported entity types and unmodeled SQL queries throw
`SIM_UNSUPPORTED` instead of returning something plausible. If the
integration starts issuing a new query shape, model it in `runQuery`
deliberately — with the semantics real QBO has, not the semantics that make
the test pass.

## Examples

- `qboSimulator.test.ts` — pins the simulator's own QBO semantics
- `qboSimulator.scenarios.test.ts` — real appliers driven end-to-end:
  credit-application push + idempotent replay, the auto-apply race, a legacy
  credit applied by the bookkeeper arriving through CDC, the
  inactive-customer duplicate-name failure, a QBO-side void tripping drift
- `../customerContracts.qboCredits.test.ts` and
  `../customerContracts.qboExportSafety.test.ts` — customer-communicated
  behavior these flows must preserve
