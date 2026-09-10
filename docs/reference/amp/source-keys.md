# Source keys and idempotency

## The three identifiers on every record

- **`package_record_id`** exists only inside one package file. It links
  records to each other (a comment to its ticket) and is the unit of
  per-record reporting. It carries no meaning across packages.
- **`source_record_id`** is the record's durable key in the source system —
  the ConnectWise ticket ID, the CSV row's account number. It must be stable
  across exports of the same source.
- **`external_identifier_namespace`** scopes `source_record_id`. Two source
  systems (or two instances of the same system) can both have a ticket `1001`;
  the namespace keeps them distinct. Producers should build it from the source
  system plus instance, e.g. `connectwise:na.myco.com`.

## The idempotency contract

Alga records every applied record in an identity ledger keyed by
`(tenant, namespace, entity_type, source_record_id)`. Application is
create-only:

- No ledger entry → the record is created and the ledger entry is written in
  the same transaction as the creation.
- Ledger entry exists → the record is **skipped as already applied**, whatever
  its current field values.

Consequences producers can rely on:

- Re-uploading the same package never duplicates records.
- A retried or resumed job re-applies only records without ledger entries.
- Uploading a *newer export* of the same source creates only records that are
  new in the source. Changed records are not updated — update-by-source-key is
  a v2 feature with a per-entity merge policy.

Alga never fuzzy-matches: two organizations with the same name, or two
contacts with the same email, are distinct unless their source keys match.

## Choosing keys well

- Never synthesize `source_record_id` from mutable fields (names, emails). If
  the source has no stable key, derive one deterministically (e.g. the row
  number of a frozen export file) and keep the export file.
- Use one namespace per source instance, and reuse it exactly for later
  exports of that instance — the ledger only protects you if the namespace is
  stable.
- Record additional cross-system keys in `external_identifiers`; they are
  preserved for lookup but are not idempotency anchors.
