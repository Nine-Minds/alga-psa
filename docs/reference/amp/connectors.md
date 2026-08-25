# AMP connectors

A connector converts a source system's export into canonical AMP records and
packages them with the shared builder. Connectors live in
`packages/migration-connectors` and are deliberately pure: they depend only on
`@alga-psa/migration-spec` and `@alga-psa/migration-sdk`, can produce a package
file, and can never read or mutate an Alga tenant.

## The connector contract

Every connector exports a `MigrationConnector`:

```ts
interface MigrationConnector {
  declaration: ConnectorDeclaration;
  convert(source: ConnectorSourceTables): CanonicalRecords;
}
```

`ConnectorSourceTables` is one array of parsed source rows per AMP entity
table. `convert` returns canonical records keyed by entity table, generating
deterministic `package_record_id`s from `(namespace, entity, source id)` so
re-running a conversion produces identical identities — the property AMP's
create-only idempotency depends on.

The declaration states what an operator can expect before running anything:

| Field | Meaning |
| --- | --- |
| `name`, `version` | Producer identity, written into the package manifest |
| `supportedAmpVersions` | AMP format versions the connector emits |
| `sourceSystemVersions` | Source exports the mapping was verified against |
| `entityCoverage` | Entity tables the connector converts |
| `knownOmissions` | What the source has that the conversion drops |
| `licensingPrerequisites` | Access the operator needs on the source side |

Conversion problems are collected as `ConnectorRowError`s (entity, source row
number, field, message) and raised together as a `ConnectorConversionError` —
a connector never emits a record it knows is broken and never stops at the
first bad row.

## Conformance

A connector is conformant when the package it produces passes
`validateAmpPackage` cleanly and carries the row counts it claims. Use the
shared helper in tests:

```ts
const report = checkProducerConformance(path, {
  expectedCounts: { organizations: 3, contacts: 12 },
});
expect(report.conformant).toBe(true);
```

Every built-in connector has a fixture-driven conformance test in
`packages/migration-connectors/tests`. New connectors must ship one with
anonymized fixtures.

## Built-in connectors

### `alga-csv-adapter` (CSV / XLSX)

Converts one spreadsheet per entity using the canonical source headers from
[mapping.md](mapping.md) (`id`, `name`, `organization_id`, …). Files may be
`.csv` (parsed with papaparse) or `.xlsx` (first worksheet, header row first;
parsed with exceljs — cells are read as text, formulas are never evaluated).
Cross-entity references use *source* ids: a `locations` row's
`organization_id` names the `id` of a row in the organizations file.

Driven by a JSON config, from the CLI (`alga-migrate csv <config.json>`) or
the `convertSpreadsheetsToAmp` API:

```json
{
  "outputPath": "converted.amp",
  "sourceSystem": "legacy-psa",
  "entities": {
    "organizations": { "file": "orgs.csv", "mapping": { "Company Name": "name" } },
    "contacts": { "file": "contacts.xlsx" }
  }
}
```

`mapping` renames a file's headers to the canonical ones, so exports keep
their vendor headers untouched. The adapter records each record's source row
number in `extension_json` (`{"source_row": n}`), validates the finished
package, and returns the validation result with per-entity counts.

### `connectwise-psa-csv`

Converts ConnectWise Manage CSV exports of Companies, Contacts, and Service
Tickets. Vendor headers (`RecID`, `Company`, `First Name`, `Ticket #`,
`Summary`, …) are normalized to canonical fields before conversion; boards,
members, agreements, time entries, invoices, and attachments are declared
omissions — target boards, statuses, and priorities are resolved by the
operator during AlgaPSA preflight, never guessed by the connector.

## The Alga export producer

`writeAlgaExport(path, records, sourceInstanceId)` packages already-extracted
canonical records under the `alga-export` producer with
`source_system: "alga-psa"`. Record extraction is the server's job (it holds
tenant credentials); the connector package only defines the producer identity
and writes the file, keeping the tenant boundary out of open-source code.

## Writing a new connector

1. Normalize the source export into `ConnectorSourceTables` rows.
2. Reuse `convertEntityRows` where the canonical field layout fits; write a
   custom `convert` where the source needs entity-specific reshaping.
3. Declare coverage and omissions honestly — the declaration is operator-facing.
4. Add a conformance test with anonymized fixtures covering: expected counts,
   reference wiring between entities, and at least one collected row error.
