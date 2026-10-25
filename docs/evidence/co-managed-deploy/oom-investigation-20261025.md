# Co-managed development server OOM investigation — 2026-10-25

## Registered runtime verification, 10:26–10:28 UTC

The bounded runtime check **passes** on the repaired development process.
Production deployment and full guide acceptance remain blocked.

The board's 10:18 resume adopted PID `1722063`, started at 09:53 UTC.
Inspector source inspection confirmed that it still held the unpatched React
Flight destroy callback. Its authenticated navigation and ten reloads were
recorded as an unpatched control, not repair acceptance. After those checks,
Python's `os.kill(1722063, 15)` ended that stale child cleanly. The existing registered
supervisor logged status **0**, then started the replacement automatically.
No board registration, heap setting or production process was changed.

Replacement PID `1948132` started at **2026-10-25 10:26:02 UTC**, with Linux
start ticks `307035243`. Its cwd was this checkout's `server/`. Before the first
navigation, the runner recorded both PID and start time. It authenticated QA,
opened `/msp/tickets`, directly navigated to `/msp/tickets/customer`, clicked
the qualified shared-ticket link for `cfff4242-7962-4100-a54c-687eaa540500`,
and completed **ten hard reloads**. Every detail check waited for the actual
ticket title and Timeline and revalidated the populated QA session. The same
PID and start ticks were present at the end. No status-134 exit occurred in
this run. Inspector inspection of the replacement's loaded application bundle
found `retired.previous = null` and no original unpatched destroy callback.

| Sample | heapUsed, bytes | heapTotal, bytes | heapLimit, bytes | RSS, bytes |
| --- | ---: | ---: | ---: | ---: |
| Before navigation, 10:26:48 UTC | 612825440 | 661917696 | 4345298944 | 1358045184 |
| After authenticated sequence, 10:27:01 UTC | 1334471656 | 1390698496 | 4345298944 | 2826924032 |
| After reload ten, 10:27:36 UTC | 1528928080 | 2066726912 | 4345298944 | 2882293760 |

These are live V8/process measurements, without forced garbage collection.
Cold route work is included. This bounded check does not establish long-term
heap stability, exclude other leaks, or quantify the repair's causal effect
against an equally warmed control. Inspector access was enabled briefly with
SIGUSR1, used for numeric samples and loaded-source inspection, and closed.
Port 9229 was confirmed closed afterward.

Raw evidence is under
`/tmp/alga-smoke-evidence/co-managed-it-20261025-current/`:
`desk-browser.json`, `desk-heap-series.json`, `desk-pid-start-proof.json`,
`desk-loaded-patch.json`, `desk-dev-child-replacement.json`, `desk-*.png`,
and `desk-videos/`. The earlier process's results remain in
`adopted-unpatched-control/`. `desk-playback.json` records the actual new
48.44-second dev recording seeking to 40.000 seconds, displaying that frame,
then playing to 40.506 seconds; `desk-playback-seek-frame.png` captures it.
This single dev clip does not fulfill fourteen production guide scenarios.

Run receipts and the exact scripts are retained there. Relevant invocations
(output redirection omitted) were:

```sh
ss -ltnp '( sport = :3374 )'
ps -p 1722063 -o pid,ppid,lstart,etime,rss,args
node /home/robert/.alga-xo/scripts/ensure-test-login.mjs /home/robert/alga-copies/feature-co-managed-it
node /tmp/alga-smoke-evidence/co-managed-it-20261025-current/desk-runtime-proof.cjs
node /tmp/alga-smoke-evidence/co-managed-it-20261025-current/desk-loaded-patch.cjs
# The validated Python preparation sent os.kill(1722063, 15) between runs.
node /tmp/alga-smoke-evidence/co-managed-it-20261025-current/desk-runtime-proof.cjs
node /tmp/alga-smoke-evidence/co-managed-it-20261025-current/desk-loaded-patch.cjs
node /tmp/alga-smoke-evidence/co-managed-it-20261025-current/desk-auth.cjs
node /tmp/alga-smoke-evidence/co-managed-it-20261025-current/desk-playback.cjs
ss -ltnp '( sport = :9229 )'
```

