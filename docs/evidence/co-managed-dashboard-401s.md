# Every 401 on `/msp/dashboard`, accounted for individually

Review app `http://100.82.172.57:3374`, branch `feature/co-managed-it`, signed
in as the sponsoring-MSP admin `cm.msp.admin@oz.test` (Oz tenant
`569e72fc-52d9-4ce2-838e-a34ea8cf2f9f`).

**Outcome: 28 console errors, one URL, one cause, one defect, one fix.** Every
`401 (Unauthorized)` resource error on the MSP dashboard came from
`GET /api/notifications/live-token`. It is a session-authenticated route that
this branch added (`d4b67b9143`) without adding the matching middleware
exemption, so the edge API-key gate rejected it before its handler ever ran.
Two shell-level mounts of `useInternalNotifications` each retried it on an
exponential-backoff ladder, which is how one broken URL becomes a two-digit
error count. After the fix the dashboard emits **zero** 4xx/5xx and **zero**
console errors over a four-minute dwell.

Nothing here was benign. There is no residual 401 to excuse.

Tracing that gate turned up two further routes this branch adds that it blocks
the same way — the co-managed portal attachment download and the meeting
artifact download. Both were dead behind the edge; both are fixed here too, and
both are written up in section 7 with their authentication proof.

## 1. Raw capture, before the fix

Captured with `alga-dev browser-get-network` / `browser-get-console` on the
pane driving the review app. Four independent dashboard loads were recorded;
all four produced the same single URL and nothing else.

Reload plus a 25-second dwell (`net1`, events after the last `/msp/dashboard`
document — 149 requests total):

```
  t+  0.9s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  0.9s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  1.9s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  1.9s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  3.9s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  3.9s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  8.0s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+  8.0s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+ 16.0s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
  t+ 16.0s  GET http://100.82.172.57:3374/api/notifications/live-token -> 401
```

Per-load 401 counts across the session, grouped by the `/msp/dashboard`
document that preceded them: **8, 8, 8, 10** — the difference is dwell time,
not page state. The `/auth/msp/signin` document in the middle of that session
produced **0**.

The console side of the same session buffer, which is the "28 console 401
errors" the work order reports:

```
41 errors total in the buffer
  37x  Failed to load resource: the server responded with a status of 401 (Unauthorized)
   2x  Failed to load resource: the server responded with a status of 500 (Internal Server Error)
   2x  [useActionPolling] Action failed; retrying in 30000ms AuthenticationError: User not authenticated
```

Every one of the 37 carries the same `sourceUrl`:

```
distinct 401 sourceUrls: {'http://100.82.172.57:3374/api/notifications/live-token'}
```

The two 500s and the two `useActionPolling` errors are **not** dashboard
errors and are not part of the 28: their timestamps fall before the
`/auth/msp/signin` document, in the window where this capture had deliberately
destroyed the session via `POST /api/auth/signout` while the dashboard was
still mounted. They are an artifact of how this evidence was collected, not
something a reviewer sees.

The body of every 401, read back from the page:

```
{"s":401,"b":"{\"error\":\"Unauthorized: API key missing\"}"}
```

That string is emitted by `server/src/middleware.ts:426`. It is the edge
middleware, not the route handler.

## 2. Why one URL produces 28 errors

Two things multiply.

**Two mounts.** The MSP shell mounts `useInternalNotifications` twice, and each
instance owns its own token fetch and its own reconnect loop:

- `server/src/components/layout/Header.tsx:589` → `NotificationBell`
  (`packages/notifications/src/components/NotificationBell.tsx:32`)
- `server/src/app/msp/MspLayoutClient.tsx:173` → `IncomingCallProvider`
  (`server/src/components/layout/IncomingCallProvider.tsx:19`)

That is why every 401 in the capture appears as an identical pair on the same
millisecond.

**Exponential backoff with a 30s cap.** `useInternalNotifications.ts:141`:

```ts
} catch {
  if (!disposed && attempt === generation) { schedule(delay); delay = Math.min(30000, delay * 2); void refresh(); }
}
```

