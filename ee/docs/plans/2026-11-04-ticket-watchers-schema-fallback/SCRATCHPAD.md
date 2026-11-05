# Notes

- Base: deployed email-service revision `9c3f8579b8e418040866fc682f84b58753564c2d`.
- PostgreSQL aborts a transaction after undefined-table errors; storage selection must use a non-failing catalog probe first.
- Keep compatibility inside the shared watcher service so every caller retains watchers rather than skipping a failed write.
- Use an isolated PostgreSQL schema for behavioral tests. Run the actual watcher migration to verify transition and backfill.

- Implemented a small storage interface inside the existing watcher service. Relational and legacy attribute storage share validation, merging, change detection, and mirror persistence.
- `to_regclass` probes the connection's actual search path, does not cache absence, and does not suppress permission, schema, or query failures.
- The user requested skipping testing before the regression test file or test database was created. Neither was added; no tests, build, or runtime probes were run for this code change.
- Existing migration remains unchanged. No production deployment, migration, or replay is part of this commit.
