# Running EE Migrations Locally (Without Copying Into Repo)

Goal: run Community Edition (CE) and Enterprise Edition (EE) migrations together on a developer workstation without physically copying or committing merged files into the repository.

Summary
- CE migrations live in `server/migrations/`
- EE migrations live in `ee/server/migrations/`
- Locally, use a temp-dir overlay: copy CE first, then overlay EE, run Knex pointing at the temp dir
- Nothing is written inside the repo, avoiding accidental commits or duplication

How it works
- `server/knexfile.cjs` now honors `MIGRATIONS_DIR` (defaults to `./migrations`)
- New helper: `server/scripts/run-ee-migrations.js`
  - Creates a temp directory under your OS tmp
  - Copies `server/migrations` into it
  - Overlays `ee/server/migrations` on top (EE overwrites on filename conflicts)
  - Runs `npx knex migrate:latest --env migration` with `MIGRATIONS_DIR` pointing to that temp dir

Prerequisites
- Local DB reachable based on `server/.env`
- Node 20+, repo dependencies installed

Commands
- From repo root: `npm -w server run migrate:ee`
- Or from `server/`: `npm run migrate:ee`

What the script does
- Uses the `migration` environment from `server/knexfile.cjs` so migrations run with admin credentials
- Leaves the temp directory in place for inspection; the script prints its path

Rollback or targeted steps (optional)
- Today, the helper runs only `migrate:latest`
- If you need down/targeted steps, two options:
  1) Re-run the script to produce a fresh merged temp dir, then run Knex manually against it:
     - `NODE_ENV=migration MIGRATIONS_DIR=/path/to/temp/migrations npx knex migrate:down --knexfile server/knexfile.cjs --env migration`
     - Or specify a particular file with `migrate:up <file>`/`migrate:down <file>`
  2) Ask to add `migrate:ee:down`/`migrate:ee:up <file>` wrappers; we can extend the helper to support those flows

Do not commit merged migrations
- Never copy the merged/overlay results into `server/migrations/`
- All merging happens in a temporary folder under the OS tmp

CI/CD vs local
- CI/CD images still combine/overlay migrations during build/entrypoint as before
- Locally, use the temp-dir approach to avoid churn in version control

Troubleshooting
- Ensure `server/.env` contains correct DB host/user/password for the `migration` env
- If you need to inspect what ran, open the printed temp path
- If `npx knex` fails, run the command it prints with `--debug` for more detail

Files involved
- `server/knexfile.cjs` (supports `MIGRATIONS_DIR`)
- `server/scripts/run-ee-migrations.js` (temp overlay + invoker)
- `server/package.json` → script `migrate:ee`

