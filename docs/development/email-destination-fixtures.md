# Local IMAP and OAuth recipients

To exercise a controlled local IMAPS server and HTTPS OAuth issuer, set
`ALGA_EMAIL_DEV_DESTINATIONS` in the application and email-service process environments:

```sh
export NODE_ENV=development
export ALGA_EMAIL_DEV_DESTINATIONS='{"imap.fixture.test":["127.0.0.1"],"oauth.fixture.test":["127.0.0.2"]}'
```

Configure DNS or your hosts file so each hostname resolves to its listed address.
Use `NODE_ENV=test` when running a built email-service artifact against these fixtures.
The setting is ignored in production, when `NODE_ENV` is unset, and for other environment names.
An unset allowlist preserves the public-address policy in development and test too.

Each entry names one exact hostname and a nonempty array of literal IP addresses.
Every resolved address must match before a normally blocked destination is permitted.
Unlisted hostnames, wildcard domains, CIDRs, URLs and scoped IPv6 addresses cannot grant exceptions.
Entries grant access to the host across ports. List only controlled fixture hosts and addresses.

Provider saves, connection tests, OAuth authorization and token exchanges, refreshes,
queue processing and the standalone email listener use the same resolution policy.
OAuth URLs must still use HTTPS and cannot contain embedded credentials.
These settings do not disable TLS certificate verification. Install your fixture CA
with `NODE_EXTRA_CA_CERTS` before starting both Node processes, and use a certificate
whose DNS or IP subject alternative names match the endpoint.

Keep fixture credentials, CA private keys and recipient logs outside the repository.
Use an isolated database, secret filesystem and Redis namespace for the UI and worker.
Remove the environment settings when returning to the usual development environment.
