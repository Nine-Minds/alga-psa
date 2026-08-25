# Alga Migration Package (AMP) v1

AMP is an untrusted, portable SQLite package. Producers write only the published allowlisted tables; consumers must open read-only, disallow extensions, use parameterized SELECTs, and reject triggers, views, unknown tables, invalid references, and limit breaches.

The package vocabulary uses `organizations`; Alga maps that entity to `clients` at apply time. Identity is `(external_identifier_namespace, entity_type, source_record_id)`, never a target database ID. The canonical content hash orders allowlisted entity tables by table name and records by `package_record_id`, excluding `amp_manifest`.

`alga-migrate validate package.amp` validates without database access. Exit status is 0 for valid packages, 2 for invalid packages, and 64 for command misuse.
