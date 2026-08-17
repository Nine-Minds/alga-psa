# Credit Draw-Down Policy Controls — Bounded Review Guide (task 29.8.17)

Reviewer orientation for the `release-v1.5` credit draw-down policy card. This
is a re-verification round (verifier-timeout mitigation), not a design review:
the feature is implemented, smoke-tested, and re-verified with no fixes
required. Read this, then the two engine functions, then the test files — the
rest of the diff is mechanical wiring.

## Diffstat

`git diff main..HEAD --stat` — 73 files, +5192 / −74. The bulk is test files and
translation locales; the substantive code is a small number of files listed
below.

## Touched areas

### Migration layer (`server/migrations/`)
Three migrations, coherent and idempotent (each guards on `hasColumn`):

- `20260814120000_credit_drawdown_policy_controls.cjs` — adds three policy
  columns to `default_billing_settings` (NOT NULL, behavior-preserving defaults:
  `credit_auto_apply_enabled` true, `credit_application_order`
  `'expiration_first'`, `credit_eligible_service_type_ids` NULL) and the same
  three nullable columns to `client_billing_settings` (NULL = inherit tenant).
  Adds `credit_drawdown_opt_out` (nullable) to `client_contracts`.
- `20260815120000_add_invoice_credit_permission.cjs` — seeds the `invoice:credit`
  permission and grants it to Admin and Finance MSP roles (the REST apply-credit
  endpoint gated on a permission no tenant ever had, so it 403'd for everyone).
- `20260816120000_credit_service_type_restriction_mode.cjs` — Option B mode
  discriminator (see decisions below). Adds
  `credit_service_type_restriction_mode` to both policy tables, normalizes the
  previously-legal empty-array "nothing eligible" state, and installs CHECK
  constraints coupling mode to ids.

### `resolveCreditDrawdownPolicy` — `shared/billingClients/billingSettings.ts`
The single source of truth for a client's effective policy. Per-field
first-non-null cascade: `client_billing_settings` → `default_billing_settings` →
hardcoded defaults (auto-apply on, expiration-first, unrestricted). Service-type
restriction resolves **mode-first**: a non-null client mode wins and pairs with
the client's own ids; a null client mode inherits the tenant's mode+ids. The
null-semantics contract (`undefined` = leave unchanged, `null` = revert to
default) is implemented in `updateClientBillingSettings` and the
`billingSettingsActions.ts` write path.

### `applyCreditToInvoiceInternal` — `packages/billing/src/actions/creditActions.ts`
The canonical apply engine (auto-apply and manual/REST both delegate here). Key
facts to verify:

- **Clamp ordering**: the eligible-amount clamp (via
  `computeEligibleCreditAmount`, lines ~975-989) runs *after* the
  same-currency/cross-currency validation, so an invoice with no eligible
  charges still surfaces the explicit currency-mismatch error instead of
  silently no-op'ing. The clamp is on the *remaining* eligible headroom
  (`eligibleAmount - alreadyAppliedCredit`) so repeated applications can't
  cumulatively exceed the eligible subtotal.
- **The three orderings** have exact ORDER BY clauses (~line 880):
  `expiration_first` = `expiration_date asc nulls last, created_at asc`;
  `oldest_first` = `created_at asc, expiration_date asc nulls last`;
  `newest_first` = `created_at desc, expiration_date asc nulls last`.
- **Opt-out** is a charge-level filter in `computeEligibleCreditAmount`: charges
  on `credit_drawdown_opt_out = true` contracts are excluded; service-type
  restriction also excludes charges with no `service_id` (conservatively
  ineligible). Auto-apply toggle is enforced only in the finalize path
  (`invoiceModification.ts`), not here.
- The Turbopack regression is *not* present: `creditActions.ts` has no
  `export type { ... }` re-export of type-only imports (line 33 is a normal
  `export type CreditActionError = ...` alias; the `resolveCreditDrawdownPolicy`
  re-export at line 463 is a value re-export).

### Four UI surfaces (all gated behind `release-v1.5-feature`)
1. `CreditDrawdownSettings.tsx` (new) — tenant defaults on the Billing Settings
   page, mounted from `BillingSettings.tsx`.
2. `ClientCreditDrawdownSettings.tsx` (new) — per-client overrides, mounted from
   `clients/…/BillingConfiguration.tsx`.
3. `billing-dashboard/contracts/ContractDetail.tsx` — per-contract
   `credit_drawdown_opt_out` toggle.
4. `billing-dashboard/CreditApplicationUI.tsx` — order note on the manual
   credit-apply dialog.

Flag off ⇒ no new UI and no behavior change (covered by
`BillingSettings.featureFlag.test.tsx`).

### Translations
11 locales (`en/fr/es/de/nl/it/pl/xx/yy/…`) × `billing-settings.json`,
`clients.json`, `contracts.json`, `credits.json` — the draw-down keys.

### Permission seeding
`invoice:credit` in `server/seeds/dev/47_permissions.cjs`,
`48_role_permissions.cjs`, and `ee/server/seeds/onboarding/*`.

## Captain decisions constraining the design

- **Mode discriminator (decision `c368e03f`)**: explicit
  `credit_service_type_restriction_mode`. Tenant `all|restricted` NOT NULL;
  client NULL=inherit / `all` / `restricted` with non-empty ids. The empty-array
  sentinel is forbidden (removed by the Option B migration before the CHECK).
- **Null semantics**: `undefined` = leave unchanged; `null` = revert to default.
- **Keep-row / null-three-columns lifecycle**: client revert ("Use Default
  Settings") nulls only the three draw-down columns, preserving unrelated
  overrides; a non-null mode writes a consistent mode+ids pair.

## Verification suite (8 files / 40 tests)

Run from `server/` with the two secrets exported (see work order):

```
server/src/test/infrastructure/billing/credits/creditServiceTypeRestrictionMode.test.ts        (6)
server/src/test/infrastructure/billing/credits/creditServiceTypeRestrictionModeMigration.test.ts (7)
server/src/test/infrastructure/billing/credits/creditDrawdownPolicy.test.ts                     (9)
server/src/test/infrastructure/billing/credits/creditDrawdownUseDefaultSettings.test.ts         (1)
server/src/test/infrastructure/billing/credits/creditDrawdownGoCustomSeeding.test.ts            (1)
server/src/test/infrastructure/billing/credits/creditDrawdownPolicyModuleLoad.test.ts           (3)
server/src/test/infrastructure/billing/credits/creditApplication.test.ts                       (11)
server/src/test/infrastructure/billing/credits/invoiceCreditPermissionMigration.test.ts         (2)
```

Additional regression coverage in the diff (not in the 8-file suite):
`creditActions.applyCredit.postDrop.test.ts`,
`invoiceCreditPermissionSeed.test.ts`,
`BillingSettings.featureFlag.test.tsx`.

## What to look at first

1. `resolveCreditDrawdownPolicy` mode-first cascade (above).
2. `applyCreditToInvoiceInternal` clamp placement and the three ORDER BY clauses.
3. The three migrations' CHECK constraints and empty-array normalization.
