# getConsolidatedTicketData — stop returning credential-bearing user rows to every reader

Card: `e3c2e9fc-fe51-56b9-8182-836a27504b32`
Finding: **secrets · high** — `packages/tickets/src/actions/optimizedTicketActions.ts:579-582`
(`getConsolidatedTicketData`), reviewed on merge `22d6e42ed479` (PR #3994).

## What is wrong (confirmed on the branch)

`getConsolidatedTicketData` (`:467`) checks only `ticket:read` (`:471`), authorizes the ticket itself
(`:512-521`), and then fetches its parallel bundle including:

```ts
tenantScopedTable(trx, 'users', tenant)      // :579-582
  .where('user_type', 'internal')
  .where('is_inactive', false)
```

**with no select list**, so every row is `users.*`. Those rows go straight out as
`availableAgents: users` (`:1176`). `users` carries `hashed_password` and `two_factor_secret`
(`server/migrations/202409071803_initial_schema.cjs:25-40`), so any principal holding `ticket:read` — and
client roles hold it by default — receives every active agent's password hash and TOTP seed. The same
response also carries raw comments and the tenant-wide client list, none of which an MSP screens needs
from a client principal.

This is the third instance of one shape in this codebase: `users.*` selected into a ticket-loader response.
The sibling card `e8c7e2ad` (`getTicketById`) is the single-ticket twin and uses the same fix.

## The mechanism already exists

`packages/users/src/services/userResponseSanitizer.ts` is the repo's user allow-list:

- `USER_RESPONSE_FIELD_NAMES` / `AllowlistedUserField` — the permitted shape (no credential columns);
- `USER_RESPONSE_COLUMNS` — the same fields qualified for joins;
- `SENSITIVE_USER_FIELDS` — the deny list a test can assert against;
- `sanitizeUserForResponse()` — defence in depth on the way out.

`UserService` and the API user paths already use it. This card is a projection + principal-gate change,
not new machinery.

## Design

### 1. Principal gate (the action is MSP-only)

Every call site is MSP composition — `packages/msp-composition/src/clients/MspClientTickets.tsx:199`,
`MspContactTickets.tsx:206`, `useTicketDetailsDrawer.tsx:28`,
`packages/msp-composition/src/assets/MspAssetCrossFeatureProvider.tsx:50`. There is no portal caller.

So, immediately after the `ticket:read` check:

```ts
if (user.user_type === 'client') {
  throw new Error('Permission denied: consolidated ticket data is an MSP view');
}
```

The comparison matches the existing narrowing style in this package (`ticketActions.ts:347`,
`optimizedTicketActions.ts:826`). This closes the cross-boundary half of the finding: the payload includes
the tenant-wide client list and raw comments, which a portal client has no business receiving, and the
portal has its own composition layer.

### 2. Project, don't select

Replace the bare fetch with an explicit projection built from the shared list:

```ts
tenantScopedTable(trx, 'users', tenant)
  .select(...USER_RESPONSE_FIELD_NAMES)
  .where('user_type', 'internal')
  .where('is_inactive', false)
  .orderBy('first_name', 'asc')
```

`USER_RESPONSE_FIELD_NAMES` holds plain column names, which is what this unaliased query needs (the
`users.`-qualified `USER_RESPONSE_COLUMNS` is for joins). The rest of the action already derives
`commentAuthorMap` (`:852`), `agentOptions` (`:909`) and `availableAgents` (`:1176`) from this same array,
so narrowing it is a single-point change — verify no consumer reads a dropped field (see Risks).

### 3. Sanitize on the way out

Map the rows through `sanitizeUserForResponse()` before `availableAgents: users`, and type the field off
`AllowlistedUserField` rather than `any`. The projection is the fix; the sanitizer is the guarantee that
the next edit to this query cannot silently re-widen it.

### 4. Regression test (fails on main)

`packages/tickets/src/actions/optimizedTicketActions.sensitiveUsers.test.ts`:

1. MSP reader with `ticket:read` on an authorized ticket: the whole returned object contains **no** key
   from `SENSITIVE_USER_FIELDS` anywhere (walk it, not just `availableAgents`);
2. every `availableAgents` entry has `Object.keys` ⊆ `USER_RESPONSE_FIELD_NAMES`;
3. a **client** principal on a ticket they can read: the action throws and returns no bundle;
4. existing `optimizedTicketActions.commentAuthorMap.contract.test.ts` still passes (the projection keeps
   `user_id`, `first_name`, `last_name`, `user_type`, `contact_id`);
5. `userServiceSensitiveFields.contract.test.ts` stays green.

### 5. The family, not just this fingerprint

Leave `// LEVERAGE: pattern users-star-projection` at the query site. Three cards have now fixed the same
shape (`getTicketById`, this one, and the list loader): the remaining sweep belongs in one follow-up that
routes every ticket loader's user fetch through `USER_RESPONSE_FIELD_NAMES`, recorded as a fact on this
card so it is not re-derived card by card.

## Order of work

1. Principal gate + its test (smallest, immediately closes the boundary).
2. Narrow the query; retype `availableAgents`; add the sanitizer.
3. Sensitive-field walk test; run the contract tests.
4. `LEVERAGE` marker + follow-up fact.

## Deliberately not doing

- No new permission: `ticket:read` plus ticket authorization stay authoritative, and MSP-only is a
  principal-type check, not a grant.
- No change to `comments`/`clients` shapes in this card — the client-list exposure is closed by the
  principal gate; narrowing the payload further is UI-visible and deserves its own card.
- No repo-wide sweep here (§5).

## Risks

- **Dropped field the UI reads**: `avatarUrl` is resolved later via `getUserAvatarUrl()` (`:850-860`), so
  it is not from `users.*`; but grep `availableAgents` and `agentOptions` consumers before narrowing, and
  add any genuinely-needed field to the shared allow-list rather than widening the query.
- **Client portal breakage**: none expected (all call sites are `msp-composition`), but the portal build is
  the check — if a portal path turns out to call this action, the correct variant is to return the payload
  *without* `availableAgents`/`clients`, not to re-open `users.*`.
- **Performance**: the projection may remove a column the join-heavy bundle relies on later in the
  function (e.g. `reports_to`); the test suite and a manual ticket open cover it.
