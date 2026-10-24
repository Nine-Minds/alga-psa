# Co-managed readiness reconciliation — October 24

**Whole-card readiness is still false.** The old packet was stale, but a fresh
packet cannot establish the missing acceptance evidence. This run fixes two
local implementation gaps, regenerates the complete inventory and leaves the
gate's requirements intact. It does not certify Implement complete.

Source candidate: `1c27c97496cb094397349fe4a584df3a93643eca`. Host:
`robert-Desktop-AMD-Ryzen-AI-Max-300-Series`. Worktree:
`/home/robert/alga-copies/feature-co-managed-it`, branch `feature/co-managed-it`.
The host's configured Robert Isaacs identity was used without overrides.

## Exact verifier results

The following files preserve stdout byte-for-byte, including the CLI's
40-reason display limit. The JSON outputs contain **every** reason, without
truncation.

| Invocation | Before | After | Exit |
| --- | --- | --- | --- |
| `node scripts/verify-co-managed-completion.mjs` | [Exact stdout](before/verifier.txt) | [Exact stdout](verifier-after.txt) | 1 both times |
| `node scripts/verify-co-managed-completion.mjs --json` | [Full output](before/verifier.json) | [Full output](verifier-after.json) | 1 both times |

| Result | Before | After |
| --- | --- | --- |
| Candidate | `353786ce9168cf813f2ed0219018024b263ca354` | `1c27c97496cb094397349fe4a584df3a93643eca` |
| Requirement rows | 193 | 260 |
| Missing required IDs | 67 | 0 |
| Statuses | blocked-external 3; failed 2; implemented-unverified 104; missing-code 82; verified 2 | blocked-external 2; implemented-unverified 258 |
| Implementation blockers | 263 | 258 |
| Human-review blockers | 7 | 15 |
| Production blockers | 6 | 5 |
| All three readiness predicates | false | false |

The increase in human-review blockers is intentional: the current census does
not import old PR/CI/config/runtime facts as current observations. Those fields
are explicitly unknown. It does not query GitHub, inspect CI, resolve conflicts
or start a runtime to fill them in.

Regeneration command:

```bash
node scripts/build-co-managed-inventory.mjs \
  --out docs/evidence/co-managed-completion/81fe5d58c8
```

Collection exits 0: all required IDs and referenced files are present. This is
**collection success**, distinct from acceptance. The readiness command still
exits 1. Original manifest/inventory files are preserved under [before/](before/).
No manifest was hand-edited and no readiness rule was relaxed.

## What matches the branch

The exact approved set contains **260 IDs, 260 unique, 0 missing, 0 substituted,
0 duplicate and 0 unknown**. The rendered inventory now includes the native
ticket-screen plan's 37 features and 14 tests, which were previously missing
from its Markdown sections as well as the old manifest.

All source/test references exist: **104 distinct files**, with every recorded
SHA-256 compared against the file in the candidate's git tree. This proves ID
and reference integrity. It does not prove that every composite requirement is
fully implemented or accepted. False plan flags are retained as `planImplemented`
in the census; locating source does not turn them true or mark a row verified.

The old 82 `missing-code` classifications included historical assessments and
superseded requirements. They were not evidence that 82 implementations were
absent today. The default generator now performs a current source census rather
than replaying those assessments. Historical generation remains available with
`--historical`; it is not the default. Ticket-list IDs affected by the approved
October 14 amendment retain their identity and point to that amendment.

## Runtime actually exercised

- The collision test ran through the real co-managed policy/query services
  against a newly created disposable PostgreSQL database cloned schema-only
  from `server_co_managed`. Its fixtures and mutations did not modify the source
  database or review fixtures. The harness retains its existing external-adapter
  doubles.
- The Microsoft tests ran an ephemeral localhost emulator and real Auth.js
  handlers with signed browser cookies, discovery, token exchange and session
  creation. They use the same emulator-provider builder injected into the
  application's auth options. They do **not** exercise the deployed Alga app,
  its database account-linking/customer-tenant selection, or a live Microsoft
  tenant.
- No review app, deployed worker, authenticated Alga walkthrough, CI run,
  conflict resolution, merge or review recording was exercised or claimed.

## Isolation mutations

Both mutations removed actual admission, not an assertion or mock:

1. Bypass foreign-customer summary admission. The test fails because the summary
   resolves with **Sibling confidential issue**, instead of rejecting.
   [Exact failure](logs/foreign-read-admission.txt).
2. Bypass foreign-customer update admission. The test fails because the forbidden
   callback executes and returns **Unauthorized overwrite**.
   [Exact failure](logs/foreign-write-admission.txt).

Both mutations exited 1 for the expected assertion, then the restored source
passed the same PostgreSQL test. [Restored result](logs/restored.txt).
The test therefore does not pass with the tested boundaries removed.
[Mutation results](mutation-results.json), [exact patches](mutation-patches.json)
and [reproduction script](reproduce-isolation-mutations.py) are included. The
script expects the documented local environment to have been loaded and creates
only disposable test databases.

