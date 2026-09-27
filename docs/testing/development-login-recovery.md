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
The initial recovery handoff was subsequently found to fail in the command
path. Recovery updated the database but did not mutate the previously loaded
user object, so the command verified the stale hash. After changing the command
to re-read the tenant-scoped row, a second command-path defect surfaced: its
lookup adapter omitted the required `internal` user type. The stale-hash
behavior has a regression test using the command's verification helper; the
corrected tenant-scoped adapter was exercised by fresh-process recovery and
normal checks.

Private HMAC comparisons across fresh processes found one active matching
account and stable database identity, account identity, configured password,
and effective secret. The effective secret provider agreed with the loaded
auth-secret environment setting. The stored hash changed during explicit
recovery, then remained identical across subsequent checks; the configured
password verified against it and `authenticateUser` accepted it after recovery
and again after tests and typechecking. No external writer or rotation was
observed during these comparisons. The origin of the earlier mismatched hash
was not established.

Run this read-only check from `server/` immediately before browser smoke:

```sh
NODE_ENV=development node --import tsx scripts/check-development-login.mjs
```

It uses Next.js's development environment loader and `authenticateUser` against
the configured database. It emits only a result and a redacted failure class,
never the password, and starts no server. A mismatch against the selected
account hash indicates possible shared-database rotation or secret
configuration drift; a discovery/scoped-account mismatch indicates account
selection drift. To verify the private file independently of inherited
credential variables, prefix the command with
`env -u NEXTAUTH_SECRET -u nextauth_secret -u DEV_LOGIN_PASSWORD -u DEV_LOGIN_PASSWORD_RECOVERY`.
If verification fails and recovery of this fixture is intended, append
`--recover`. That option calls the same tenant-scoped compare-and-set recovery
used at startup and verifies authentication afterward. It does not persist a
recovery flag or change the private environment file. Keep the recovery flag
unset for normal service boots.

The private `DEV_LOGIN_PASSWORD` remains configured for the next Next.js boot.
Port `3927` had no listener during this implementation step.

An investigation on 2026-09-26 identified a live shared-database writer in the
`feature-alga-2026-0002576-multiple-outbound-from-address-2` worktree. Its
development initializer generates a new Glinda password and updates the row on
every app initialization, without checking the existing hash. This is a
demonstrated hash writer; it does not explain every possible secret or account
configuration mismatch. The current initializer in this checkout retains a
well-formed hash unless explicit recovery is requested, and a focused regression
test protects that behavior when the effective secret differs.

On 2026-09-27, a documented recovery and fresh-process check passed at about
00:00 UTC. The stale writer service restarted at about 00:04 UTC. Secret-safe
HMAC snapshots at 00:15:30 and 00:25:19 UTC showed
the configured password, effective and environment auth-secret values, database
identity, selected user, tenant, and stored hash were all stable across that
9m49s interval. The fresh-process check failed at both the initial investigation
and the pre-recovery check, excluding password, auth-secret, account, or database
configuration drift over that measured interval. A second explicit recovery then changed
the stored-hash fingerprint while the other fingerprints remained stable, and
the post-recovery fresh-process authentication check passed at 00:25:27 UTC.
Fresh checks at 00:28:50 and 00:30:49 UTC also passed. HMACs from 00:25:27 to
00:30:49 showed stable password, secret, database, account, tenant, and hash
fingerprints. The old writer process PID remained unchanged during this interval,
so the five-minute stable period does not prove its next initialization is safe.
An independent HMAC snapshot loaded through the stale worktree's own environment
at 00:32:21 UTC matched this checkout's effective secret, database, user, tenant,
and current stored hash; each checkout's effective secret also matched its
environment value. This confirms both checkouts select the same shared account
and database with aligned auth secrets at the comparison point. Together with
the stale source's unconditional random-password write on initialization and its
restart after the successful check, the invalidation mechanism is the stale
writer replacing the shared hash. Fingerprints and their HMAC key remain in
mode-0600 files under `/tmp` and are not committed.

The stale writer was updated and committed in that checkout as
`27a235a2a2`. Startup now uses the guarded development credential initializer;
well-formed existing hashes are retained unless explicit recovery is requested,
and first-time writes use tenant-scoped compare-and-set. The competing-startup
regression exercises two initializers against the same isolated store. The old
service process was stopped externally at 00:44:22 UTC (its card-service log
records “stopped by request”); this agent did not stop or restart it. No dev
server was started or woken during this work.

Fresh-process authentication passed at 00:53:29 UTC after the isolated
competing-initializer test and again at 01:04:41 UTC after production build, an
11-minute-12-second observation interval. After the later typecheck, the check
failed during seeded-account lookup. A secret-safe direct diagnostic identified
a PostgreSQL password-authentication failure before account lookup completed;
the helper intentionally sanitized the error. Therefore this later failure is
not evidence of a changed hash or missing account, and authentication could not
be verified after the final validation. The writer checkout's server typecheck
passed. Its production build was attempted with isolated output but failed on
pre-existing missing checkout dependencies (`RemoteAccessButton.tsx` and
`@alga-psa/list-views`); output was removed. This work order's production build
passed with isolated output in this validation round. The successful repeated
checks show stability over their interval but cannot prove future writer
behavior or resolve the later database-authentication failure.
The remaining browser smoke sequence is: recover with `--recover`, run the
fresh-process check, sign in through the browser, edit priorities for several
minutes (hex Save, dialog Save, Enter commit, Cancel discard, reload and
database persistence), run the check again, sign out, then sign in with the
identical configured password. Browser smoke remains deferred under the
no-server-start constraint. This plain PostgreSQL database does not validate
Citus distribution-column compatibility.
