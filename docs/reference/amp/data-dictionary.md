# AMP v1 data dictionary

Types are SQLite storage classes; all text is UTF-8. "Opaque id" means a UUID
or producer-chosen string of at most 256 bytes, never an Alga database ID.
Limits from [security.md](security.md) apply to every text value.

## Shared entity columns

Every entity table starts with the same identity columns:

| Column | Type | Required | Meaning |
| --- | --- | --- | --- |
| `package_record_id` | TEXT | yes | Primary key within this package; referenced by other records |
| `source_record_id` | TEXT | yes | The record's key in the source system; idempotency anchor |
| `external_identifier_namespace` | TEXT | yes | Source system + instance namespace (see [source-keys.md](source-keys.md)) |
| `created_at` | TEXT | no | Source creation time, RFC 3339 UTC |
| `updated_at` | TEXT | no | Source last-modified time, RFC 3339 UTC |
| `extension_json` | TEXT | no | Bounded JSON with preserved non-canonical source data |

## organizations

The neutral term for an Alga *client* — every source system calls these
accounts, companies, or organizations.

| Column | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Organization display name |
| `website` | no | URL as text |
| `phone` | no | Phone number as text, source formatting preserved |

## locations

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | yes | Owning organization |
| `name` | yes | Location label, e.g. "Headquarters" |
| `address_line1` / `address_line2` | no | Street address |
| `city` / `region` / `postal_code` | no | Locality fields as text |
| `country_code` | no | ISO 3166-1 alpha-2, uppercase |
| `phone` | no | Phone number as text |

## contacts

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | no | Owning organization; orphans are placed at preflight |
| `location_package_record_id` | no | Contact's location |
| `first_name` / `last_name` | no | Name parts; at least one should be present for a useful record |
| `email` | no | Email address as text; never used for matching |
| `phone` | no | Phone number as text |
| `title` | no | Job title |

## tickets

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | no | Requesting organization |
| `location_package_record_id` | no | Ticket location |
| `requester_package_record_id` | no | Requesting contact |
| `title` | yes | Ticket summary |
| `description` | no | Ticket body text |
| `status_name` | no | Source status *name*; mapped to an Alga status at preflight |
| `priority_name` | no | Source priority *name*; mapped at preflight |
| `category_name` | no | Source category name |
| `closed_at` | no | Source closure time, RFC 3339 UTC |

## ticket_comments

| Column | Required | Meaning |
| --- | --- | --- |
| `ticket_package_record_id` | yes | Owning ticket |
| `author_package_record_id` | no | Authoring contact; absent means a source user or system note |
| `body` | yes | Comment text |
| `is_internal` | no | `1` for internal notes, `0` for client-visible comments |

## assets

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | no | Owning organization |
| `location_package_record_id` | no | Asset location |
| `name` | yes | Asset display name |
| `asset_type_name` | no | Source asset type *name*; mapped to an Alga asset type at preflight |
| `serial_number` | no | Serial number as text |
| `manufacturer` / `model` | no | Hardware identity as text |
| `purchase_date` | no | `YYYY-MM-DD` |

## products

Money is an integer in minor units (cents for USD, whole yen for JPY) plus an
ISO 4217 code. A null currency means the tenant billing currency at apply time.

| Column | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Product name |
| `sku` | no | Natural duplicate key: a product with the same trimmed SKU already in the tenant is matched and left unchanged |
| `category_name` | no | Source category, stored as the product's free-text category (no category is created) |
| `unit_of_measure` | no | Unit label |
| `price_minor` / `price_currency` | no | Sell price in minor units and its currency |
| `cost_minor` / `cost_currency` | no | Cost in minor units and its currency |
| `description` | no | Free text |
| `is_active` | no | `1` active (default), `0` inactive |

## vendor_products

A vendor's offer for a product (a distributor price-list row). There is no
`vendors` table: the vendor is created or matched by trimmed, case-insensitive
`vendor_name` when the row is applied. The upsert key is (vendor, product).

| Column | Required | Meaning |
| --- | --- | --- |
| `product_package_record_id` | one of these two | The `products` row this offer is for |
| `product_sku` | one of these two | Fallback: an existing or staged product with this SKU |
| `vendor_name` | yes | Vendor name |
| `vendor_sku` | no | The vendor's own SKU |
| `unit_cost_minor` / `cost_currency` | no | Contract cost in minor units and its currency |
| `lead_time_days` | no | 0–3650 |
| `is_preferred` | no | `1` marks the preferred offer; at most one per product (others are demoted) |

## external_identifiers

Additional namespaced identifiers for any entity record — for example the same
organization's key in an RMM and an accounting system.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Row key within the package |
| `entity_type` | yes | One of the entity table names |
| `entity_package_record_id` | yes | The record this identifier belongs to |
| `namespace` | yes | Identifier namespace |
| `value` | yes | Identifier value |

## custom_field_values

Preserved source custom fields. Alga stores them for reporting; it never maps
them onto tenant custom fields automatically.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Row key within the package |
| `entity_type` | yes | One of the entity table names |
| `entity_package_record_id` | yes | The record the value belongs to |
| `field_name` | yes | Source field name |
| `value_json` | yes | JSON-encoded value, bounded like `extension_json` |

## package_diagnostics

Producer warnings, displayed but never treated as validation.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Row key within the package |
| `severity` | yes | `info` or `warning` |
| `code` | yes | Producer-defined stable code |
| `message` | yes | Human-readable explanation |
| `entity_type` / `entity_package_record_id` | no | The record the diagnostic concerns |