An additional mutation removes ID-token verification from the new OIDC provider.
All three forged-token rejection cases fail; restoring verification passes.
[Failure](logs/oidc-id-token-verification.txt),
[restored result](logs/oidc-restored.txt).

## Implementation gaps repaired

**CF007 / CT008, local protocol implementation.** Microsoft emulation previously
ran as plain OAuth, removed nonce verification and emitted unsigned ID tokens.
It now publishes Entra discovery/JWKS, signs RS256 ID tokens, enforces S256 PKCE,
binds codes to their authority and original user, and denies code replay. The
application's explicit nonproduction emulator branch uses OIDC with state,
PKCE and nonce. It verifies signature, issuer, audience, algorithm and expiry
through `jose` before Auth.js completes the callback. The existing production
lock remains in force.

Tests cover discovery, signed claims, wrong issuer/audience/signature, missing
or wrong PKCE, replay, cross-authority redemption, user changes during a pending
authorization, and real Auth.js success versus state/nonce rejection. The full
Alga customer/account-linking journey remains unaccepted; these protocol tests
are not relabeled as that broader evidence.

**T01 / product boundary.** `/msp/account` renders subscription management, but
co-managed customers have no account-management permission. The route registry
nevertheless admitted it. The route now explicitly denies co-managed access,
including child paths, while retaining PSA/AlgaDesk access, customer profile and
the separate `/msp/co-management/upgrade` flow. The old permission-gap exception
was removed. No commercial permission was granted and no migration was needed.

## Remaining requirements and why they are not accepted

The [complete per-ID list](../remaining-acceptance.md) names **every** approved
ID, its exact requirement, specification path, implementation paths, regression
paths and remaining obligation. [Machine-readable record](verification.json)
contains the same 260 entries. There is no hidden remainder behind a truncated
summary.

There are 258 in-card rows without full current-candidate acceptance and two
externally owned real-provider portions (`clientIntegration:T018` and `T019`).
This is not a claim that 258 implementations are missing. The available local
proof cannot honestly accept all of their required scenarios.

Specific limits that prevent an overall pass under this order include:

- `CF002`, `CT002`, `CT005`, `CF029`, `CT025`: their original-order/shard or
  mandatory exact-candidate CI obligations cannot be completed because this
  order expressly prohibits CI. Local service/protocol results do not replace
  those executions.
- `CF027`, `CF031`, `CT023`, the final actual-candidate portion of `CT026`, and
  `nativeTicketScreen:T014`: require the current application/worker walkthrough,
  stability or recorded review packet. Review recording is prohibited and no
  deployed Alga runtime was tested here.
- `CF007`/`CT008`, `CF008`/`CT009`, `CF016`/`CT014`: protocol and service tests
  do not establish actual Alga account/tenant binding, configured vendor-event
  consumption or hydrated team-picker/timesheet usability. Their remaining
  application journeys are named individually in the list.
- `CF026`/`CT022`: a PostgreSQL schema-clone test does not establish fresh and
  populated Citus upgrades or distributed mutation invariants. Those specific
  executions were not performed; no DDL change in this round can manufacture
  that evidence.
- `CF022`–`CF025`, `CT018`–`CT021`: normal application purchase/license/restore/
  deletion acceptance must be exercised as specified. Existing service code and
  local tests are partial proof. Real payment, license issuance and deployed
  storage acceptance also require their named release owner.
- Client/list presentation and return-navigation requirements, including
  `clientIntegration:T018`–`T021`, `ticketList:T019` and the related correction
  rows, still need their specified role, locale, theme, layout and navigation
  observations. A source scan or a component-test count cannot certify them.

All other remaining rows are explicitly enumerated with their particular
obligation. No false flag, missing proof, vendor dependency or superseded design
was silently converted into a pass. The current source-only manifest therefore
has no verified rows; its refusal is the honest result, not a request to weaken
the gate.

## Checks

| Command / check | Result |
| --- | --- |
| Canonical PostgreSQL collision test, two boundary mutations, then restored | Expected red/red/green |
| `cd server && VITEST_SEED=20260610 npx vitest run src/test/unit/product` | 105 files, 799 tests passed |
| `cd packages/auth && npx vitest run` | 56 files, 277 tests passed |
| `cd packages/emulators/msgraph && npx vitest run` | 10 files, 105 tests passed |
| Three co-managed Node tooling test files | 71 tests passed |
| ID-token verifier mutation and restored OIDC tests | Expected red/green |
| `npx tsc --noEmit` in server, auth and Microsoft emulator, with 12 GB heap | Passed all three |
| `npm run build` in auth and Microsoft emulator | Passed both |
| Inventory regeneration | Exit 0, 260 rows, no collection failures |
| Completion verifier before/after | Exit 1 both; readiness false |

See [command records and original log hashes](verification.json). Test/build logs
normalize terminal whitespace and redact synthetic test JWT strings. Original log hashes remain recorded. GitHub push protection rejected the first publication because of those synthetic tokens; the unpublished packet was corrected without a bypass. The exact verifier outputs are untouched.
The previously accepted full 1,459-case database run was not relabeled as a new
run; this follow-up reran the actual collision test for its mutations. Untracked
`docs/guides/` and `server/.next-review/` were preserved.
