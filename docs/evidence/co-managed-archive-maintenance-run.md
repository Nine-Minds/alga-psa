# Archive-maintenance run against the live stack (instruction 1, proof 3)

Plain `node` — no bundler, no vitest, no Next. This is the execution path
packages/jobs' `coManagedUploadCleanupHandler` takes inside the worker, which is
why it is the proof that the **built** co-managed barrel actually loads, rather
than a proof that a test runner can transpile the sources.

Re-executed **after** the `origin/main` merge was resolved, against the live
`server_co_managed` database. Command:

```
node scripts/dev/run-co-managed-archive-maintenance.mjs
```

## Companion proofs, same round

```
$ npm run check:dist-resolution
OK: 224 built modules walked, every @alga-psa/* subpath resolves under plain Node.

$ node --input-type=module -e "const m = await import('.../packages/co-managed/dist/index.js'); ..."
import OK in 583 ms
exported bindings: 283
```

`@alga-psa/shared` was rebuilt (`tsup`) and then `@alga-psa/co-managed` was
rebuilt against it before these runs, so the barrel under test is the one the
current exports map produces.

## Seed — the sweep is given genuine work

A sweep that finds nothing proves only that the code loads. The previously
seeded draft `…ab01` had already been consumed by the pre-merge run (it is
`abandoned`/`cleaned`), so a **second** draft was seeded from the first — same
tenant, relationship, ticket and thread, new `operation_id`, `last_activity_at =
now() - 40 days`, which is past the `CO_MANAGED_UPLOAD_RETENTION_DAYS` grace:

```
             operation_id             | status | last_activity_at |  abandoned_at  | cleanup_completed_at
--------------------------------------+--------+------------------+----------------+----------------------
 11111111-0000-4000-8000-00000000ab02 | draft  | 2026-08-10       |                |
 11111111-0000-4000-8000-00000000ab01 | draft  | 2026-08-10       | 2026-09-19 …   | 2026-09-19 …
```

Only `…ab02` is eligible, so a correct sweep must report exactly **one**
abandoned draft — not zero, and not two.

## Run 1 — real work, post-merge

```
[env] DB_PASSWORD_SERVER length=32 (must be > 0)
[load] importing the BUILT co-managed barrel from plain Node...
[load] ok in 557ms; 283 exports
[load]   cleanupCoManagedUploads: function
[load]   storeCoManagedArchiveFiles: function
[load]   cleanupCoManagedThreadTransfers: function
[load]   finalizeCoManagedArchive: function
[db] connected to server_co_managed
[run] cleanupCoManagedUploads...
[run] uploads -> {"abandonedDrafts":1,"discardedFiles":0,"purgedFiles":0,"completedDrafts":1,"failedFiles":0}
[run] storeCoManagedArchiveFiles (the archive sweep)...
[run] archiveFiles -> {"stored":0,"failed":0}
[run] cleanupCoManagedThreadTransfers...
[run] transfers -> {"abandonedTransfers":0,"cleanedTransfers":0,"failedTransfers":0}
[done] total 635ms; 0 storage objects removed
```

`abandonedDrafts: 1` is the seeded row, and only it.

## Run 2 — idempotent, work already consumed

```
[load] ok in 519ms; 283 exports
[run] cleanupCoManagedUploads...
[run] uploads -> {"abandonedDrafts":0,"discardedFiles":0,"purgedFiles":0,"completedDrafts":0,"failedFiles":0}
[run] storeCoManagedArchiveFiles (the archive sweep)...
[run] archiveFiles -> {"stored":0,"failed":0}
[run] cleanupCoManagedThreadTransfers...
[run] transfers -> {"abandonedTransfers":0,"cleanedTransfers":0,"failedTransfers":0}
[done] total 591ms; 0 storage objects removed
```

## Database state after the sweep

```
             operation_id             | status | abandoned | cleaned
--------------------------------------+--------+-----------+---------
 11111111-0000-4000-8000-00000000ab02 | draft  | t         | t
 11111111-0000-4000-8000-00000000ab01 | draft  | t         | t
```

## What this does and does not establish

- **Does:** the built barrel loads under plain Node through the repaired exports
  map; the maintenance entry points are live functions, not undefined; they
  reach the real database, find real eligible rows, mutate them, and are
  idempotent on a second pass.
- **Does not:** exercise object-storage deletion. `0 storage objects removed` is
  honest — the seeded drafts carry no attachment rows, so `remove()` was never
  called. The storage provider was constructed but not asked to delete anything.
