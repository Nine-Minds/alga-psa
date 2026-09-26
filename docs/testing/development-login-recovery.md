# Development login recovery

Development startup bootstraps only the seeded MSP fixture account
`glinda@emeraldcity.oz`. Production startup does not run this path.

For a fresh development seed, Glinda's password hash is deliberately empty. The
first development boot generates a random password, hashes it with the same
effective secret used by authentication, verifies the new hash, then stores it
with a tenant-scoped compare-and-set. Only the process that wins that update
prints the password. A later boot retains the valid hash and does not rotate it.

For a repeatable startup-log handoff, configure `DEV_LOGIN_PASSWORD` in the
development service's secret/environment configuration. Keep its value private
and use the same value in worktrees that share a database. Startup verifies it
against the stored hash and prints it only after verification succeeds.

To recover a well-formed hash that does not verify with this stack's effective
authentication secret, configure both `DEV_LOGIN_PASSWORD` and
`DEV_LOGIN_PASSWORD_RECOVERY=true` for one development boot. Startup replaces
the hash only if the stored value still matches the value it read, then verifies
the resulting hash before printing the configured credential. Keep
`DEV_LOGIN_PASSWORD` configured for later startup-log handoffs; the recovery
flag can be removed once recovery succeeds. Competing boots using the same
password and effective secret converge on the same usable credential. A boot
that loses the compare-and-set reports the configured password only after it
reads and verifies the winner's stored hash.

All worktrees sharing this database must resolve the same effective
`nextauth_secret` / `NEXTAUTH_SECRET`; password hashes use that secret as a
pepper. Startup never prints either secret. Do not copy the password from
startup logs into commits, tickets, or durable workflow facts. Provide it to
Smoke Test through the private test handoff.

Smoke Test should open `http://127.0.0.1:3927/auth/msp/signin` after confirming
the service and worktree behind port 3927. The service operator should provide
the configured credential from this worktree's private, ignored
`server/.env.local` file (mode `0600`). Never copy it into a ticket or durable
report.
The initial recovery handoff was subsequently found to reject the configured
password, including when checked with Next.js's environment loader. The cause
of that intervening mismatch was not established. Takeover repeated the scoped
recovery, then confirmed authentication in separate processes before and after
the regression suite. Other worktrees using the old startup code can still
rotate a shared database credential; this branch cannot prevent their writes.

Run this read-only check from `server/` immediately before browser smoke:

```sh
NODE_ENV=development node --import tsx scripts/check-development-login.mjs
```

It uses Next.js's development environment loader and `authenticateUser` against
the configured database. It emits only a result, never the password, and starts
no server. To verify the private file independently of inherited credential
variables, prefix the command with
`env -u NEXTAUTH_SECRET -u nextauth_secret -u DEV_LOGIN_PASSWORD -u DEV_LOGIN_PASSWORD_RECOVERY`.
If verification fails and recovery of this fixture is intended, append
`--recover`. That option calls the same tenant-scoped compare-and-set recovery
used at startup and verifies authentication afterward. It does not persist a
recovery flag or change the private environment file. Keep the recovery flag
unset for normal service boots.

The private `DEV_LOGIN_PASSWORD` remains configured for the next Next.js boot.
Port `3927` had no listener during this implementation step.

Smoke Test now only needs the browser checks: authenticate and reload to
confirm the session persists, confirm sign-in input hydration and the Google
SSO label, and change a priority hex color, save/reload, and check Enter commits
the draft while Cancel discards it. This plain PostgreSQL database does not
validate Citus distribution-column compatibility.