The proof runner discovers the listener PID through `ss`, reads `/proc/PID/stat`
and `ps` before navigation, sends SIGUSR1, and reads `process.memoryUsage()`
and `v8.getHeapStatistics().heap_size_limit` through the local inspector. Its
finally block closes the inspector. The loaded-source reader ran while that
connection was available. The commands above were separate calls, with the
supervisor's ordinary replacement allowed to finish before the second run.

### Authentication and production boundary

On `http://feature-co-managed-it.localhost:3374`, isolated Chrome contexts
passed the same CSRF/credentials callback protocol used by Open Review. QA
authenticated as `qa@emeraldcity.oz` in tenant `24ac76c8`; fresh Alice login
selected tenant `1f98df77-cd15-44c2-8f4d-42ff52d01e84`. Both sessions survived
native ticket-list reloads. Response statuses and cookie names/attributes are
in `desk-auth.json`; cookie and token values were omitted. The successful
proof scripts made no account or grant changes. An earlier failed QA login
required the explicitly authorized `ensure-test-login.mjs` environment repair,
which changed QA's password before these proofs. Alice's account was unchanged.
This is direct development-origin protocol proof, not a new successful board
Open Review invocation or production auth acceptance. An exploratory CLI call
with `workflow-open-review --help` timed out; this CLI dispatches that verb
instead of treating `--help` as documentation. It has no successful result in
this run and is not counted as proof.

Canonical production port 23374 still serves `cd28aa9531f7` /
`build-1792904848073`; port 23377 remains `704fbdca2532` /
`build-1792910542349`. No production launch or registration was attempted.
The binding startup restriction is:

> You may NOT force-start the production review app on 23374: it is admission-gated by the captain's 19:08Z order (he starts it after normal admission).

No fresh admission grant or refusal was obtained. This quotation is the
captain-controlled startup restriction, not an invented board refusal.
Production deployment remains pending normal admission and registration.

### Acceptance limits

Fresh metadata in `desk-runtime-matrices.json` lists the outstanding production
matrices individually. `desk-video-coverage.json` has fourteen BLOCKED
current-production guide rows with each missing recording/playback obligation.
The guide renderer produced blocked scaffolds in `desk-current-guides/`.
Historical 704f recordings remain **PARTIAL** and were not relabelled. Available
development navigation/auth checks do not discharge complete capability,
privacy, provider, finance, departure or recovery matrices.

The source census was regenerated from this checkout without importing prior
candidate facts. It still contains 260 IDs: 258 implemented-unverified and two
blocked-external portions. The readiness verifier exits 1 with all three
readiness predicates false. Source presence and this bounded proof do not
promote whole requirements. The thirteen focused ancestry/prepare-only tests
pass. Server typecheck was not rerun in this evidence-only follow-up.

The four recent documentation/media-only updates are consolidated with the
final ancestry-repair commit. The prepare-only launcher, its tests and the
ancestry repair remain three separate tooling patches in their original order;
their non-documentation contents are verified unchanged. Parent rethreading
necessarily changes descendant commit IDs. The tested runtime revision remains
`2b2ec93cf804c59dc6eaf56cdccc4a8c6003b389`; a later publication must not be
presented as a new application runtime test.

## Finding

The 08:42:41 UTC failure was a V8 heap exhaustion in the registered dev server,
not a supervisor failure. The supplied GC log identifies PID `374983`: the last
scavenge reported 3,865.8 MiB used, the mark-compact reduced 3,872.6 MiB to
3,845.0 MiB, and V8 then reported `Ineffective mark-compacts near heap limit`.
The child exited with status 134. A clean Node 22.18.0 process in this
environment reports a default V8 heap limit of 4,345,298,944 bytes (about
4.05 GiB). The registered launch command had no `NODE_OPTIONS`; its effective
limit therefore matched the default.

