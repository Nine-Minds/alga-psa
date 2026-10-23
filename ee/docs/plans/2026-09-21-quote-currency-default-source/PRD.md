# Quote currency default propagation and source visibility

- Card: `alga-2026-0002520`
- Date: 2026-09-21
- Status: Draft for implementation

## Summary

Make tenant currency changes reach clients that still carry the previous tenant
default, make the source of a quote's selected currency visible while authoring,
and correct quote-detail totals that currently treat minor units as major units.

The implementation keeps `quotes.currency_code` as the authoritative persisted
currency. It does not rewrite existing quotes or quote templates when tenant or
client defaults change.

## Problem

Quote rendering is not hard-coded to USD. The renderer correctly uses the
persisted `quotes.currency_code`, but several defaulting layers can cause USD to
be persisted before rendering:

1. `clients.default_currency_code` is copied from the tenant default when a
   client is created. A later tenant currency change does not update that copy.
2. New quote creation prefers the client's stored currency over the tenant
   default.
3. A business quote template owns its own currency and intentionally overrides
   client and tenant defaults when instantiated.
4. `QuoteForm` initializes and submits a concrete currency but gives the user no
   indication whether it came from the tenant, client, template, saved quote, or
   a manual choice.

This makes a correctly rendered USD quote look like a rendering defect and
makes remediation difficult to discover.

There is also an independent amount-unit defect in the quote detail summary:
quote totals are stored in minor units, while `useFormatters().formatCurrency`
expects major units. Passing the stored value directly inflates the displayed
amount by 100.

## Goals

- When the tenant default currency changes, update client currency snapshots
  that still equal the tenant's previous default.
- Preserve client currency values that differ from the previous tenant default.
- Explain the propagation rule where the tenant default is edited and report
  its result after a successful save.
- Show the active currency and its source on the quote form.
- Re-resolve a new quote's default when its client changes, while keeping
  template currency precedence visible.
- Preserve the server-side create precedence: explicit quote currency, then
  client default, then tenant default, then USD.
- Render quote-detail subtotal, discount, tax, and total in the correct
  magnitude.

## Non-goals

- Rewriting existing quotes, revisions, invoices, contracts, products,
  services, or business quote templates after a default changes.
- Automatically converting monetary amounts between currencies. This work
  changes currency selection, not exchange rates or amounts.
- Changing PDF, preview, or email renderer currency precedence; those paths
  already honor `quotes.currency_code`.
- Removing the final USD fallback or changing the database defaults in this
  card.
- Adding historical provenance to `clients.default_currency_code`. Existing
  data cannot prove whether a value equal to the old tenant default was selected
  explicitly or inherited.
- Bulk-editing templates. A USD business template remains USD until a user
  edits and saves that template.
- Correcting monetary formatting outside the identified quote-detail summary.

## Users and Primary Flows

### Change the tenant default

An administrator opens Billing Settings and changes the default currency. The
screen explains that clients currently using the old tenant default will follow
the change, while clients using another currency will remain unchanged. The
save runs both changes in one transaction and the success message reports the
number of client defaults updated and preserved.

Example: the tenant changes USD to AUD. Clients stored as USD move to AUD;
clients stored as EUR or GBP remain unchanged.

### Create a quote for a client

A user opens a new quote and chooses a client. The currency changes to that
client's default and helper text identifies it as the client default. If the
client is cleared, the form returns to the tenant default. Changing the picker
directly marks the value as manually selected.

The same behavior applies when a client arrives through initial context or the
quick-add-client flow. Automatic client defaulting applies only while creating
a new quote; editing an existing quote does not silently change its saved
currency when its client changes.

### Create a quote from a business template

Applying a business template continues to set the template's currency. Helper
text identifies the template as the source, making a USD template immediately
visible as the reason for a USD quote. A subsequent manual picker change is
labeled as manual.

### Edit a saved quote or template

The persisted currency loads unchanged and is identified as saved on the quote
or saved on the template. Defaults are not retroactively applied.

## UX / UI Notes

### Billing Settings

- Keep the existing currency picker and immediate-save interaction.
- Add short explanatory copy near the picker: changing the tenant default also
  updates clients currently using the previous default; other client currencies
  are preserved; existing documents and templates do not change.
- Use the action result in the success toast, for example: “Default currency
  changed to AUD. 18 client defaults updated; 3 client overrides preserved.”
- A no-op save should report success without claiming client updates.

### Quote Form

Render concise helper text directly below the currency picker. Source states:

| State | Helper text intent |
| --- | --- |
| Tenant default | “Tenant default” |
| Client default | “Client default for {client name}” |
| Business template | “From quote template {template title}” |
| Existing quote | “Saved on this quote” |
| Existing business template | “Saved on this template” |
| Manual | “Selected manually” |

Source is transient UI state, not persisted provenance. The picker value remains
the actual submitted `currency_code`.

Precedence in create mode is:

1. Applying a business template sets its currency and source.
2. Otherwise, selecting or seeding a client sets the client currency and source.
3. Without a client, use the tenant default and source.
4. Any direct picker change sets the manual source.

## Requirements

### Functional Requirements

1. `updateDefaultBillingSettings` must read the old effective tenant currency
   (`stored value || 'USD'`) and normalize the requested new value before
   deciding whether propagation is required.
2. A real tenant currency change must update tenant-scoped client rows whose
   `default_currency_code` equals the old effective tenant currency.
3. Client rows with a different currency must not be changed.
4. The client update and tenant settings update/insert must commit or roll back
   together.
