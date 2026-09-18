# Alga Migration Package (AMP)

An AMP is a single SQLite file that carries an MSP's book of business —
organizations, locations, contacts, tickets, ticket comments, and assets —
from any source system into AlgaPSA. The product is the contract, not the
container: SQLite is only a portable relational file that consumers read with
parameterized SELECTs. It is never attached to Postgres, never executed, and
never trusted.

| Document | Contents |
| --- | --- |
| [spec.md](spec.md) | Format v1: tables, manifest, value rules, content hash, compatibility |
| [data-dictionary.md](data-dictionary.md) | Every table and column, with requiredness and semantics |
| [mapping.md](mapping.md) | How canonical entities map into Alga, and what operators configure at preflight |
| [source-keys.md](source-keys.md) | Source keys, namespaces, and the idempotency contract |
| [security.md](security.md) | Security boundaries, limits, and consumer obligations |
| [cli.md](cli.md) | `alga-migrate` commands and exit codes |
| [connectors.md](connectors.md) | The connector contract, conformance, built-in connectors, and the Alga export producer |

## Packages

- `@alga-psa/migration-spec` — the contract: table/column allowlists, JSON
  Schemas, limits, error codes, canonical DDL.
- `@alga-psa/migration-sdk` — builder, read-only reader, validator, and
  conformance helpers for producing and checking packages.
- `@alga-psa/migration-cli` — `alga-migrate`; validates, inspects, and
  converts without any database access.
- `@alga-psa/migration-connectors` — the CSV/XLSX converter and community
  source-system connectors. Connector authors depend on the spec and SDK only,
  never on AlgaPSA server internals.

## Producing a package

Build packages with `AmpPackageBuilder` (or any tool that emits the canonical
schema), then validate:

```bash
alga-migrate validate acme-migration.amp
```

A package that validates cleanly here will pass AlgaPSA's server-side
inspection; the server additionally applies tenant-scoped mapping and
reference-data checks during preflight.