The registered service was `dev-server:24`, with the board wrapper executing
`scripts/dev/run-co-managed-dev-server.sh`. At the later read-only observation,
the supervisor had spawned PID `1209788`, started 2026-10-25 04:42:41 local
(08:42:41 UTC). It was at 2,886,696 KiB RSS, 79,869,696 KiB virtual size, and
9,372,072 KiB RSS high-water mark. Its argv was Node 22.18.0 with the repository
`tsx` loader and `dev-server.ts`; its environment contained no `NODE_OPTIONS`.
These are post-recovery observations, not measurements of the crashed PID.

## What the evidence establishes

- The qualified ticket detail server action returned HTTP 200 in the dev log
  immediately before the OOM report. The navigation exposed the exhaustion;
  this does not show that the detail route caused it.
- The GC trace shows a large live V8 heap that one full collection reclaimed by
  only about 27 MiB. It does not identify which objects were retained.
- The development launcher starts Next directly through `dev-server.ts` and
  skips Nx's production-build dependency chain. This makes a production build
  launched by `npm run dev` an unlikely cause, but does not rule out Next's
  development compilation or compiler caches during ordinary requests.
- No heap snapshot, per-interval heap series, compilation trace tied to PID
  `374983`, or subscription count was captured. The evidence cannot distinguish
  development compiler retention from application retention or repeated
  subscriptions. No route-specific leak is established.

## Follow-up observations

### Earlier noncanonical-origin attempt (2026-10-25 09:37–09:39 UTC)

The first isolated headed Playwright attempt used `/usr/bin/google-chrome` at
`http://127.0.0.1:3374`, not the configured hostname. Login did not establish a
session. It opened the qualified URL once cold and ten more times without
authentication; those route-shell observations remain explicitly
**unauthenticated** and are not protected-detail acceptance. The original result
is preserved at
`/tmp/alga-smoke-evidence/co-managed-it-20261025-current/isolated-playwright-result.json`.

Its timestamped RSS and anonymous-PSS samples are in
`isolated-playwright-memory.jsonl`. They all name PID `1209788` with start ticks
`306415196` (08:42:41 UTC). Earlier samples of this child were 4,317,528 KiB
RSS at 09:33 UTC, 4,432,744 KiB at 09:34:26, 4,460,588 KiB at 09:35:41,
4,378,992 KiB at 09:37:40, and 4,389,460 KiB at 09:38:02. The unauthenticated
cold route sample at 09:38:41 was 4,703,616 KiB; later route-cycle RSS peaked
at 4,878,484 KiB and ended at 4,782,768 KiB at 09:39:10. Those RSS/PSS values
are not V8 heap measurements.

### Canonical-origin QA run (2026-10-25 09:42:56–09:46:41 UTC)

A fresh isolated headed Chrome context opened the configured
`http://feature-co-managed-it.localhost:3374` origin directly. Normal credential
login returned to `/msp/dashboard` on that same origin. The credentials POST
returned 200 with redirect path `/msp/dashboard`; `/api/auth/session` returned
200 with `hasUser=true` and `email=qa@emeraldcity.oz` before protected routes
were visited. The tenant identifier field was absent from this session shape.
Cookie values were not retained: sanitized metadata records the host-only
`feature-co-managed-it.localhost` domain, `/` path, HttpOnly and SameSite=Lax
attributes, and the port-scoped `authjs-port-3374.session-token` issuer. The
response also carried the expected port-scoped CSRF/callback cookies. The
canonical result is
`/tmp/alga-smoke-evidence/co-managed-it-20261025-current/canonical-origin-playwright.json`.

The browser rendered the native list (`/msp/tickets`, title `Tickets`), then
Customer Tickets (`/msp/tickets/customer`, title `Customer Tickets`), then the
exact qualified detail route. The Customer Tickets sidebar item was hidden in
the collapsed Tickets submenu, so that transition used direct navigation rather
than a UI click; click-through is not claimed. The cold detail rendered the
shared ticket heading and substantive body. Ten `page.reload()` attempts then
kept the exact detail URL and page title. However, the script captured the body
only 1.2 seconds after DOMContentLoaded and its original `hasContent` check was
too weak: six snapshots were only 336–376 characters, while four were full
detail-sized. The result file corrects that flag and marks per-reload content
verification false. Thus the authenticated flow and cold detail rendered, but
ten reloads with confirmed ticket content did **not** pass.

