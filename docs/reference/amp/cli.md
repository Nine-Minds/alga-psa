# alga-migrate CLI

`alga-migrate` works entirely on package files. It never connects to a
database and cannot mutate an Alga tenant.

```text
alga-migrate validate <package.amp>        Validate a package
alga-migrate inspect <package.amp>         Print manifest, tables, row counts
alga-migrate csv <convert-config.json>     Convert CSV/XLSX files into a package
alga-migrate package check <package.amp>   Validate and summarize
alga-migrate package sample <out.amp>      Write the canonical sample package
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success; for `validate`/`package check`, the package is valid |
| 2 | The package failed validation; diagnostics are on stdout |
| 3 | I/O or conversion failure (unreadable file, converter error) |
| 64 | Usage error |

## validate

Prints the full validation result as JSON: `valid`, `diagnostics` (each with
a stable `code` from the spec, plus table/record/field context), the parsed
`manifest`, and per-table `rowCounts`.

## inspect

Opens the package read-only and prints the manifest row, the table list, and
row counts without running full validation. Use it to see what a package
claims before validating a large file.

## csv

Converts one or more CSV/XLSX files into a single AMP package. The config
file lists the output path, namespace, source system, and one entry per
entity:

```json
{
  "outputPath": "acme.amp",
  "namespace": "acme-csv:2026-08",
  "sourceSystem": "csv-export",
  "files": [
    {
      "entityType": "organizations",
      "path": "orgs.csv",
      "mapping": { "Company Name": "name", "Account #": "source_record_id" }
    }
  ]
}
```

See [mapping.md](mapping.md) for mapping semantics. The converter records
skipped rows and truncated values in `package_diagnostics` with source row
numbers.

## package check

Runs full validation and prints a summary: package id, format version,
producer, source system, per-table row counts, and all diagnostics.

## package sample

Writes the canonical dependency-complete sample package (one record per
entity group plus auxiliary rows). Useful for exercising pipelines and as a
producer reference.
