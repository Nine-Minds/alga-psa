# getTicketById — stop serializing credential-bearing user rows

Card: `e8c7e2ad-a299-5f72-99b5-6f3a0665b71f`
Finding: **secrets · high** — `packages/tickets/src/actions/ticketActions.ts:2886-2892`
(`getTicketById`), reviewed on merge `22d6e42ed479` (PR #3994).

## What is wrong (confirmed on the branch)

`getTicketById` (`ticketActions.ts:2829`) authenticates, requires `ticket:read`, and applies
`authorizeTicketRead` — all correct. Then, in the parallel fetch at `:2886-2892`:

```ts
tenantScopedTable(trx, 'users', tenant).orderBy('first_name', 'asc')
```

selects **`users.*`**. Those rows are returned verbatim as `detailedTicket.availableAgents`
(`:2911`, typed `availableAgents?: IUser[]`). `users` carries `hashed_password` and
`two_factor_secret` (`server/migrations/202409071803_initial_schema.cjs`), so every principal that may
read one ticket receives every tenant user's credential material. `authorizeTicketRead` deliberately
admits client principals to their own ticket, so this also crosses the MSP/client boundary.

The "secrets in the ticket loader" family has already hit this file; this is the single-ticket twin of the
list loader.

## The fix has a general mechanism already — use it

`packages/users/src/services/userResponseSanitizer.ts` is the repo's allow-list for user responses:

- `USER_RESPONSE_COLUMNS` (`users.<col>` strings) — the projection to select;
- `USER_RESPONSE_FIELD_NAMES` / `AllowlistedUserField` — the shape;
- `sanitizeUserForResponse()` — belt-and-braces strip for anything the caller passes through.

`UserService` and the API user paths already use it (`UserService.ts:45`,
`findUserByIdForApi.ts:11`). This card is therefore a **query + shape + test** change, not a new
mechanism.

## Design

### 1. Project, don't select

Replace the bare `users.*` fetch with an explicit projection of the columns the ticket UI needs:

```ts
tenantScopedTable(trx, 'users', tenant)
  .select('user_id', 'first_name', 'last_name', 'email', 'user_type', 'is_inactive', 'icon')
  .where({ is_inactive: false })          // assignment picker semantics, as the UI already assumes
  .orderBy('first_name', 'asc')
```

Use the shared list rather than hand-typing it: derive the projection from
`USER_RESPONSE_FIELD_NAMES` (there is no join alias here, so the plain column names, not
`USER_RESPONSE_COLUMNS`, are what this query needs) — the point is that the *source of truth* stays the
sanitizer module. If the projection needs a narrower set for the picker, define it next to the query and
say why; do not add a second allow-list in `packages/tickets`.

### 2. Shape the return value

Change `availableAgents?: IUser[]` to the sanitizer's shape
(`Array<Pick<IUserWithRoles, AllowlistedUserField>>`, or a local `TicketAgentOption` alias of it), and map
the fetched rows through `sanitizeUserForResponse()` before assigning. `additionalAgents` (from
`ticket_resources`) stays as-is in this card — it is a different table with its own contract — but the
test below asserts the response carries no sensitive key anywhere.

### 3. Client principals do not receive the agent directory

`authorizeTicketRead` admits client users to their own ticket; a portal client has no product reason to
receive the MSP agent directory (names, emails, account state). So:

- detect the principal (`user.user_type === 'client'`, matching the check used elsewhere in this package);
- for a client principal, do **not** fetch the agent list at all and omit `availableAgents` from the
  returned object (leave `additionalAgents` intact — a client who is an additional agent legitimately
  sees that row);
- MSP principals get the sanitized list as designed above.

This keeps the action one code path with one authorization decision instead of a second permission.

### 4. Regression test (fails on main)

`packages/tickets/src/actions/getTicketById.sensitiveUsers.test.ts` — same harness style as the existing
ticketActions tests:

1. MSP user with `ticket:read`: `getTicketById` succeeds and **no** serialized object anywhere in the
   result has `hashed_password`, `two_factor_secret`, `password`, or any `SENSITIVE_USER_FIELDS` key —
   walk the whole result, not just `availableAgents`;
2. `availableAgents` entries contain only allow-listed fields (`Object.keys` ⊆
   `USER_RESPONSE_FIELD_NAMES` + mapping alias);
3. **client** principal reading their own ticket: `availableAgents` is `undefined` and no user
   credentials appear;
4. the list-loader contract test (`userServiceSensitiveFields.contract.test.ts`) still passes.

Throws on main for (1) and (2); (3) fails to compile against the old `IUser[]` type but is proven by the
assertion.

### 5. Adjacent leak, named but not fixed here

The finding notes the parallel disclosure "was found elsewhere". The same `users.*`-into-response shape
should be swept across ticket loaders in one follow-up rather than card by card; this design deliberately
fixes the fingerprint it was given and leaves a `// LEVERAGE: pattern users-star-projection` marker at the
query site so the sweep can find the family.

## Order of work

1. Narrow the query + retype `availableAgents` (mechanical, types drive the rest).
2. Add the client-principal branch.
3. Sanitize on assign; run the new test (must fail on the pre-fix checkout, pass after).
4. Add the `LEVERAGE` marker and the follow-up note in the card's facts.

## Deliberately not doing

- No new permission: the action's existing `ticket:read` + `authorizeTicketRead` stay authoritative.
- No change to `ticket_resources`/`additionalAgents` shape.
- No repo-wide sweep of every `users.*` projection in this card (see §5) — but it is one pattern, one
  fix, and the marker makes the follow-up unavoidable rather than remembered.

## Risks

- **Silent UI breakage**: the ticket screen may read fields from `availableAgents` that are not in the
  allow-list (e.g. `avatarUrl`, `reports_to`). Mitigation: grep the consumers before narrowing; add the
  field to the sanitizer's list if the screen genuinely needs it, rather than widening the query.
- **Client-portal regression**: is any portal screen rendering `availableAgents`? If yes, the omission is
  still correct (portal clients should not see the MSP directory) but the screen must tolerate
  `undefined` — covered by the type change.
- **Inactive users**: the picker previously showed inactive users too; excluding them is the intended
  assignment semantics but is a behaviour change worth one line in the PR description.