5. Saves that omit `defaultCurrencyCode`, and saves where the normalized value
   does not change, must not update clients.
6. The update action must return propagation counts in addition to `success` so
   the settings UI can disclose the result.
7. Existing action permission checks and partial-update behavior must remain
   intact.
8. `QuoteForm` must resolve tenant settings and its client list deterministically
   before seeding a create-mode currency; it must not depend on competing
   effects whose completion order can restore USD.
9. Initial-context clients, normal client selection, clearing a client, and the
   quick-add-client path must all update create-mode currency and source
   consistently.
10. Applying a business template must continue to override the current form
    currency and must label the source as the template.
11. Direct interaction with the quote currency picker must label the source as
    manual.
12. Edit mode must retain the saved quote/template currency and must not
    silently re-default it after client or tenant changes.
13. `createQuote` must retain its server-side fallback precedence for callers
    that omit `currency_code`.
14. Quote detail must divide the stored summary amounts by 100 before calling
    the major-unit currency formatter.

### Non-functional Requirements

- All propagation queries must remain tenant-scoped.
- The settings mutation must remain atomic.
- User-visible copy must use the existing billing-settings and quotes i18n
  namespaces with English default values.
- Currency source state should be a small explicit union rather than inferred
  repeatedly from equal currency strings.

## Data / API / Integrations

No schema migration is planned.

`updateDefaultBillingSettings` will expand its successful response from
`{ success: true }` to a backward-compatible structural superset such as:

```ts
{
  success: true,
  previousCurrencyCode: 'USD',
  currencyCode: 'AUD',
  propagatedClientCount: 18,
  preservedClientCount: 3,
}
```

Counts are meaningful only when `defaultCurrencyCode` was supplied. Existing
callers that inspect only `success` remain valid. The transaction should:

1. read the existing settings row (locking it for update when present),
2. calculate the old and new effective currencies,
3. update matching tenant client rows when the value changed,
4. update or insert the tenant settings row, and
5. return the affected and preserved counts.

The matching-old-default rule is deliberate. Because historical clients contain
only a copied three-letter value, there is no reliable stored bit that says
whether a value was inherited. This rule repairs the common inherited-snapshot
case while protecting every client already using a distinct currency.

Quote currency-source state remains local to `QuoteForm`. No column is added to
`quotes`, because a saved quote's currency is authoritative regardless of how
it was initially chosen.

## Security / Permissions

- Keep `billing_settings:update` as the permission governing tenant currency
  changes and their client propagation.
- Do not add a second client-update permission requirement: propagation is part
  of the authorized tenant-default mutation and must be atomic with it.
- Continue using `tenantScopedTable`/`tenantDb` for both settings and client
  queries; tests must prove another tenant's clients are untouched.

## Rollout / Migration

- No data migration or backfill runs at deploy time.
- The first subsequent tenant currency change repairs matching client
  snapshots transactionally.
- Existing quote and template rows remain unchanged, avoiding accidental
  currency relabeling of historical monetary amounts.
- The new settings explanation makes the matching rule visible before the user
  changes the picker, and the toast reports the result afterward.

## Risks

- **Same-value explicit overrides are indistinguishable.** A client explicitly
  set to the same code as the previous tenant default will follow the tenant
  change. The UI must state the exact matching rule. Adding durable client
  provenance would remove this ambiguity but requires a separate migration and
  a “revert to tenant default” client UX.
- **Currency change is not amount conversion.** Existing client configuration
  may contain amounts intended for the old currency. This card follows current
  product semantics—defaults label future records—and does not apply FX.
- **Asynchronous form initialization.** Tenant settings, clients, templates,
  and an optional saved quote currently load through multiple asynchronous
  paths. Consolidating create-mode currency resolution is necessary to prevent
  a late tenant-default load from overwriting a client or template choice.
- **Template precedence can surprise users.** It remains intentional. The
  source label is the mitigation; templates themselves are not bulk-rewritten.
- **Minor/major units are easy to mix.** The detail test must assert a
  non-round value so a factor-of-100 regression is obvious.
- **Shared settings action.** Many billing-settings sections call the same
  action. Propagation must be strictly gated on the presence of
  `defaultCurrencyCode` so unrelated saves remain side-effect free.

## Open Questions

None blocking for implementation. Durable client currency provenance is a
possible follow-up if product requirements demand exact inheritance rather than
the disclosed matching-old-default rule.

## Acceptance Criteria (Definition of Done)

1. Changing a tenant default from USD to AUD updates only that tenant's clients
   currently stored as USD; a client stored as EUR remains EUR.
2. The client updates and tenant settings update roll back together on failure.
3. Saving an unrelated billing setting causes no client currency update.
4. Billing Settings explains propagation before the change and reports updated
   and preserved client counts after success.
5. A new quote with an AUD client shows AUD and labels it as the client default.
6. Changing the selected client in create mode refreshes the currency/source;
   clearing it restores the tenant default.
7. Applying a USD business template shows USD and labels the quote template as
   the source.
8. Manually choosing a currency labels it as manually selected.
9. Editing an existing quote or template preserves its saved currency and
   labels the value as saved rather than reapplying current defaults.
10. A caller that omits quote currency still receives server precedence of
    client, tenant, then USD.
11. Stored summary values of 12,345 minor units display as 123.45 major units
    in Quote Detail for subtotal/discount/tax/total as applicable.
12. Automated coverage includes real migrated-schema queries for propagation's
    happy path and preservation/tenant guard.