`delay` starts at 1000, so attempts land at t+0, +1s, +3s, +7s, +15s, +31s and
then every 30s forever. Cumulative console errors as a function of how long the
reviewer leaves the tab open:

| dwell | attempts per hook | console 401s |
|---|---|---|
| 8s | 4 | **8** (measured: 8) |
| 25s | 5 | **10** (measured: 10) |
| 60s | 6 | 12 |
| 180s | 10 | 20 |
| **300s** | **14** | **28** ← the reported count |

The reported 28 is not a fixed number; it is this ladder observed after about
five minutes on the page. It grows without bound for as long as the tab stays
open.

## 3. The per-URL account

| URL | Method | Initiator (found in source) | Why it 401s | Verdict | Action |
|---|---|---|---|---|---|
| `/api/notifications/live-token` | GET | `packages/notifications/src/hooks/useInternalNotifications.ts:108`, mounted twice on the MSP shell via `NotificationBell` (`Header.tsx:589`) and `IncomingCallProvider` (`MspLayoutClient.tsx:173`) | Edge middleware `shouldSkipApiKeyAuth` did not exempt the path, so `server/src/middleware.ts:422-428` returned `{"error":"Unauthorized: API key missing"}` with no `x-api-key` header present. The route handler — which authenticates by session — never ran. | **Defect** | Fixed: exempted the exact path. |

That is the complete list. There is no second URL to classify and no benign
noise to defend.

### Why the middleware rejected it

`server/src/middleware.ts:399-430` gates every `/api/*` path except
`/api/auth/*` on the mere presence of an `x-api-key` header. The file warns
about this trap in its own header comment (lines 12-14) and again at the gate
(lines 403-404):