The same registered child remained PID `1209788` with start ticks `306415196`
throughout the run. `/tmp/alga-smoke-evidence/co-managed-it-20261025-current/isolated-playwright-memory.jsonl`
retains the earlier unauthenticated RSS/PSS series; the canonical run has its
own timestamped RSS/PSS samples in the result JSON. During the canonical flow,
RSS was 4,683,240 KiB before browser work, 5,049,552 KiB at the native list,
5,325,340 KiB at Customer Tickets, 5,540,896 KiB on cold detail, and peaked at
5,729,616 KiB before reload 10. The last reload sample was 5,658,508 KiB RSS.
RSS is not heap usage, and these request-sample changes alone do not establish a
leak.

At 09:46:41 UTC, a short-lived local Node inspector read from that same child
reported `heapUsed=3,857,812,568` bytes, `heapTotal=4,215,599,104`, default
`heapLimit=4,345,298,944`, and `totalAvailable=409,744,616` bytes; RSS was
`5,183,705,088` bytes. V8 also reported 535 native and zero detached contexts.
The probe is saved at
`/tmp/alga-smoke-evidence/co-managed-it-20261025-current/canonical-origin-v8-probe.json`.
Inspector access was enabled only for this read and closed afterward; port 9229
was confirmed closed. The live heap was close to its default limit, but this
single sample has no pre-navigation heap baseline and does not identify which
objects are retained. Do not treat context counts as proof of a leak.

The supervisor log records repeated status-134 exits at 02:29:53, 04:01:49,
06:42:34, and 08:42:41 UTC. Its append-only request log has 1,069 qualified
route POSTs after the last restart and no compile event after that restart; the
log has no per-request timestamps or child-PID attribution. This makes a
current development-compile event an unlikely explanation for the memory
measured during the latest route run, but does not prove application retention:
other sessions and calls are not separable in this log. Source review found the
shared detail screen performs one initial conversation load, has no recurring
poll timer, and bounds conversation pagination at 40 pages. That narrows the
visible detail-screen subscription hypothesis but cannot rule out lower-level
retention or another caller. No retaining component is established.

## Repair and verification boundary

The builder observations did not justify a heap increase, cap change, or
application change. The later takeover below establishes a development-tracker
retention defect and adds a scoped source repair; it does not raise the heap. The 3 GiB `workflow-resource-holds` entry belongs to the agent's
`Draft Implementation` **run** reservation; it is now settled with zero
counting memory. It is not the application service reservation. The registered
service listing provides no separate application memory reservation, so that
admission limit cannot be inferred from the run's 3 GiB. The process's measured
RSS is not a reservation either. Raising the heap without a service-admission
limit or authenticated bounded-memory evidence would make the risk less
controlled, not establish a repair. Keep the runtime proof pending until a
board-admitted, normally restarted child exposes heap metrics and passes the
authenticated sequence plus ten repeated detail navigations with the same PID
and start time.

Raw evidence is retained outside the checkout at
`/tmp/alga-smoke-evidence/co-managed-it-20261025-current/` (`REPORT.md`,
`dev-oom.log`, `runtime.json`, `services.json`, and browser recordings). The
registered supervisor log is `.card-service-logs/dev-server.log`; it is local
runtime output and is not committed.

## Auth candidate preparation

The source tree contains the already reviewed auth repairs: port-scoped
development cookies (`456973ffc9`), canonical cookie issuer/reader naming and
JWT salt (`67c8fb5d10`), and inactive restored-account handling
(`2c3f487bad`). Production runtimes remain distinct: `23374` serves
`cd28aa9531f7` / `build-1792904848073`, `23377` serves `704fbdca2532` /
`build-1792910542349`, `23375` serves `2192c83e0ae7`, and `23376` serves
`cd28aa9531f7`. These auth repairs are source-only on all of them.

The earlier registered build-only result remains preserved:
`4ec8da91eb955b2f50f153b042b8c4aa9f88d46b+da39a3ee5e6b`, distribution
`server/.next-review-co-managed-4ec8da91`, build ID `build-1792918451442`.

