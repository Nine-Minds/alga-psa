# Smoke-evidence hygiene remediation (2026-08-15 HEAD run)

**Workflow card:** `1491d80b-8fa7-4313-a134-f68e5b9dba79`

**Branch head preserved:** `8503e3fe4cef190a4f40978386df0977055606b9`

This note records the host-side cleanup of secret-bearing temporary artifacts left by the 2026-08-15 HEAD smoke run for the extension-gateway `assertAccess()` work. No gateway code, behavior, tests, or documentation was changed; the branch's accepted history is untouched.

## Removed

- `/tmp/extension-gateway-smoke-runner.jsonl` — contained the plaintext smoke secret marker `SMOKE-SECRET-HEAD-ENVELOPE`. Removed (shredded). Its content is byte-identical to the preserved evidence file `07-runner-observations.jsonl`, so no evidentiary value was lost.
- `/tmp/sec-extension-head-server.log` — contained the cleartext database password (the known `[db/tenant] Database configuration` startup-log leak, tracked separately; no logging code was changed here). Removed (shredded).
- `/tmp/alga-smoke-anon-headers2` — stray prior-run (2026-08-14) header capture containing a live `authjs.csrf-token` session token; not referenced by any evidence directory. Removed.
- Ephemeral smoke redis container `alga-smoke-redis-sec-ext-gateway` (redis:7, `127.0.0.1:6381`) — was still running; removed with `docker rm -f`.

## Redacted in place

- `/tmp/alga-smoke-evidence/sec-extension-gateway-head-20260815T0928Z/07-runner-observations.jsonl` — secret-envelope marker value `SMOKE-SECRET-HEAD-ENVELOPE` replaced with `[REDACTED-SMOKE-MARKER]`; structure and all request metadata preserved.
- `/tmp/alga-smoke-evidence/sec-extension-gateway-head-20260815T0928Z/08-sessionless-direct-head.txt` and `08-sessionless-proxy-head.txt` — `authjs.csrf-token` values replaced with `[REDACTED]`; header structure preserved.
- `/tmp/sec-gateway-ready.headers` (prior-run artifact) — `authjs.csrf-token` value replaced with `[REDACTED]`.

## Verification performed

- `grep -rl 'SMOKE-SECRET' /tmp` → zero hits.
- `grep -rl '<db-password>' /tmp` scoped to this run's artifacts → zero hits in the removed/kept evidence; the shared dev-stack DB credential still appears only in unrelated pre-existing artifacts of other tasks.
- `grep -rl 'authjs.csrf-token=[0-9a-fA-F%]{20,}'` across the evidence dir and all `/tmp/sec-gateway-*` files → zero hits.
- `ps` → no smoke runner/simulator process; no `next dev` on port 3238 (confirmed free); the only running `next dev` processes belong to other worktrees.
- `docker ps -a` → no smoke or redis:7 containers remain (pre-existing `alga-smoke-temporal` and `citus-smoke` infra containers untouched).
- Postgres spot-verify on both integration (5472) and live (6472) dev-stack DBs: `tenant_extension_install`, `extension_registry`, `extension_version`, `extension_execution_log`, and `tenant_extension_install_secrets` counts for the smoke fixture IDs all return `0`.

## Follow-up: simulator source provenance (review round)

Done-criterion 3 required the evidence dir to contain the runner simulator source that the smoke report claims is preserved. The 0815 evidence dir originally contained **no source file** (29 files, all txt/json/jsonl/png). Investigation established:

- The prior run's evidence dir `/tmp/alga-smoke-evidence/sec-extension-gateway-assertaccess-20260814-213040/` does preserve `00-simulator-source.mjs`.
- The 0815 run's simulator was an evolution of that script: its observations in `07-runner-observations.jsonl` additionally record a `secretCiphertext` field that the 0814 source does not emit.
- The exact 0815 variant was **never captured** on the host. Searches for any source emitting `secretCiphertext` across `/tmp` (all files, and specifically `*.mjs`/`*.cjs`/`*.js`/`*.ts`), the repository worktree, and shell history found nothing. No 0815 simulator source was recoverable.

Resolution: the 0814 source was copied verbatim (SHA-256 `6ac85319df8a70be5e97e1bfb7c9b3d1cb023a314fd7b10a7a389b1492c0b32e`) into the 0815 evidence dir as `00-simulator-source.mjs`, with a sidecar `00-simulator-source-PROVENANCE.md` stating it is the prior-run version and that the exact 0815 variant was not preserved. The smoke report's implicit claim that the exact 0815 source was preserved was therefore inaccurate; the source was already absent before this mitigation round.

## Human double-check recommended

Re-run the `/tmp` greps for the smoke marker and the DB password value, and confirm the preserved simulator source in `/tmp/alga-smoke-evidence/sec-extension-gateway-head-20260815T0928Z/` (in particular `07-runner-observations.jsonl`) is still intact after redaction, and that `00-simulator-source.mjs` + `00-simulator-source-PROVENANCE.md` correctly document the provenance as the prior-run version.