```
// Any session-authenticated `/api/*` route must be added here or middleware will return
// `401 Unauthorized: API key missing` before the route handler has a chance to run.
```

`/api/notifications/live-token` is exactly such a route. It authenticates from
the browser session and re-validates the session id itself
(`server/src/app/api/notifications/live-token/route.ts:10-14`, and
`issueNotificationLiveToken` in
`server/src/lib/notifications/notificationLiveToken.ts` re-reads the tenant,
the user row and the un-revoked `sessions` row under `FOR SHARE` before signing
a 60-second token). It carries no API key by design. The commit that
introduced it, `d4b67b9143` ("Replace cached notification rooms with
authenticated refresh signals"), added the route and the hook but not the
allowlist entry.

This is not the `release-v1-6-feature` flag gating an API path. The flag is not
involved: `grep` for `release-v1-6-feature` shows it only in UI components and
`storeOnlyAuthoringGate.ts`, and the live-token path is reached from the shell
regardless of flag state.

### Why the tests did not catch it

`ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts:6235`
imports the route module directly and calls `GET` on a hand-built `Request`.
That exercises the handler but bypasses `middleware.ts` entirely, so the route
passed its tests while being unreachable from a browser.

## 4. The fix

`server/src/middleware.ts` — one entry added to `exactApiKeySkipPaths`, the
list that exempts by exact path rather than prefix:

```ts
  // Notification live-stream token: the MSP shell and the client portal both
  // mint a short-lived Hocuspocus token from their browser session (no
  // x-api-key). The route re-checks the session and the session id itself, and
  // `/api/notifications` has no other route to exempt.
  '/api/notifications/live-token',
```

Exact rather than prefix matching is deliberate, and follows the reasoning
already written above that array for the Level.io entry: `/api/notifications`
has no other route today, and a prefix exemption would silently un-gate every
future `/api/notifications/*` route someone adds.

`server/src/test/unit/middleware.apiKeyAuth.test.ts` — two cases added next to
the existing ticket live-token case, mirroring the Level.io exact-match pair:

```ts
  it('allows the notification live token API to use browser session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/notifications/live-token')).toBe(true);
  });

  it('exempts the notification live token exactly, never a prefixed or deeper sibling', () => {
    expect(shouldSkipApiKeyAuth('/api/notifications')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/notifications/live-token-evil')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/notifications/live-token/mint')).toBe(false);
  });
```

```
$ cd server && npx vitest run src/test/unit/middleware.apiKeyAuth.test.ts
 ✓ src/test/unit/middleware.apiKeyAuth.test.ts (19 tests) 5ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

Those two files — plus this document — are the whole of this round's diff, for
this fix and for the two in section 7 alike. Nothing under `packages/` or
`shared/` was touched, so no package rebuild was required; Next recompiled the
edge middleware on save and the dev server (`dev-server:18`) was **not**
restarted and stayed healthy throughout.

Note for whoever reads `git diff server/src/middleware.ts`: the two lines
`pathname === '/api/ticket-comment-attachments/download' ||` and
`exactApiKeySkipPaths.includes(pathname) ||` also appear as additions, but they
are pre-existing unstaged worktree changes that were present before this round
began (the staged index copy is older than the worktree copy). The only line
this round added to that file is the `'/api/notifications/live-token'` entry and
its comment.

The route reached its handler immediately afterwards:

```
{"s":200,"b":"{\"token\":\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6Im5vdGlmaWNhdGlvbi1zaWduYWxzIiwidGVuYW50SWQiOiI1NjllNzJmYy01MmQ5LTRjZTItODM4ZS1hMzRlYThjZjJmOWYiLCJ1c2VySWQiOiIwNDg1ZmJiYS1mNjkzLTVmYWYtYWQ1Y"}
```

## 5. Raw capture, after the fix

Same pane, same session, fresh `/msp/dashboard` navigation, network and console
cursors taken immediately *before* the navigation and read back after a
**239-second dwell**. On the before-state ladder, 239 seconds is 12 attempts per
hook — 24 console 401s already logged and climbing toward the reported 28.

```
span s: 239.2   requests: 527
4xx/5xx total: 0
console errors: 0
```

`GET /api/notifications/live-token`, ten requests, all `200`:

```
[(0.9, 200), (0.9, 200), (55.6, 200), (55.6, 200), (110.6, 200),
 (110.6, 200), (165.6, 200), (165.6, 200), (221.6, 200), (221.6, 200)]
```

That cadence is itself the proof that the retry ladder is gone. The failure
path re-fires at +1s, +3s, +7s…; what is observed instead is a flat **55-second**
interval, which is the scheduled token renewal —
`schedule(Math.max(1000, access.expiresAt - Date.now() - 5000))` against the
60-second token minted by `notificationLiveToken.ts` — taken twice, once per
mounted hook. The pairing is unchanged because there are still two mounts;
they are simply no longer failing.

Console over the same window: **0 errors**, 69 warnings, none of which is a
401 or a resource error:

```
67x  i18next::backendConnector: No backend was added via i18next.use. Will not load resources.
 2x  WebSocket connection to 'ws://100.82.172.57:3374/hocuspocus?token=…' failed
```

The i18next warning is pre-existing dev-server noise unrelated to this branch.
The two WebSocket warnings are covered in section 6.

**Before → after on `/msp/dashboard`: 28 console 401 errors at a 5-minute dwell
(24 at this capture's 4-minute dwell) → 0 console errors and 0 4xx/5xx
responses.**

## 6. What noise remains, and what could not be proven

**No 401 remains, and no error of any kind remains on `/msp/dashboard`.** There
is no console noise to excuse and no benign-401 argument to make: the count is
zero, not "zero that matter".

Two `warn`-level lines do remain in the four-minute window, and a reviewer
should know what they are:

- `i18next::backendConnector: No backend was added via i18next.use` (67x) —
  dev-server i18n noise from the MSP shell's namespace loading; unrelated to
  this branch's changes and unchanged by them.
- `WebSocket connection to 'ws://100.82.172.57:3374/hocuspocus?token=…' failed`
  (2x) — an **environment** gap in this review app, not a product defect.
  Nothing listens on port 1235; `server/.env.local` sets
  `NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:1235`; and because the browser
  reaches the app by IP rather than `localhost`, `getHocuspocusUrl()`
  (`packages/notifications/src/hooks/useInternalNotifications.ts:11-16`)
  resolves to the same-origin `ws://…/hocuspocus` path that the containerised
  deployment proxies and `server/next.config.mjs` does not rewrite in dev.

This is the one thing this round could not prove in the browser: the token is
now minted and handed to the provider, but the socket it is minted for has no
server to reach here, so the end-to-end refresh signal is not exercised. It is
worth stating plainly that this failure is *quiet* — it costs two warnings over
four minutes and never re-enters the token ladder, which is exactly the
opposite of the 401 behaviour being fixed. The stream itself stays covered by
`server/src/test/unit/hocuspocus/NotificationExtension.test.ts` (8 tests) and
`tenantValidation.test.ts` (8 tests), both re-run green for this round.

## 7. Two more routes with the same defect — also fixed

While tracing the middleware gate, two further routes that this branch adds
were found to be blocked by the identical mechanism. Neither is reachable from
`/msp/dashboard`, so neither is one of the 28; both were fixed in the same
round because both make a shipped feature dead.

Before the fix, probed from an authenticated MSP session in the browser:

```
/api/online-meetings/artifacts/00000000-...     -> 401 {"error":"Unauthorized: API key missing"}
/api/client-portal/conversation-attachments/x?… -> 401 {"error":"Unauthorized: API key missing"}
/api/online-meetings/recordings/x               -> 500          (control: allowlisted, reaches its handler)
```

The 500 on the allowlisted sibling is the control that proves the mechanism:
same shape of URL, same session, but that prefix *is* in `apiKeySkipPaths`, so
the request reaches the handler and fails on the bogus id instead of being
turned away at the edge.

### Why a pattern, not an exact path

Both routes carry a dynamic segment (`[attachmentId]`, `[artifactId]`), so
`exactApiKeySkipPaths` — which compares whole strings — cannot express them.
The narrowest available construct is the anchored single-segment regex already
used a few lines above for the co-management attachment routes:

```ts
/^\/api\/client-portal\/conversation-attachments\/[^/]+$/.test(pathname) ||
/^\/api\/online-meetings\/artifacts\/[^/]+$/.test(pathname) ||
```

What this **does** expose: exactly one path segment after the route root, for
these two roots only.

What it **does not** expose: the collection root itself
(`/api/online-meetings/artifacts`), any deeper child
(`…/artifacts/{id}/content`, `…/conversation-attachments/{id}/raw`), and any
prefix sibling (`/api/online-meetings/artifacts-evil/{id}`). `[^/]+$` forbids a
further `/`, and the `^…$` anchors forbid both prefix and suffix drift — which
is what a `startsWith` entry in `apiKeySkipPaths` would have allowed. Verified
live, from the same authenticated session, after the fix:

```
/api/client-portal/conversation-attachments/abc/raw  -> 401 {"error":"Unauthorized: API key missing"}
/api/online-meetings/artifacts/abc/content           -> 401 {"error":"Unauthorized: API key missing"}
/api/online-meetings/artifacts                       -> 401 {"error":"Unauthorized: API key missing"}
```

All three are still turned away at the edge.

### Authentication proof — the handlers authenticate before they read anything

Allowlisting a route that does *not* authenticate itself converts a 401 into an
unauthenticated data leak, so each handler was read line by line first.

**`/api/client-portal/conversation-attachments/[attachmentId]`**

- `route.ts:12` — `const session = await getSession()`.
- `route.ts:13-14` — refuses unless *all* of: no `getApiKeyUserOverride()`, a
  `session.session_id`, `session.user.user_type === 'client'`, a tenant, and a
  user id. Returns `401 {"error":"Unauthorized"}`.
- This is the **first** statement in the body. The dynamic `attachmentId` and
  the query string are not read until line 15, and no database connection is
  opened until lines 19/23 — so nothing is read before the check.
- The tenant handed to `getConnection` is `session.user.tenant` (lines 19-25),
  never a URL or header value. The route's own comment states this.
- Authorization then runs inside `withPortalComment`
  (`server/src/lib/co-managed/portalAttachments.ts:13-48`), all under one
  transaction with `FOR SHARE` locks, before the attachment bytes are touched
  at line 43: active `client` user row (21), un-revoked session row (22),
  session unexpired (23), portal RBAC `ticket:read` with `r.client`/`p.client`
  (25-29), active contact (30-31), portal visibility context (32), the ticket
  must belong to that contact's client and pass the visibility filter (33-35),
  the comment must be `published` with a `published` root and audience
  `requester` (36-40), and the session is re-asserted unexpired (41) — and
  again after the read (45).

**`/api/online-meetings/artifacts/[artifactId]`**

- `route.ts:18-19` — `resolveMeetingArtifactActor(request)`; `401` if null.
- `server/src/lib/api/auth/meetingArtifactActor.ts:12-17` — if `x-api-key` is
  present it is validated and there is **no cookie fallback** on failure.
  Otherwise (line 18-21) `getCurrentUser()` then `resolveNativeTimeBrowserActor`,
  which re-reads the session itself and throws unless there is no API-key
  override, the session id exists, and the session's tenant, user id and
  `user_type === 'internal'` all match
  (`packages/scheduling/src/lib/nativeTimeReader.ts:8-10`).
- The tenant comes from the resolved actor (`route.ts:20`), never the URL, and
  `createTenantKnex` is not called until line 22 — after authentication.
- Authorization then runs inside `consumeCoManagedMeetingArtifact`
  (`packages/co-managed/src/nativeMeetingRead.ts:107-129`) in one transaction:
  the actor is re-snapshotted and its tenant re-checked (112), the credential
  is re-locked and re-validated — session unexpired, or API key still active
  and unexpired — via `lockCoManagedLocalAuthentication`
  (`packages/co-managed/src/localAuthentication.ts:19-37`) (113), and
  `retainNativeOnlineMeeting` must admit the actor to the meeting (116) before
  `consume()` is ever called (126). The credential is asserted current again
  after the response is prepared, and the stream is discarded if it is not
  (127).

Both routes therefore authenticate and authorize before reading data, which is
the precondition for allowlisting them.

### After the fix — each URL reaches its handler

Same authenticated MSP session, after the middleware change:

```
/api/online-meetings/artifacts/00000000-0000-0000-0000-000000000000
  -> 404  text/plain;charset=UTF-8  "Artifact not found"

/api/client-portal/conversation-attachments/00000000-…?ticketId=…&threadId=…&commentId=…
  -> 401  application/json  Cache-Control: no-store, private  {"error":"Unauthorized"}
```

Neither is the middleware's response, and both are identifiable as the
handler's:

- The artifact route's `404 Artifact not found` is `route.ts:58`, which is only
  reached after the browser-session actor resolved, `runWithTenant` /
  `createTenantKnex` ran, and `consumeCoManagedMeetingArtifact` returned
  `handled: false`. The middleware cannot produce that body. **The cookie actor
  branch is now live.**
- The attachment route's `401` is a *different* 401 from the middleware's: the
  body is `{"error":"Unauthorized"}` rather than
  `{"error":"Unauthorized: API key missing"}`, and it carries
  `Cache-Control: no-store, private`, which the route sets via
  `conversationAttachmentHeaders` and the middleware does not set at all. That
  is `route.ts:13-14` firing on `user_type !== 'client'` — an MSP session is
  correctly refused *by the handler*. This is the stronger of the two proofs:
  it shows the route is reachable **and** that allowlisting did not open it to
  a non-`client` session.

### What could not be exercised, and why

The instruction for this round was to drive a **real** co-managed portal
attachment rather than a synthetic id. That is not possible in this database,
and it is worth being explicit rather than quiet about it:

```
select user_type, count(*) from users group by 1;   ->  internal | 15
select count(*) from co_management_conversation_attachments;  ->  0
select count(*) from online_meeting_artifacts;                ->  0
select count(*) from online_meetings;                         ->  0
```

There are **no client-portal users at all** in `server_co_managed` — every one
of the 15 users is `internal` — so no `client` session can be established, and
there are no attachment or artifact rows to fetch. The fixtures
(`docs/dev/co-managed-fixtures.md`) seed co-managed comments but not
conversation attachments or meeting artifacts. So the happy path cannot be
driven from a browser here by anyone, and this round did not fake one.

What is proven live is the property the fix is about: the requests now reach
their handlers instead of dying at the edge, and the handlers' own auth still
decides the outcome. The happy paths stay covered by
`server/src/test/unit/product/coManagedPortalAttachmentDownload.test.ts`
(6 tests) and the `online-meetings/artifacts` cases in
`ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts:15563-15601`,
which drive both the session and the API-key branches.

A follow-up worth its own card: the fixture set should seed a client-portal
user plus one published requester-audience comment with an attachment, so the
portal download has an end-to-end review path at all.

### Regression tests

Four cases added to `server/src/test/unit/middleware.apiKeyAuth.test.ts`, in
the same exempted-exactly / sibling-still-gated shape used for the live token:

```ts
  it('allows co-managed portal conversation attachment downloads to use the client session', () => {
    expect(shouldSkipApiKeyAuth('/api/client-portal/conversation-attachments/attachment-123')).toBe(true);
  });

  it('exempts one conversation attachment id only, never a sibling or deeper path', () => {
    expect(shouldSkipApiKeyAuth('/api/client-portal/conversation-attachments')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/client-portal/conversation-attachments/attachment-123/raw')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/client-portal/conversation-attachments-evil/attachment-123')).toBe(false);
  });

  it('allows meeting artifact downloads to resolve their session or API-key actor in-route', () => {
    expect(shouldSkipApiKeyAuth('/api/online-meetings/artifacts/artifact-123')).toBe(true);
  });

  it('exempts one meeting artifact id only, never a sibling or deeper path', () => {
    expect(shouldSkipApiKeyAuth('/api/online-meetings/artifacts')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/online-meetings/artifacts/artifact-123/content')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/online-meetings/artifacts-evil/artifact-123')).toBe(false);
  });
```

```
$ cd server && npx vitest run src/test/unit/middleware.apiKeyAuth.test.ts
 ✓ src/test/unit/middleware.apiKeyAuth.test.ts (23 tests) 5ms
 Test Files  1 passed (1)
      Tests  23 passed (23)

$ npx vitest run src/test/unit/product/
 Test Files  87 passed (87)
      Tests  649 passed (649)
```

### The dashboard re-verified after this second middleware change

Both section-7 entries edit the same `shouldSkipApiKeyAuth` expression that
section 4's fix edits, so the dashboard capture was repeated afterwards to make
sure widening the allowlist did not disturb it:

```
span s: 139.4   requests: 150
4xx/5xx total: 0
console errors: 0
live-token: [(18.4, 200), (18.4, 200), (72.8, 200), (72.8, 200), (127.8, 200), (127.8, 200)]
```

Still clean, still on the 55-second renewal cadence.

Dev server health at the end of the round — not restarted at any point:

```
$ curl -o /dev/null -w "%{http_code} -> %{redirect_url}" http://127.0.0.1:3374/auth/signin
307 -> http://127.0.0.1:3374/auth/msp/signin
$ curl -o /dev/null -w "%{http_code} -> %{redirect_url}" http://100.82.172.57:3374/auth/signin
307 -> http://100.82.172.57:3374/auth/msp/signin
```

One unrelated red test exists in this worktree and is **not** from this round:
`src/test/unit/api/timeSheetServiceAllDayValidation.test.ts` (4 failures),
driven by in-flight uncommitted changes to
`server/src/lib/api/services/TimeEntryService.ts` and
`server/src/lib/utils/workDate.ts`, neither of which this round touched.
