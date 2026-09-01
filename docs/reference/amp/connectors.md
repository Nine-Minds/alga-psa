# AMP connectors

A connector converts a source system's export into canonical AMP records and
packages them with the shared builder. Connectors live in
`packages/migration-connectors` and are deliberately pure: they depend only on
`@alga-psa/migration-spec` and `@alga-psa/migration-sdk`, can produce a package
file, and can never read or mutate an Alga tenant.

## The connector contract

Every connector implements `AmpConnector` from
`@alga-psa/migration-connectors`:

```ts
interface AmpConnector {
  descriptor: AmpConnectorDescriptor;
  produce(input: {
    inputDir: string;
    outputPath: string;
    namespace: string;
  }): Promise<{ manifest: AmpManifest; rowCounts: Record<string, number> }>;
}
```

The descriptor is operator-facing and must be honest:

| Field | Meaning |
| --- | --- |
| `name` / `version` | Connector identity, recorded in the manifest |
| `supportedAmpVersions` | AMP format versions the connector emits |
| `sourceSystem` / `sourceSystemVersions` | Source exports the mapping was verified against |
| `entityCoverage` | Entity tables the connector converts, with notes |
| `knownOmissions` | What the source has that the conversion drops |
| `prerequisites` | Access or export steps the operator needs on the source side |

Registered connectors are discoverable through `listConnectors()`.

Connectors build on the shared conversion engine (`runConversion`) rather
than reimplementing parsing: it maps source headers to canonical columns,
captures unmapped columns into bounded `extension_json`, rewrites
source-id references to `package_record_id`s, collects skip/truncation
diagnostics (mirrored into `package_diagnostics`, capped at 500 rows), and
validates the finished package. A connector never emits a record it knows is
broken, and never stops at the first bad row — problems become diagnostics
with source row numbers. `produce` throws if its own output fails validation.

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

## Built-in producers

### `alga-csv-adapter` (CSV / XLSX)

The generic spreadsheet converter, driven by a JSON config from the CLI
(`alga-migrate csv <config.json>`) or the `convertSpreadsheetsToAmp` API.
Files may be `.csv` (parsed with papaparse) or `.xlsx` (first worksheet,
header row first; parsed with exceljs — cells are read as values, formulas
are never evaluated). File paths resolve relative to the config file.

```json
{
  "outputPath": "converted.amp",
  "namespace": "legacy-psa:2026-08",
  "sourceSystem": "legacy-psa",
  "files": [
    {
      "entityType": "organizations",
      "path": "orgs.csv",
      "mapping": { "Company Name": "name", "Account #": "source_record_id" }
    },
    {
      "entityType": "locations",
      "path": "sites.csv",
      "mapping": { "Site": "name", "Company Ref": "organization_package_record_id" }
    }
  ]
}
```

`mapping` maps a file's vendor headers onto canonical columns; unmapped
columns are preserved in `extension_json`. Mapped reference columns carry
*source* ids of the target entity and are rewritten to package ids during
conversion. The adapter records skipped rows and truncations as diagnostics
with source row numbers, validates the finished package, and returns the
validation outcome with per-entity counts — an invalid result is returned,
never silently discarded. See [cli.md](cli.md) for exit codes.

### `connectwise-psa-csv`

Converts a directory of ConnectWise PSA CSV exports (companies, sites,
contacts, service tickets, ticket notes, configurations — exact filenames and
columns in `packages/migration-connectors/src/connectwise/README.md`).
Statuses, priorities, and boards travel as names and are resolved by the
operator during AlgaPSA preflight, never guessed by the connector. Time
entries, agreements, invoices, and attachments are declared omissions.

## The Alga export producer

`writeAlgaExport(path, records, sourceInstanceId)` packages already-extracted
canonical records under the `alga-export` producer with
`source_system: "alga-psa"`. Record extraction is the server's job (it holds
tenant credentials); the connector package only defines the producer identity
and writes the file, keeping the tenant boundary out of open-source code.

## Writing a new connector

1. Parse the source export and normalize each file into the engine's input
   shape (headers + rows), reusing `runConversion` for mapping, diagnostics,
   reference rewriting, and validation.
2. Write entity-specific value transforms (dates to RFC 3339 UTC, flags to
   0/1) in the connector, not in the shared engine.
3. Declare coverage and omissions honestly — the descriptor is operator-facing.
4. Add a conformance test with anonymized fixtures covering expected counts,
   reference wiring between entities, and at least one skipped-row diagnostic.