The final prepared source snapshot is `71fd898d2652dab09822f57f45be98d0eebbb300`
with source fingerprint `da39a3ee5e6b`. Its exact isolated artifact is
`server/.next-review-co-managed-71fd898d`, stamp
`71fd898d2652dab09822f57f45be98d0eebbb300+da39a3ee5e6b`, build ID
`build-1792919755762`. Registered build-preparation service
`review-build-prep-71fd898d` passed server typecheck and production Webpack build,
checked the source snapshot around the build, printed that application startup
was skipped, and was concluded. Port 23379 did not listen. This runtime source
identity is not a guide-publication SHA; no current-build guide publication or
recording was produced. The artifact is **prepared but undeployed and
unverified**. The docs/test follow-up changes the checkout after 71fd, so the
artifact must not be stamped as the follow-up HEAD. Do not rebuild merely to
update this investigation. To deploy the current committed repair revision,
normal board registration/admission must run the launcher for the canonical
`review-app` service on port 23374, prepare a fresh isolated distribution from
that exact HEAD (without writing into any served distribution), then promote it
through the service registration. After startup, verify the served stamp/build
and rerun direct QA Open Review, fresh Alice login/navigation/reload, ambiguous
active-tenant failure, and cookie coexistence. Those startup and runtime steps
remain outstanding under the no-start restriction.

Focused source checks passed: 24 auth tests across tenant-scoped credential
selection, inactive restored duplicates, cookie naming, and JWT salt. A root
`tsc --noEmit` also exited successfully; the authoritative script's server
typecheck and production build both passed. Supported Open Review, fresh Alice
login, fail-closed active-tenant ambiguity, and port-scoped cookie coexistence
remain pending on the repaired canonical runtime. The current isolated Chrome
attempt did not authenticate QA and did not exercise Alice. Multiple matching
active tenants, native list → Customer Tickets → authenticated qualified detail,
and ten authenticated detail reloads remain unverified. The no-start boundary
also leaves deployment and normal board admission outstanding. The remaining
PLAN matrices—multipart admission, Microsoft OIDC/provider/inbound/replay,
customer capability and authorization boundaries, ticket/task audiences and
revocation, attachment disclosure, independent SLA, operational/commercial time,
approvals/invoicing, departure, export/restore, and paid recovery—remain **Not
run**, **Blocked**, or historical-only at their existing evidence status.
Historical 704f, cd28, and e88 recordings retain their original revisions and
partial status; none is evidence for the 71fd artifact. All fourteen full
repaired-build guide scenarios, embedded playback, range delivery, and chapter
seeking remain outstanding.


## Lead takeover: retention owner and source repair

At 09:53:16 UTC the existing child `1209788` again exhausted its heap and exited
134, during QA native-list navigation. An explicit diagnostic collection had
left 3,983,837,696 heap bytes alive. The existing supervisor restarted it;
no application start or restart command was issued. This shows that exhaustion
can surface on native routes too, without establishing where earlier allocations
originated.

The recovered child `1722063`, start ticks `306838706`, completed the canonical
QA login, native list, **visible callout link** into Customer Tickets, actual
qualified ticket link, and ten hard reloads. Every reload waited for the ticket's
visible body text and Timeline, then rechecked the populated QA session. The
child identity remained constant. This bounded navigation check passes; the
memory stability requirement does not. Cold-flow heap after diagnostic GC grew
from 925,661,712 to 1,331,360,120 bytes. A separate warmed ten-reload run grew
from 1,393,167,136 to 1,546,049,488 bytes after collection. These are V8 heap
measurements, not RSS. See [numeric navigation receipts](oom-takeover-20261025/recovered-navigation.json)
and [warm control](oom-takeover-20261025/warm-navigation.json).

