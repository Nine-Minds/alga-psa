# Microsoft Graph endpoint reality guard

Microsoft's published CSDL is the only source of truth here. There is no
hand-maintained endpoint list to keep in sync: `validate-endpoints.mjs`
discovers the Graph calls Alga actually makes, then resolves each one against
the pinned `v1.0` or `beta` model in `metadata/`.

What it checks:

1. every statically discoverable Graph call in `shared`, `packages`, `server`,
   `ee`, and `scripts` resolves against the CSDL for the version it targets;
2. every route served by the packaged and legacy test-harness Graph emulators
   resolves the same way, so the emulators cannot drift into fiction; and
3. the pinned metadata is younger than `metadata.maxAgeDays` in
   `endpoints.json`.

Run `npm run guard:microsoft-graph-endpoints`. It is offline, deterministic,
and has no package dependencies. `validate-endpoints.test.mjs` runs first and
asserts floors on how much discovery finds, so call sites disappearing from the
scan — rather than from the code — also fails the check.

Emulator route templates that interpolate a build-time literal (`${segment}` in
the recording/transcript loops, `${root}` for the mailbox roots) are expanded
from `PACKAGED_ROUTE_LITERALS`, not folded into `{id}` — a literal treated as a
key segment would either fail against a single-valued entity or bless fiction.
Adding a new interpolation, or rebinding an existing one, fails discovery with
the mapping to update.

## Staleness runs in two directions

- **Our code drifts.** A renamed, invented, or wrong-version path fails on the
  pull request that introduces it, because discovery feeds the CSDL directly.
- **Microsoft's surface drifts.** An endpoint we call being removed or moved is
  only visible after repinning the metadata. So the pin has an expiry: once it
  is older than `maxAgeDays` (90) the guard fails — it does not warn — and
  names the update command. A neglected pin becomes a red check within a
  bounded window instead of quietly passing forever.

`.github/workflows/microsoft-graph-metadata-refresh.yml` repins weekly and opens
a bump pull request. A repin that fails validation still opens that pull request
*and* fails the scheduled run, so an upstream removal produces two signals
rather than a quietly green job.

Pull requests opened with `GITHUB_TOKEN` do not trigger `pull_request`
workflows, so the bump branch pattern `chore/microsoft-graph-metadata-*` is in
the endpoint guard's **push** trigger; that is what puts a real guard result on
the bump PR. The job also needs *Allow GitHub Actions to create and approve pull
requests* (Settings > Actions > General) — without it `gh pr create` fails, the
run goes red, and the pushed branch is deleted so the next run retries cleanly.

The age gate is the backstop for that job dying silently.

## Updating the pin

```
npm run guard:microsoft-graph-endpoints:update   # add --ref=<sha> to pin a specific commit
```

It resolves `master` in `microsoftgraph/msgraph-metadata`, downloads both clean
metadata documents at that commit, rewrites the gzips, checksums, commit, and
`pinnedAt` in `endpoints.json`, then re-runs the full validation so a
Microsoft-side removal of an endpoint we use fails at bump time.

## Suppressions

`endpoints.json` carries a `suppressions` list, not a registry. Add an entry
only for a path static discovery cannot resolve, or a known CSDL-versus-routing
divergence, and always with a `reason`. A suppression that stops matching any
discovered call is reported as stale and must be deleted, so the list cannot
quietly outlive its purpose.

The validator deliberately checks API existence and version placement, not
permissions, filterability, throttling, or runtime response behavior.
