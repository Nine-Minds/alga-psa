# Template status mappings — compact run-bound verification (XOVERDICT)

One bounded command for an independent verifier. Run it against the sealed
smoke-evidence bundle for PR #3135 (`fix/template-status-mapping-fk`) and it
proves all nine claims in seconds, then exits with exactly one verdict line
plus nine keyed claim lines. It never requires reading the bundle tree or the
dev-server logs.

## The one-liner

```sh
node scripts/verify-template-status-mapping-smoke-evidence.mjs \
    <bundle-dir> \
    --xoverdict --run-id <uuid> --head-sha <40-hex> --repo-root <repo>
```

Concrete invocation used for the sealed bundle:

```sh
node scripts/verify-template-status-mapping-smoke-evidence.mjs \
    /tmp/alga-smoke-evidence/repair-project-template-status-mappings-<utc> \
    --xoverdict \
    --run-id <RUN_ID> \
    --head-sha <HEAD_SHA> \
    --repo-root /home/robert/alga-copies/fix-template-status-mapping-fk
```

Output (PASS case):

```
XOVERDICT: PASS
claim-1-mixed-standard-tenant-apply: PASS
claim-2-unresolved-repair: PASS
claim-3-id-preserving-replacement: PASS
claim-4-two-template-delete-guard: PASS
claim-5-zero-project-global-apply: PASS
claim-6-cleanup-restoration: PASS
claim-7-exact-provenance: PASS
claim-8-no-mocks-no-secrets-no-drift: PASS
claim-9-known-dirt-unchanged: PASS
bundleDigest=<sha256 of the bundle SHA256SUMS>
headSha=<40-hex>
runId=<uuid>
```

Exit code is 0 only when every claim passes; any mismatch exits 1 with
`XOVERDICT: FAIL <reason>` naming the failed claim(s). Usage errors exit 2.

## How the run-id and head-sha are discovered (never guessed)

- `--head-sha` is the exact `git rev-parse HEAD` of the worktree the bundle
  was captured at (recorded in the bundle as `01-git-head.txt` /
  `manifest.json`).
- `--run-id` is the workflow run that is actually running for the card. The
  capture harness discovers it at `init` from the single
  `status == 'running'` entry in
  `alga-dev workflow-get-project --projectId=<project>`; the compact surface
  re-verifies it against the board live (if exactly one run is running it
  must be the invoked id; otherwise the id must be a real recorded run of
  the project).

## What the nine claims check

1. **claim-1-mixed-standard-tenant-apply** — the apply evidence records typed
   `project_status_mappings` columns on the created project, and the live DB
   still shows a standard row (`standard_status_id` set, `is_standard=true`,
   `status_id` null) and a tenant row (`status_id` set, `is_standard=false`,
   `standard_status_id` null) for the retained smoke project.
2. **claim-2-unresolved-repair** — the bundle proves the broken fixture had 2
   unresolved mappings and the missing mapping was repaired in place via the
   replace control (count dropped to 1); the repair screenshot slots are
   complete, structurally valid PNGs.
3. **claim-3-id-preserving-replacement** — the replaced mapping kept
   `template_status_mapping_id e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd`, its
   template, and all 21 task assignments across replacement; the live DB task
   count still equals the expected 21.
4. **claim-4-two-template-delete-guard** — deleting a tenant status referenced
   by project templates is blocked: the app guard names the template(s) and
   the `ON DELETE RESTRICT` FK rejects the DELETE on
   `project_template_status_mappings`.
5. **claim-5-zero-project-global-apply** — a global apply of a template with a
   remaining unresolved mapping returns the safe
   `TEMPLATE_STATUS_MAPPINGS_UNRESOLVED` error + repair link and creates zero
   projects (total project count unchanged).
6. **claim-6-cleanup-restoration** — the seed template is restored byte-for-byte
   to the recorded pre-mutation baseline, zero unresolved mappings remain, the
   valid smoke template is gone, and the applied smoke project is retained. The
   compact surface re-proves all of this against the **live** PostgreSQL.
7. **claim-7-exact-provenance** — the bundle is bound to the exact HEAD SHA and
   the current board run id across `00-workflow-run.json`, `manifest.json`,
   `91-screenshot-slots.json`, and `01-git-head.txt`; the live repo HEAD equals
   the invoked head; the board run record matches the invoked run.
8. **claim-8-no-mocks-no-secrets-no-drift** — evidence came from real psql
   runs (exit codes + non-empty result sets), real browser captures bound to a
   pane, structurally valid PNG screenshots, and a raw dev-server scan; no
   secret derivable from `server/.env.local` (DB password, NEXTAUTH) or the
   live dev-login appears anywhere in the bundle; this branch's migration
   `20260809120000_type_template_status_mappings.cjs` is recorded in the live
   `knex_migrations`. **Unrelated migration-history drift in the shared dev DB
   is explicitly ignored** — the check is scoped to this branch's migration
   only.
9. **claim-9-known-dirt-unchanged** — the live repo `git status --porcelain`
   shows exactly ` M package-lock.json` and nothing else, matching the
   manifest's recorded git status.

## Fail-closed behavior

Every live check (git, PostgreSQL, board) and every bundle-internal check
must pass. A stale run, a different live HEAD, an unexpected dirty file, a
non-restored seed template, a missing migration record, or a leaked secret
all turn the relevant claim (and therefore the whole verdict) red. The
command is deterministic and bounded — it runs in a few seconds.

## Notes

- `server/.env.local` is **not** shell-source-safe; DB values are read as
  dotenv strings only.
- The migration check intentionally compares **only** this branch's migration
  name against `knex_migrations`; it does not diff the full migration list
  (the shared dev DB has known unrelated drift in both directions).
- `rg` is not installed on this host; do not use it in the verifier or in any
  follow-up command.