A private 1,386,705,640-byte heap snapshot completed at 10:02:30 UTC without a
child restart. Traversal from React Flight's development `pendingOperations`
map reached 9,764,892 nodes with 422,966,376 shallow bytes, even excluding code,
closures, hidden nodes and object shapes. This is reachability, not exclusive
dominator retained size. The graph includes `previous`/`awaited` ancestry and
WeakRef-bearing operation records. Sampling profiles also identify React's
async-hook tracking. The same mechanism is described in
[React issue 36836](https://github.com/react/react/issues/36836): removing a live
map entry leaves its old ancestry reachable through newer metadata nodes.
The issue is unconfirmed upstream; the local measurements and regression are
our evidence, rather than assuming that the issue establishes our diagnosis.

Two controls narrowed the repair: clearing eight unconnected Next debug streams
released only about 20 MB, and temporarily disabling Node source maps did not
stop growth. Neither is shipped as the fix. Source-map settings were restored,
VM diagnostic wrappers removed, and inspector port 9229 closed. Heap snapshots
and raw allocation profiles remain private because they may contain application
data. Only sanitized numeric receipts are committed.

`scripts/lib/patch-next-flight-debug.cjs` now prunes a destroyed operation's
`previous` and `awaited` references before removing its map entry. Its own frame
and newer live nodes remain intact; older development async ancestry is dropped.
The existing postinstall entrypoint invokes it after patch-package. It validates
Next **16.3.8** and all twelve expected development bundle callback shapes
before writing, is idempotent, and fails closed on an upgrade. Production bundles
are not targets. The dev-only tracing tradeoff is deliberate; this is not a
change to business authorization, transaction behavior or the V8 heap limit.

The regression extracts the actual bundled React hooks. A real 12,000-iteration
long-lived async workload leaves 6,001 live entries in both arms, but the old
destroy policy retains 72,002 ancestry nodes versus 6,001 with pruning. A no-op
repair counterfactual also fails the deterministic chain and frame tests.
Thirteen launcher/tracker tests pass; installation and all eight patched
next-server bundle syntax checks pass. Server `NODE_OPTIONS=--max-old-space-size=12288
npx tsc --noEmit` exited 0 on the takeover tree. See [heap findings](oom-takeover-20261025/heap-findings.json)
and [test output](oom-takeover-20261025/tooling-tests.txt).

The development measurements above are bounded verification only: authenticated
reload runs showed heap growth, and long-term memory stability remains unproven.
They do not establish production memory behavior. The React Flight ancestry patch
is limited to Next development bundles; it did not change production bundles.

## Repaired production proof (2026-10-25)

After the earlier takeover notes, the admitted isolated production candidate
completed server typecheck and production build without changing the frozen
source checkout. Its full runtime source SHA is
`c04a67fff5b553d2c2a1f55a14194f829343adae`; the distribution fingerprint is
`da39a3ee5e6b4b0d3255bfef95601890afd80709`, the revision stamp is
`c04a67fff5b553d2c2a1f55a14194f829343adae+da39a3ee5e6b`, and `BUILD_ID` is
`build-1792926045353`. Candidate port 23378 and promoted canonical port 23374
were HTTP-ready. The serving children used the server CWD and the isolated
`.next-review-c04a67-production` distribution. See the co-located runtime and
worker receipts for process identities, start times, source/build provenance,
and readiness checks.

Fresh isolated production browser sessions proved Alice selected the original
active customer tenant `1f98df77-cd15-44c2-8f4d-42ff52d01e84` despite inactive
restored duplicates, then retained a populated session through native All
Tickets, Customer Tickets and hard reloads. Fresh QA navigated native All
Tickets, shared Customer Tickets and qualified shared detail with reload
persistence. Supported `workflow-open-review` independently opened the promoted
canonical app directly as `qa@emeraldcity.oz`. The sanitized browser receipt is
private at `/home/robert/card-review-private/co-managed-it-3363/production-c04a67-auth-smoke.json`;
no credentials or cookie values are retained in repository evidence.

This proof supersedes the stale deployment-pending statements in earlier
preparation notes; it does not supersede the historical runtime evidence or
claim complete acceptance. The 260-ID census remains unaccepted except for
explicitly evidenced checks. The remaining PLAN matrices and fourteen full
current-build walkthroughs remain incomplete. Historical 704f, cd28 and e88
recordings retain their original provenance and partial status. No changes were
made to accounts, passwords, hashes, tenant state, roles or grants.
