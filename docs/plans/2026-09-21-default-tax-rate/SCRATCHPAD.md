# Working notes

- Assignment: design only for internal card alga-2026-0002527. No application implementation or board operations authorized by this assignment.
- Inspected base: 2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04. Working tree already has an unrelated package-lock.json change; leave it unstaged.
- Plan location follows the explicit order: docs/plans/, overriding the skill's usual ee/docs/plans/ location. The commissioning scope authorizes producing and committing the complete plan without another approval round.
- Confirmed shared client initialization selects oldest active rate and writes a rate-global component per client, with Math.ceil. The shared model duplicates initialization, omits is_default, and has an incompatible zero-rate insert fallback.
- TaxService has both createDefaultTaxSettings and ensureDefaultTaxSettings; preserve profile identity and converge both on shared initialization.
- Additional gaps: ServiceCatalogService.create also collapses omitted/null tax IDs; ClientService creates tax settings after transaction and swallows failure; shared client model catches initialization failures.
- Catalog NULL currently means non-taxable. Existing data cannot distinguish deliberate exemptions from missing setup. Backfill therefore needs an explicit tenant-scoped preview/apply operation.

- Plan decisions: one tenant rate with derived region; no hard-coded GST seed; explicit NULL stays non-taxable; omitted create input inherits; no retroactive client reassignment.
- Preserve legacy oldest-active fallback only for unconfigured client creation; configured-but-invalid default fails. This is a compatibility compromise, called out for review.
- Backfill is an explicit preview/selection/apply action, not schema-migration DML. Recheck default ID and still-NULL predicate at apply.
- Billing engine resolves catalog region and can combine regional rates; test an isolated single-rate GST fixture rather than claiming all invoices become exactly 10%.
- Existing rate validity convention is start inclusive/end exclusive in taxService.ts.
- Reviewed migrations for tenant tax-source fields, region schema, catalog composite FK, client default unique index and association uniqueness; actual Citus colocation remains an implementation verification requirement.
- Checklist size: 20 focused features, 12 high-value test scenarios including real migrated-database success/guard cases. No tests or live database mutations performed in the design session.
