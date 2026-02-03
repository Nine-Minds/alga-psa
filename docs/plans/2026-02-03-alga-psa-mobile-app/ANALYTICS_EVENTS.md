# Mobile Analytics Events Catalog

Schema version: `1.0.0` (see `mobile/src/analytics/events.ts`)

Notes:
- Event names are stable identifiers and must not be repurposed.
- Properties should avoid PII; do not include ticket subject, comment text, requester/contact data, or tokens.

## Events

| Event | When | Properties (non-exhaustive) |
|---|---|---|
| `app.startup.ready` | App boot is complete and navigation state is restored | `durationMs`, `signedIn` |
| `auth.sign_in.blocked` | User attempted sign-in but CTA was gated | `reason` (`missing_base_url` \| `mobile_disabled` \| `host_not_allowlisted`) |
| `auth.sign_in.start` | User tapped Sign In and sign-in state was created | *(none)* |
| `auth.sign_in.open_failed` | Failed to open the system browser for sign-in | `reason` (`cannot_open_url` \| `exception`) |
| `auth.sign_in.opened_browser` | System browser opened successfully | *(none)* |
| `auth.callback.failed` | Deep link callback was received but rejected | `reason` (provider error code or `missing_params` \| `state_mismatch`) |
| `auth.exchange.failed` | OTT exchange failed | `errorKind`, `status` |
| `auth.exchange.succeeded` | OTT exchange succeeded | `expiresInSec` |
| `auth.refresh.failed` | Session refresh failed | `errorKind`, `status` |
| `auth.refresh.revoked` | Session refresh indicates token revoked/expired and session was cleared | `status` |
| `auth.refresh.succeeded` | Session refresh succeeded | `expiresInSec` |
| `auth.logout` | Logout initiated | `hadSession` |
| `api.request.succeeded` | Any API request succeeds | `method`, `path`, `status`, `durationMs`, `attempts` |
| `api.request.failed` | Any API request ultimately fails (after retries/optional auth refresh) | `method`, `path`, `status`, `errorKind`, `durationMs`, `attempts` |

## Common properties

All mobile events automatically include:
- `schema_version`: current analytics schema version (`1.0.0`)
