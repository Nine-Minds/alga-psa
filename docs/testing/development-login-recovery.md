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
the verified startup credential through the private handoff (or arrange a
development boot with `DEV_LOGIN_PASSWORD` set in the service's secret store).
Smoke Test then verifies sign-in and session persistence, input hydration and
the Google SSO label, priority color save/reload persistence, Enter to commit a
hex draft, and Cancel to discard it. Plain PostgreSQL does not validate Citus
distribution-column compatibility.
