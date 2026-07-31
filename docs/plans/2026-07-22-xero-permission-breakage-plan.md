# Plan: Replace retired Xero `accounting.transactions` scope with granular scopes

**Date:** 2026-07-22
**Branch:** `fix/xero-permission-breakage`

## Problem

The Xero integration's OAuth authorization request includes the retired
`accounting.transactions` scope. Xero apps created after 2026-03-02 reject that
scope with `invalid_scope` before organization selection, so new integrations
cannot connect. Existing apps hit the same wall at Xero's legacy-scope cutoff in
September 2027.

## Approach

Single-constant change. `DEFAULT_XERO_SCOPES` in
`packages/integrations/src/lib/xero/xeroClientService.ts` is the one source of
truth for the integration's requested scopes; every authorization request
(server actions `xeroActions.ts:159,361`, connect route
`routes/api/integrations/xero/connect.ts:107`) and the settings UI scope display
derive from it via `getXeroOAuthScopes()` / `getXeroOAuthScopesString()`. The
`XERO_OAUTH_SCOPES` env override takes precedence verbatim and stays untouched.

Alternatives rejected:

- **Per-tenant/app scope configuration** — over-engineering; the env override
  already covers outliers (YAGNI).
- **Compatibility shim requesting old + new scopes** — harmful; new Xero apps
  reject the whole request with `invalid_scope` when the retired scope is
  present.

## Change

`packages/integrations/src/lib/xero/xeroClientService.ts:19-24` — replace
`'accounting.transactions'` in `DEFAULT_XERO_SCOPES` with the granular
replacements:

```ts
const DEFAULT_XERO_SCOPES = [
  'offline_access',
  'accounting.settings',
  'accounting.invoices',
  'accounting.banktransactions',
  'accounting.payments',
  'accounting.contacts'
];
```

Retained: `offline_access`, `accounting.settings`, `accounting.contacts`.
Added: `accounting.invoices`, `accounting.banktransactions`,
`accounting.payments`.

Scope-to-endpoint rationale: the integration currently calls `/Invoices`,
`/Contacts`, `/Accounts`, `/Items`, `/TaxRates`, `/TrackingCategories`
(covered by `accounting.invoices` + `accounting.settings` +
`accounting.contacts`); `accounting.banktransactions` and
`accounting.payments` are forward-cover for the integration's banking and
payment operations, included now so future support doesn't force re-auth.

No other production code changes: the callback
(`routes/api/integrations/xero/callback.ts:184-223`) stores whatever scope Xero
grants back and performs no validation against the requested set.

## Test updates (assertions only)

1. **`packages/integrations/src/actions/integrations/xeroActions.test.ts`**
   - Update the two expected-scope arrays (lines ~23-26, ~106-109) to the new
     default set.
   - Replace the `expect(result.scopes).toContain('accounting.transactions')`
     assertion (line ~145) with expectations that the granular scopes are
     present, and add a guard:
     `expect(result.scopes).not.toContain('accounting.transactions')`.
2. **`packages/integrations/src/components/settings/integrations/XeroIntegrationSettings.contract.test.tsx`**
   - Update the mocked scope arrays (lines ~41-44, ~121-124, ~151, ~197, ~238)
     and the `getByText('accounting.transactions')` display assertions
     (line ~69) to match the new default set.
3. **`server/src/test/unit/api/xeroOAuthRoutes.test.ts`**
   - Update the exact auth-URL scope-string assertions (lines ~105, ~114) to the
     new space-joined string:
     `offline_access accounting.settings accounting.invoices accounting.banktransactions accounting.payments accounting.contacts`.

## Explicitly out of scope

- **Existing connections/tokens.** Tokens granted with the retired scope remain
  valid until Xero's September 2027 legacy cutoff. No migration, re-auth nudge,
  or banner. (Confirmed with user.)
- **Legacy fixture sweep.** `server/src/test/unit/accounting/xeroClientService.spec.ts`
  and `server/src/test/unit/xeroOauthCallbackCsrf.test.ts` use
  `accounting.transactions` purely as stored-token/callback fixture data, not as
  assertions about the default scope set. They realistically represent legacy
  stored tokens and are left as-is. (Confirmed with user.)
- **Docs/config.** No references to the retired scope exist in `docs/`, helm, or
  compose files.

## Verification

1. Targeted vitest runs of the updated suites:
   - `packages/integrations/src/actions/integrations/xeroActions.test.ts`
   - `packages/integrations/src/components/settings/integrations/XeroIntegrationSettings.contract.test.tsx`
   - `server/src/test/unit/api/xeroOAuthRoutes.test.ts`
   - plus the untouched xero specs (`xeroClientService.spec.ts`,
     `xeroOauthCallbackCsrf.test.ts`) to confirm no collateral damage.
2. `grep -rn "accounting.transactions"` — remaining hits must be only the
   intentionally-retained legacy fixtures listed above.
3. Override-path check: existing tests covering `XERO_OAUTH_SCOPES` override
   (in `xeroActions.test.ts` / `xeroClientService` specs) must still pass
   unchanged, confirming configured scope overrides are respected.
4. Optional manual sanity via the running dev stack (port 3081): Settings →
   Integrations → Xero displays the granular scopes; Connect builds an
   authorization URL containing the granular scopes and not
   `accounting.transactions`.
