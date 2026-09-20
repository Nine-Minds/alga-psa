# Tax rate API fields

`GET /api/v1/financial/tax/rates` lists tax rates for the authenticated tenant.
The response contains tax-rate records, including `cap_amount` and
`currency_code`; it does not list financial transactions. Existing financial
API authentication and read authorization apply, together with billing-read
permission and PSA product access.

This route supports GET only. The create and update schemas describe the
shared tax-rate data contract; they do not add public POST or PATCH endpoints.
Configure rates through [Billing > Tax Rates](../billing/tax/configuring_tax_caps.md).

## Listing and filters

The response uses the standard `data` array and `pagination` object, including
`page`, `limit`, `total`, `totalPages`, `hasNext`, and `hasPrev`.

- `page` starts at 1. `limit` defaults to 25 and supports up to 100 rows.
- `sort` supports `created_at`, `updated_at`, `region_code`, `tax_percentage`,
  `start_date`, `end_date`, `cap_amount`, and `currency_code`. The default is
  `created_at` descending; use `order=asc` or `order=desc` to choose direction.
- `region_code` matches a region exactly. `search` matches region code or
  description without case sensitivity.
- `effective_date` selects rates whose start is on or before that date and
  whose end is after it, or absent. `is_active` accepts `true` or `false`.
- `created_from`, `created_to`, `updated_from`, and `updated_to` filter the
  corresponding timestamps with inclusive boundaries.

For example:

```http
GET /api/v1/financial/tax/rates?page=1&limit=25&region_code=US-FL&sort=cap_amount&order=asc
```

## Amount and currency

| Field | Representation | Meaning |
| --- | --- | --- |
| `cap_amount` | JSON safe integer or `null` | Maximum tax contribution in the rate currency's smallest unit; `null` means no cap, and `0` is a real zero cap. |
| `currency_code` | Supported ISO currency code or `null` | Restricts the entire rate to that invoice currency; `null` means all invoice currencies. |

For example, these field pairs describe the same numerical major-unit amount
in currencies with different precision:

```json
{"currency_code": "USD", "cap_amount": 500}
```

```json
{"currency_code": "JPY", "cap_amount": 5}
```

```json
{"currency_code": "BHD", "cap_amount": 5000}
```

These represent USD 5.00, JPY 5, and BHD 5.000 respectively. The cap is not a
percentage. There is no foreign-exchange conversion or implicit tenant-base
currency interpretation.

Schema inputs accept integer JSON numbers from 0 through 9007199254740991.
They reject numeric strings, negative numbers, fractional numbers, and unsafe
integers. Database bigint strings are normalized to safe integers before
response validation. Responses return explicit `null` for an absent cap or
currency, including older caps without a currency association.

## Create and update semantics

On create, omitting `cap_amount` means no cap and omitting `currency_code`
means all invoice currencies. A new non-null cap, including zero, requires an
explicit supported currency.

On update, omission preserves each stored field. `{"cap_amount": null}` clears
the cap and retains the currency. `{"cap_amount": 0}` sets a zero cap using the
stored currency, provided it is explicit and supported. Clearing both fields
with `{"cap_amount": null, "currency_code": null}` removes the cap and makes
the rate universal.

Pair validation uses the effective saved row within the authenticated tenant.
Removing the currency while retaining a cap is rejected. An unchanged older
pair containing a cap and a null currency may be preserved, including during
unrelated edits. Deliberately changing that cap requires an explicit currency.
No migration assigns a guessed currency to older rows.

## Scope and schema consumers

Caps apply per rate contribution and, for period calculations, per rate per
date segment. They are not invoice or whole-period aggregate limits. Regional
calculations apply a composite row's cap to its regional contribution;
component-based calculations do not apply it. External tax providers follow
their own configuration.

The create, update, response, and advanced schemas are defined in
`server/src/lib/api/schemas/financialSchemas.ts`. Their TypeScript aliases use
`z.infer`; there is no separate hand-maintained tax-rate SDK type to update.
See the [calculation contract](../billing/tax/tax_caps_and_period_spanning.md)
for arithmetic and outstanding jurisdiction review.
