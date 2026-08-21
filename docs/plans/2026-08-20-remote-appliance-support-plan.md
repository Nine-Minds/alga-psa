# Remote appliance support implementation plan

Date: 2026-08-20

Status: Approved

Branch: `feature/remote-appliance-support`

## Summary

Add customer-authorized, time-limited remote support for connected Pro appliances. An appliance administrator enables Support Mode from the appliance-local management UI, chooses a one-, four-, or eight-hour window, and receives a single-use code. An authenticated vendor support operator redeems that code in a dedicated support control plane and receives one root-equivalent terminal through outbound TLS WebSockets. The appliance opens no inbound port.

The privileged support pod owns the PTY, reconnect behavior, and local session recording. Terminal content is retained only on the appliance. The central control plane stores content-free audit metadata and recording digests. Revocation, expiry, idle timeout, recording failure, or policy failure closes access deterministically.

The technically important boundary is that the registry-updatable appliance control plane owns support-pod orchestration. The ISO-baked host agent is not changed. This permits delivery to existing connected appliances through the existing control-plane image update path.

## Product invariant

No vendor operator can obtain or retain root-equivalent appliance access unless all of the following remain true:

1. An authenticated appliance administrator explicitly enabled a still-valid support window.
2. A connected Pro appliance authenticated to the central support service.
3. The share code was redeemed once by an authenticated, authorized support operator.
4. The active operator is the operator permanently bound to that support window.
5. The appliance can append a complete local recording of the root session.

Violation of any invariant terminates the shell. A reboot may interrupt transport, but it does not create new authority, change the bound operator, or extend the approved expiry.

## Current implementation and constraints

- `ee/appliance/status-ui` is the appliance-local authenticated management UI. Post-install host operations live in its Manage surface.
- `ee/appliance/host-service/server.mjs` serves the management API and already owns authenticated Kubernetes operations, WebSocket upgrades, and host-mounted state.
- The `appliance-control-plane` service account in `ee/appliance/control-plane/manifests/rbac.yaml` can create and delete Pods, Secrets, namespaces, and related resources. It is sufficient to orchestrate a support pod without adding a host-agent route.
- `ee/appliance/control-plane/manifests/workload.yaml` mounts `/var/lib/alga-appliance` from the host. Support intent, resume grants, recording metadata, and recordings can survive control-plane pod replacement and host reboot there.
- `ee/appliance/host-service/host-agent.mjs` is installed by the ISO and is not part of the registry update plane. Do not make this feature depend on a new host-agent endpoint.
- The release channel already resolves an OCI release manifest containing immutable application and control-plane image references. Extend that contract with a digest-pinned support-agent image instead of using a mutable tag.
- The appliance credential is stored in the `appliance-license-seed` Secret. It may be read by the authenticated appliance control plane to establish a support session, but it must never be mounted into the privileged support pod.
- `~/alga-license` is the appliance credential and entitlement authority. Its current `main` does not implement the `/verify-appliance` route already expected by the AI gateway, so that verifier contract is a required cross-repository deliverable.
- The Tenant Management extension is not part of the v1 operator path. Its iframe CSP intentionally blocks external WebSockets; do not weaken the extension sandbox for this feature.
- `package-lock.json` is already modified by the Wire Up step. Do not stage, revert, regenerate, or reformat it as part of this plan.

## Goals

- Let an authenticated appliance administrator enable and revoke remote support locally.
- Support one-, four-, and eight-hour windows, with four hours as the default and eight hours as the absolute maximum from original activation.
- Permit the local administrator to extend only along `1 → 4 → 8` or `4 → 8` while preserving the original activation time.
- Give the customer a human-readable, single-use `XXXXX-XXXXX` share code only after the appliance relay channel is ready.
- Authenticate appliances with the existing long-lived appliance credential while isolating that credential from the privileged pod.
- Authenticate operators with Cloudflare Access and require the dedicated appliance-support group.
- Bind the first successful redemption permanently to one named operator.
- Provide one root-equivalent host terminal, one live shell, and one active support window per appliance.
- Traverse customer firewalls using outbound TLS WebSockets over port 443; open no inbound appliance port.
- Resume the same authorized support window after appliance reboot without customer re-authorization, provided the original expiry has not passed and the window was not revoked.
- Record terminal input, output, resize, exit, reconnect, reboot, and stop events locally in a tamper-evident format.
- Keep terminal contents out of central persistence and application logs.
- Deliver appliance-side behavior to existing connected appliances through the control-plane release mechanism.

## Non-goals

- Remote support for Essentials, disconnected Pro, or air-gapped appliances.
- Multiple operators, operator handoff, or collaborative terminals.
- Customer live terminal mirroring.
- File transfer, arbitrary port forwarding, desktop access, or remote browser control.
- Replacing the existing appliance inventory or license-management console.
- Implementing the operator terminal in the AlgaPSA application or Tenant Management extension.
- WebRTC, STUN, TURN, Hocuspocus, Yjs, or CRDT-based transport.
- Application-layer end-to-end encryption in v1. The frame protocol must remain versioned so it can be introduced later.
- Centrally storing terminal input/output or exported customer recordings.
- Creating an updatable host-agent mechanism.
- Unrelated lockfile cleanup or appliance management refactors.

## Users and primary flows

### Appliance administrator enables support

1. The administrator opens Manage → Support in the appliance-local UI.
2. Essentials sees the feature disabled with a Pro availability message. Disconnected Pro sees it disabled with a connectivity requirement. Connected Pro can continue.
3. The administrator chooses one, four, or eight hours and confirms a warning that access is root-equivalent and recorded.
4. The host service authenticates to the central control API with the existing appliance credential.
5. The central API verifies the credential and current Pro entitlement through `alga-license`, creates a `pending_ack` session, and returns:
   - a non-secret session UUID;
   - the plaintext share code, returned once;
   - a one-use connector token;
   - a session-scoped appliance management token;
   - a root-local resume grant valid only until the original expiry.
6. The host service atomically persists the local session descriptor and plaintext code, then acknowledges durable receipt. A code is never redeemable before this acknowledgement.
7. After acknowledgement, the host service creates the connector Secret and privileged pod, then waits for central readiness.
8. The UI reveals the code only after the pod has authenticated its outbound WebSocket. If readiness is not reached within the provisioning deadline, the host service removes the pod/Secret, closes the central session, and reports a retryable failure without exposing the code.
9. When redemption succeeds, the host service removes the plaintext code from local state.

### Support operator connects

1. The operator signs into the dedicated support control plane through Cloudflare Access.
2. The application verifies the Access JWT audience, issuer, signature, expiry, subject, email, and appliance-support group evidence. Missing or unverifiable group evidence fails closed.
3. The operator enters the share code in a POST body. Codes never appear in URLs.
4. The control API rate-limits by operator subject and source, hashes the normalized code with a keyed HMAC, atomically consumes it, and binds the session to the operator subject/email.
5. The UI displays the resolved appliance/customer identity, approved expiry, and recording notice before Connect.
6. Connect mints a short-lived, one-use operator WebSocket token. The browser connects to the session UUID path and sends the token in the first frame, never in the URL or logs.
7. The relay pairs exactly one authenticated operator socket with the authenticated appliance socket and forwards opaque, backpressured frames.
8. The support agent creates one PTY and launches a host-root shell through the approved namespace-entry wrapper. All PTY events pass through the recorder before transport.

### Disconnect, reconnect, and reboot

- Input or output resets a 30-minute idle timer.
- A dropped operator WebSocket leaves the PTY attached for two minutes. The same operator may mint a fresh one-use socket token and reattach.
- After two minutes, the PTY closes. The bound operator may open a fresh shell while the support window remains active.
- The appliance connector retries transient relay loss with bounded exponential backoff until expiry or revocation.
- On host reboot, the control-plane startup reconciler loads the active descriptor. If the central window remains active, it exchanges the root-local resume grant for a fresh connector token and recreates the support pod.
- Reboot retains the same session UUID, code state, operator binding, and original expiry. It creates an explicit recording segment boundary.
- An expired, revoked, invalid, or centrally rejected resume grant is terminal; startup deletes stale support resources and marks the local session closed.

### Customer extends, revokes, or reviews

- Only the appliance-local authenticated administrator can extend or revoke.
- Extension is measured from original activation and never exceeds eight hours.
- Local revocation first persists a revoked tombstone and deletes the pod/Secret, then notifies the central service. If the central service is unavailable, local loss of access is immediate and central close is retried.
- The local UI shows operator identity, connection state, activation/expiry, remaining time, recording size, and Revoke. It does not mirror the terminal live.
- Closed sessions expose recording playback, download, verification status, and deletion.
- Recordings are automatically pruned 30 days after closure. Active recordings are never pruned.

## Architecture and repository boundaries

```text
Appliance-local management UI
        │ authenticated REST
        ▼
Registry-updatable appliance control plane
  session manager ── Kubernetes API ── privileged support pod
        │                                  │
        │                                  ├─ host-root PTY
        │                                  ├─ local recorder
        │                                  └─ outbound WSS :443
        │                                            │
        ▼                                            ▼
Central support control API ◀────────────── support relay ─────────▶ operator browser
        │                            opaque frames only                    │
        ├─ PostgreSQL metadata                                     Cloudflare Access
        ├─ Redis ephemeral state
        └─ alga-license credential verification
```

### Repository: this AlgaPSA worktree

Own all customer-shipped behavior:

- Appliance Support section and recording viewer.
- Appliance session state machine, central API client, retention, and startup reconciliation.
- Privileged support-agent source and image definition.
- Kubernetes pod/Secret construction and cleanup.
- Release-manifest parsing for the support-agent image.
- Appliance-side unit, integration, build, and VM smoke coverage.
- Appliance operator and technical documentation.

Primary paths:

- `ee/appliance/status-ui/app/manage/ManageView.tsx`
- `ee/appliance/status-ui/app/status.module.css`
- `ee/appliance/host-service/server.mjs`
- `ee/appliance/host-service/manage-engine.mjs`
- new `ee/appliance/host-service/support-session-manager.mjs`
- new `ee/appliance/host-service/support-control-client.mjs`
- new `ee/appliance/host-service/support-recordings.mjs`
- new `ee/appliance/support-agent/`
- `ee/appliance/control-plane/manifests/rbac.yaml`
- `ee/appliance/control-plane/manifests/workload.yaml`
- `ee/appliance/host-service/setup-engine.mjs`
- `ee/appliance/flux/base/platform/appliance-status.yaml`
- `ee/appliance/tests/`
- `ee/docs/appliance/`

### Repository: `Nine-Minds/alga-license`

Add the narrow credential-verification authority:

- New service-authenticated `POST /verify-appliance` route.
- Accept `{ credential }` only in the request body.
- Hash the credential using the existing credential hashing function; never log or persist the plaintext.
- Resolve the exact appliance, tenant registry row, and active entitlement.
- Return only appliance ID, tenant ID, normalized edition, appliance revocation state, entitlement activity, and connectivity eligibility.
- Reject unknown/revoked credentials and malformed requests without revealing which field matched. Return valid but ineligible edition/entitlement state so each consuming service can enforce its own feature policy.
- Keep the route read-only; session state belongs to the new support control plane.
- Add real database-backed happy-path and rejection tests.

Expected paths:

- new `src/routes/verifyAppliance.ts`
- `src/server.ts`
- `src/api-types.ts`
- `src/db/db.ts`
- new `src/__tests__/verifyAppliance.test.ts`

### New private repository: `Nine-Minds/nm-appliance-control-plane`

Create two separately deployable processes in one TypeScript workspace:

- `control-api`: Fastify REST API, Cloudflare Access verification, React/Vite operator UI, PostgreSQL repositories, retention jobs, code/token issuance, and signed recording receipts.
- `relay`: `ws`-based WebSocket pairing and opaque frame forwarding. It shares token verification keys and Redis ephemeral state with `control-api` but has no database access to terminal contents because no such contents exist centrally.

Use React with xterm for the operator terminal, Knex migrations for PostgreSQL, Redis for rate limits, consumed token JTIs, relay ownership leases, and ephemeral presence, and versioned JSON schema/TypeScript contracts for REST and WebSocket messages.

### Repository: `Nine-Minds/nm-kube-config`

Own infrastructure and release delivery:

- Build and publish `ghcr.io/nine-minds/alga-appliance-support-agent` for amd64 and arm64.
- Record the verified immutable support-agent image ref in the appliance OCI release manifest.
- Preserve `supportAgent` through coordinated release, config publish, application pointer, and control-plane pointer updates.
- Build/deploy the new private control API and relay.
- Provision PostgreSQL schema/database, Redis access, Vault-rendered secrets, signing keys, service credentials, and rotation metadata.
- Publish separate operator and relay hosts. Protect only the operator/control API host with Cloudflare Access; the relay remains publicly reachable and token-authenticated.
- Configure the Cloudflare Access application and dedicated appliance-support group policy.
- Add Istio/Gateway routing with WebSocket upgrade support, consistent hashing on the non-secret session UUID path, timeouts suitable for eight-hour sockets, and payload-safe access logging.
- Add service monitors and alerts that never capture frame bodies or credentials.

`Nine-Minds/nm-extensions` requires no v1 change.

## Appliance-side design

### Support session state

Persist support data below `/var/lib/alga-appliance/support-sessions`:

```text
support-sessions/
  active.json                         # at most one active descriptor; mode 0600
  revoked/<session-id>.json           # local revocation tombstone
  history/<session-id>/metadata.json  # lifecycle and recording index
  history/<session-id>/segment-*.cast # terminal events
  history/<session-id>/receipt-*.json # central signature over segment digest
```

Use directory mode `0700`, file mode `0600`, temporary siblings plus atomic rename, strict schema/version validation, and bounded file reads. Never store the long-lived appliance credential. Store the plaintext share code only in `active.json`, remove it immediately after redemption/close, and exclude it from all API logs and history.

The active descriptor contains only:

- schema version, session UUID, created/activated/expires timestamps, selected duration;
- central status URL and non-secret relay URL;
- session-scoped appliance management token;
- expiring resume grant;
- connector/pod state, operator identity once bound, recording totals, and last stop reason;
- plaintext code only while the code remains unredeemed.

Central expiry is authoritative. The local manager also enforces expiry with timers, startup reconciliation, and pod `activeDeadlineSeconds`; changing the host file or clock must not extend the central session.

### Support pod

Create one pod in a fixed `alga-appliance-support` namespace with a deterministic session label and name. The pod specification must include:

- the exact `supportAgent` image digest from the currently resolved OCI release manifest;
- `imagePullPolicy: IfNotPresent` with digest identity;
- `restartPolicy: OnFailure` and `activeDeadlineSeconds` bounded by central expiry;
- root user, privileged security context, host PID namespace, and an explicit unconfined seccomp profile where required by namespace entry;
- read/write host root mounted at `/host` with the minimum required propagation mode;
- no Kubernetes service-account token (`automountServiceAccountToken: false`);
- a read-only projected Secret containing only the one-use connector token;
- memory-backed `emptyDir` for the post-handshake reconnect token;
- a host-path recording directory scoped to the session;
- resource requests/limits sufficient for diagnostics but not an unbounded pod.

The support agent is a purpose-built supervisor, not a general inbound daemon. It:

1. Reads and consumes the connector token.
2. Connects outbound to the relay over TLS and authenticates in the first frame.
3. Receives a reconnect token and stores it only in the memory-backed volume.
4. Creates at most one PTY.
5. Enters the host mount/PID/network namespaces through a fixed wrapper and starts the approved shell.
6. Relays stdin, stdout, resize, signal, and exit frames through bounded queues.
7. Records every accepted input and emitted output event before forwarding it.
8. Enforces the 30-minute idle timeout, two-minute detached grace, 100 MB recording cap, expiry, and fail-closed recording behavior.
9. Emits only redacted lifecycle logs; it never logs token values or terminal payloads.

After the first authenticated appliance connection, the host service deletes the connector Secret. Pod restart within the same Kubernetes pod uses the in-memory reconnect token. Pod replacement or host reboot requires the host service to exchange the root-local resume grant for a new connector token.

### Release-manifest integration

Extend `alga.appliance.release/v1` compatibly with:

```json
{
  "supportAgent": "ghcr.io/nine-minds/alga-appliance-support-agent@sha256:<digest>"
}
```

Requirements:

- Validate an exact repository plus `sha256` digest; reject tags and unexpected registries.
- Preserve the field when application, config, or control-plane pointers move.
- Resolve the current selected channel when enabling Support Mode so an installed application release does not pin an obsolete support agent forever.
- Do not start Support Mode when the field is absent or invalid. The UI reports that a control-plane/channel update is required.
- Persist the chosen immutable ref in local session metadata for audit and reboot recreation.

### Local API

Add authenticated, same-origin routes in `server.mjs`:

- `GET /api/support-sessions` — capability, active session summary, and retained history.
- `POST /api/support-sessions` — validate duration, establish central session, and provision the pod.
- `POST /api/support-sessions/:id/extend` — allow only the preset ladder and central approval.
- `POST /api/support-sessions/:id/revoke` — persist tombstone, stop locally, then close centrally.
- `GET /api/support-sessions/:id/recording` — stream the finalized recording with strict path/ID validation.
- `GET /api/support-sessions/:id/recording/metadata` — segments, sizes, digest receipts, verification result.
- `DELETE /api/support-sessions/:id/recording` — closed sessions only.

Return structured error codes for entitlement, connectivity, provisioning timeout, invalid duration, already active, central rejection, image unavailable, pod failure, expired/revoked resume grant, recording full, recording I/O failure, and cleanup failure. Secrets and codes must never enter errors.

### Local UI

Add Manage → Support using existing appliance UI components and theme tokens. Every interactive control receives a unique reflection-system ID.

States:

- Essentials: disabled, “Available with Pro.”
- Pro without appliance credential/connectivity: disabled, explain connected-appliance requirement and preserve support-bundle guidance.
- Eligible idle: duration selector, root-access/recording disclosure, Enable Support Mode confirmation.
- Provisioning: progress with no code visible.
- Ready/unredeemed: copyable code, expiry countdown, Revoke.
- Redeemed/connected: named operator, connection time/state, expiry, recording bytes, Extend, Revoke.
- Reconnecting/rebooting: non-alarming interrupted state and remaining grace/window.
- Closed: stop reason and recording view/download/delete actions.
- Failure: actionable retry guidance without leaking central or token detail.

The recording viewer is read-only and operates only on finalized segments. It verifies each digest against the signed receipt before playback and clearly marks missing/invalid receipts.

## Central control-plane design

### Persistent data model

Create PostgreSQL migrations for:

`support_sessions`

- UUID primary key and stable appliance/tenant identity.
- Normalized edition and entitlement verification timestamp.
- HMAC share-code hash and key version; never plaintext.
- State machine: `pending_ack`, `provisioning`, `ready`, `redeemed`, `connected`, `disconnected`, `revoked`, `expired`, `failed`.
- Original activation, requested duration, expiry, redemption, first/last connection, and closure timestamps.
- Bound operator subject/email, never a mutable display name as identity.
- Hashed resume grant, token/key versions, relay assignment, byte counters, stop reason, and recording digests.
- Optimistic version for atomic transitions.

`support_session_events`

- Monotonic event sequence per session.
- Event type, actor type, operator subject where applicable, timestamp, and bounded metadata JSON.
- No code, credential, connector/resume token, terminal content, command text, or PTY frame.

Add indexes for active appliance uniqueness, expiry cleanup, code hash lookup, operator history, and one-year retention. Enforce one non-terminal session per appliance with a database constraint, not only application checks.

### Codes and tokens

- Generate ten Crockford Base32 characters using a CSPRNG and render `XXXXX-XXXXX`.
- Normalize case and hyphen placement only; reject ambiguous/invalid characters.
- Store `HMAC-SHA-256(key-version, normalized-code)` and compare in constant time.
- Return plaintext once to the appliance create call; never make it retrievable centrally.
- Atomically consume on first authorized redemption. Subsequent attempts return a generic invalid/used response.
- Apply per-operator, per-source, and global rate limits in Redis and emit content-free denial events.
- Use short-lived signed tokens with audience, role, session UUID, expiry, and unique JTI. Consume one-use JTIs atomically in Redis.
- Send all WebSocket tokens in the first frame. Query strings and `Sec-WebSocket-Protocol` must not carry secrets.
- Separate signing audiences/keys for appliance connector, operator socket, resume exchange, and recording receipt.
- Support current and previous verification keys for rotation; include key IDs in tokens/receipts.

### REST contracts

Appliance-authenticated routes:

- `POST /v1/appliance/sessions`
- `POST /v1/appliance/sessions/:id/acknowledge`
- `DELETE /v1/appliance/sessions/:id` (abandon `pending_ack` only)
- `GET /v1/appliance/sessions/:id`
- `POST /v1/appliance/sessions/:id/extend`
- `POST /v1/appliance/sessions/:id/revoke`
- `POST /v1/appliance/sessions/:id/resume`
- `POST /v1/appliance/sessions/:id/recordings/checkpoint`
- `POST /v1/appliance/sessions/:id/recordings/finalize`

Operator routes behind Cloudflare Access:

- `POST /v1/operator/sessions/redeem`
- `GET /v1/operator/sessions`
- `GET /v1/operator/sessions/:id`
- `POST /v1/operator/sessions/:id/connect-token`

Internal relay routes/events update readiness, presence, counters, and stop reasons through service authentication. Define JSON schemas for every request, response, and error; reject unknown security-sensitive fields.

### Relay protocol

Use a versioned protocol on `wss://<relay>/v1/sessions/<non-secret-session-uuid>`.

- The first frame is an authentication envelope carrying protocol version, role, and scoped token.
- Control frames cover ready, attach, detach, resize, signal, exit, heartbeat, error, recording checkpoint, and close reason.
- Terminal input/output use binary frames with an explicit direction/type prefix and sequence number.
- Enforce monotonic sequence numbers, maximum frame size, bounded per-peer buffering, heartbeat deadlines, one appliance socket, and one operator socket.
- Apply backpressure. If buffers exceed the hard limit, terminate the shell/session with a recorded reason; never drop terminal input/output silently.
- The relay treats payload frames as opaque and must not log, inspect, transform, sample, trace, or persist them.
- Both TLS legs terminate in vendor infrastructure in v1. The protocol version reserves negotiation for later application-layer encryption.
- Use the session UUID path for ingress consistent hashing. Redis records the active relay lease and one-per-role presence; it does not carry terminal frames.
- Relay replica loss causes reconnect and re-pairing. The appliance PTY’s two-minute grace, not relay memory, preserves the interactive shell.

### Recording integrity and retention

- Store each local segment as versioned asciicast-compatible JSON lines with explicit input, output, resize, marker, and exit events.
- Hash exact bytes incrementally with SHA-256. Send bounded progress checkpoints containing sequence/byte count/digest only.
- On segment closure, send the final digest and receive a signed receipt containing session UUID, segment UUID, byte count, digest, closure time, and key ID.
- Persist the receipt beside the segment. The local UI verifies it with a baked/published public key.
- A reboot creates a new segment linked to the previous receipt digest and inserts an explicit interruption marker.
- Apply the 100 MB cap across the complete session, not independently per segment.
- A write, fsync, digest, checkpoint-policy, or storage-cap failure closes the PTY before any further operator input is accepted.
- Prune local content after 30 days. Prune central events/session metadata after one year using a tested scheduled job.

## State and failure rules

- Appliance create is idempotent by a client request ID. The initial successful response returns plaintext code/tokens once. The appliance atomically persists them, then calls `acknowledge`; only acknowledged sessions may provision a relay or redeem a code.
- A retry for the same client request ID returns session ID/state but never re-returns code/tokens. If the appliance cannot prove local persistence, it abandons that unacknowledged session through appliance authentication and creates a new client request ID. Unacknowledged sessions auto-expire after a short bounded deadline and can never become Ready.
- Provisioning is not Ready until the appliance WebSocket is authenticated and the support pod reports recorder readiness.
- Local cleanup is authoritative for loss of access. Central cleanup is authoritative for token/code invalidation and maximum expiry. Both sides reconcile toward closed.
- Revocation wins every race against extension, redemption, connect, resume, and reconnect.
- Expiry wins every race against reconnect or token refresh.
- Code redemption and operator binding are one transaction.
- Extension never changes the bound operator or original activation timestamp.
- Resume never creates a new code and never succeeds for a revoked/expired session.
- A central outage before enable produces no usable code. A central outage after enable leaves the existing shell subject to local expiry/recording policy and retries metadata closure when connectivity returns.
- If the local state file is missing/corrupt but a labeled support pod exists, fail closed and delete the pod.
- If state says active but no pod exists, reconcile through the resume flow only when central status confirms active.
- On process startup, cleanup and expiry reconciliation run before the local API begins accepting mutation requests.

## Security requirements

- Threat-model the appliance administrator, support operator, compromised code, compromised browser, compromised relay, local unprivileged user, and stale/replayed tokens before implementation.
- Document that the support pod is intentionally root-equivalent while active.
- Never expose SSH, a NodePort, LoadBalancer, host port, or LAN listener.
- Do not mount the long-lived appliance credential into the support pod.
- Do not mount a Kubernetes service-account token into the support pod.
- Pin all customer-shipped and central images by digest in production deployment.
- Validate TLS certificates normally; no insecure bypass or certificate pinning fallback.
- Verify Cloudflare Access JWTs in the application even though Access also enforces at the edge.
- Use a dedicated Access audience and group policy for support operators.
- Use constant-time secret comparisons and redact headers/bodies at every logging boundary.
- Disable request-body logging for code redemption, appliance authentication, token exchange, and relay upgrade paths.
- Treat session UUIDs, appliance IDs, tenant IDs, operator subjects, IPs, and timestamps as audit metadata; restrict audit access to the support group.
- Sign recording receipts with a key isolated from relay workers.
- Ensure database backups contain no terminal content or plaintext codes/tokens.

## Implementation sequence

The order is contractual. Do not expose the customer enable control until credential verification, central policy enforcement, relay authentication, recording fail-closed behavior, and cleanup reconciliation are all available.

### Phase 1 — Freeze contracts and threat model

- Define state machines, REST schemas, frame protocol v1, token audiences, error codes, retention, redaction rules, and recording format.
- Produce sequence tests/fixtures shared by appliance and central implementations.
- Freeze the create/acknowledge/abandon handshake and its timeout so plaintext code recovery is deterministic without central plaintext retention.
- Review the threat model and root-equivalent pod spec before service implementation.

### Phase 2 — Credential verification in `alga-license`

- Implement and DB-test `/verify-appliance`.
- Deploy it behind service authentication only.
- Update the existing AI gateway verifier test/contract if the finalized response adds fields while preserving its current tenant/edition expectations.

### Phase 3 — Central persistence and policy API

- Scaffold the new private repository and CI.
- Add PostgreSQL migrations/repositories and Redis adapters.
- Implement Cloudflare Access verification, codes, token issuance, atomic state transitions, rate limits, audit events, and retention.
- Complete real Postgres/Redis integration tests before adding sockets.

### Phase 4 — Relay and operator UI

- Implement authenticated role pairing, frame/backpressure rules, relay leases, reconnect, and payload-safe logging.
- Add the support-focused UI: redeem code, active/recent sessions, identity/status, terminal, reconnect state, and audit timeline.
- Exercise replica loss and token replay against a real relay/Redis test environment.

### Phase 5 — Support-agent image and release metadata

- Implement the PTY supervisor/recorder and build the multi-arch image.
- Add `supportAgent` validation to appliance release parsing.
- Add build/publish and release-pointer preservation in `nm-kube-config`.
- Verify the release manifest always contains an immutable approved repository digest before enabling UI work.

### Phase 6 — Appliance session engine

- Add central client, atomic local state, Kubernetes pod/Secret builder, timers, startup reconciliation, revocation tombstones, resume, and retention.
- Keep this logic dependency-injected and testable without a live cluster.
- Add local APIs only after the manager’s race and cleanup tests pass.

### Phase 7 — Appliance UI and recording review

- Add entitlement/capability states, duration confirmation, provisioning, code display, active status, extension, revocation, history, receipt verification, playback, download, and delete.
- Validate light/dark themes, unique element IDs, keyboard access, and narrow layouts.

### Phase 8 — Infrastructure and end-to-end rollout

- Deploy alga-license verifier, database/Redis, control API, relay, Access policy, DNS/TLS, routing, metrics, and alerts.
- Run appliance VM smoke tests against a non-production control plane.
- Publish the support agent, then the compatible appliance control-plane image, then move the selected release/control-plane pointers after approval.
- Enable production access only after revocation, expiry, reboot resume, recording failure, and relay-loss drills pass.

## Feature checklist

- [ ] F001 — Connected Pro capability is distinguished from Essentials and disconnected Pro.
- [ ] F002 — An appliance administrator can enable one-, four-, or eight-hour Support Mode locally.
- [ ] F003 — The central service verifies appliance identity and current entitlement without exposing credentials.
- [ ] F004 — A digest-pinned privileged support pod is created with no service-account token or inbound listener.
- [ ] F005 — The code is revealed only after the recorder and appliance relay socket are ready.
- [ ] F006 — Share codes are random, human-readable, hash-only centrally, rate-limited, and single-use.
- [ ] F007 — Cloudflare-authenticated support-group operators can redeem a code.
- [ ] F008 — First redemption atomically binds one named operator for the window.
- [ ] F009 — One operator can open one root-equivalent host PTY through the relay.
- [ ] F010 — WebSocket tokens are scoped, one-use, and sent only in the first frame.
- [ ] F011 — Relay forwarding is opaque, ordered, backpressured, and content-free in logs/storage.
- [ ] F012 — Thirty-minute idle and two-minute same-PTY reconnect policies are enforced.
- [ ] F013 — The local administrator can extend only along the approved ladder up to eight hours from activation.
- [ ] F014 — Local revocation immediately removes access and prevents reboot resume.
- [ ] F015 — Expiry closes sockets/PTY and deletes support resources independently on both sides.
- [ ] F016 — Reboot recreates the pod and resumes the same authorized session without extending it.
- [ ] F017 — Input/output/control events are recorded locally in ordered, digest-verifiable segments.
- [ ] F018 — Recording failure or the 100 MB total cap terminates access before unrecorded input is accepted.
- [ ] F019 — Customers can verify, play, download, and delete finalized local recordings.
- [ ] F020 — Local recordings auto-prune after 30 days; central content-free metadata auto-prunes after one year.
- [ ] F021 — Operator UI shows code redemption, resolved identity, terminal, reconnect state, and audit history only.
- [ ] F022 — Central persistence never contains terminal content, plaintext codes, or connector/resume/socket tokens.
- [ ] F023 — Existing connected appliances receive the feature through support-agent and control-plane image pointers without an ISO/host-agent update.
- [ ] F024 — Support bundles and local access remain the documented fallback for ineligible/offline appliances.

## Pareto test plan

### Appliance unit/integration tests

- [ ] T001 — Capability matrix: connected Pro enables; Essentials and disconnected Pro return distinct disabled reasons.
- [ ] T002 — Session manager happy path: credential exchange, durable create acknowledgement, Secret/pod creation, readiness, and code reveal.
- [ ] T003 — Session manager guard cases: invalid duration, second active session, missing/invalid support image, central rejection, and provisioning timeout leave no usable code or resources.
- [ ] T004 — Kubernetes spec contract: digest pin, privileged/root/host PID/host mount, no service-account token, scoped Secret, active deadline, labels, and resources.
- [ ] T005 — Atomic race suite: revoke beats extend/redeem/resume; expiry beats reconnect; simultaneous enable creates one session/pod.
- [ ] T006 — Startup reconciliation: active valid session resumes; revoked/expired/invalid grant cleans up; corrupt/missing state plus pod fails closed.
- [ ] T007 — Recording suite: ordered input/output/resize/exit, segment chaining, signed receipt verification, reboot boundary, 100 MB total cap, I/O failure, and fail-closed PTY termination.
- [ ] T008 — Retention suite: active content is preserved, closed content prunes at 30 days, manual delete is closed-only, and path traversal/unknown IDs are rejected.
- [ ] T009 — Local API authentication, same-origin enforcement, structured error redaction, and method validation.
- [ ] T010 — React behavior: eligibility states, confirmation, hidden-until-ready code, copy, countdown, operator state, extension ladder, revoke, and recording verification warnings.

### `alga-license` DB-backed tests

- [ ] T011 — Real Postgres happy path resolves credential → appliance/tenant/active Pro entitlement and returns no secret fields.
- [ ] T012 — Real Postgres guards reject unknown, revoked, malformed, and unauthenticated requests without credential enumeration; valid Essentials/inactive identity is returned as ineligible and central session creation rejects it.

### Central control-plane integration tests

- [ ] T013 — Real Postgres/Redis create/redeem flow proves hash-only code storage, atomic single consumption, one active appliance constraint, operator binding, and audit events.
- [ ] T014 — Access auth rejects bad issuer/audience/signature/expiry and missing support-group evidence; accepted identity is carried into every operator event.
- [ ] T015 — Rate limits and token replay: repeated code guesses throttle; consumed JTIs cannot reconnect; tokens fail for wrong role/session/audience/expiry.
- [ ] T016 — Revocation/expiry concurrency against real persistence leaves the session terminal and prevents later connect/resume.
- [ ] T017 — One-year retention deletes eligible metadata/events while preserving newer and active rows.

### Relay tests

- [ ] T018 — Real WebSocket happy path pairs one appliance and one operator and preserves ordered binary/control frames without persistence.
- [ ] T019 — Backpressure, oversized frame, sequence violation, heartbeat loss, second peer, wrong role, and excessive buffer close with deterministic reasons.
- [ ] T020 — Operator disconnect reattaches within two minutes; after grace the old PTY closes and a new PTY can open within the window.
- [ ] T021 — Relay replica loss plus consistent re-routing permits both peers to reconnect without changing authority or expiry.
- [ ] T022 — Log/trace inspection proves codes, credentials, tokens, and terminal payloads are absent.

### End-to-end appliance smoke tests

- [ ] T023 — Connected Pro VM: enable → code → Access-authenticated redeem → root host command → local recording → revoke → pod/Secret/socket cleanup.
- [ ] T024 — Duration/expiry VM: extend 1→4, reject beyond eight hours, and prove hard expiry closes a live terminal and deletes resources.
- [ ] T025 — Reboot VM: run a session, reboot from the remote shell, observe segment boundary and automatic pod/session resume, then reconnect the same operator.
- [ ] T026 — Recording failure VM: fill or deny the recording target and prove the shell terminates before further commands execute.
- [ ] T027 — Network fault VM: block relay, observe bounded reconnect state, restore before expiry, and verify transcript continuity/markers.
- [ ] T028 — Ineligible/offline VM: Essentials and disconnected Pro cannot create remote sessions and retain support-bundle guidance.

Do not use source-string tests as the only evidence for runtime, database, Kubernetes, or UI behavior.

## Observability and operations

- Emit structured lifecycle events with session UUID, role, state transition, counts, timings, and stop reason only.
- Explicitly suppress request bodies, WebSocket frames, authorization headers, codes, and token-bearing responses from application, ingress, tracing, and error-reporting capture.
- Metrics: active/provisioning sessions, relay peers, create/redeem/connect latency, reconnects, revocations, expiries, recording failures, rejected auth, rate limits, and cleanup lag.
- Alerts: provisioning failure rate, session cleanup past expiry, relay peer saturation, database/Redis failure, credential-verifier failure, and recording-finalization failure.
- Provide a content-free operator audit export and a runbook for forced central revocation.
- Rotate code-HMAC, token-signing, resume-grant, receipt-signing, and service-auth keys independently with key IDs and overlap windows.
- Validate backups and log sinks for absence of terminal payloads and plaintext secrets.

## Rollout and compatibility

1. Land and deploy `/verify-appliance`; verify the existing AI gateway contract remains healthy.
2. Deploy the central control plane and relay with operator access restricted to a test group.
3. Publish the support-agent image and add the immutable pointer to a non-production appliance channel.
4. Publish the appliance control-plane image containing the local manager/UI and point a test appliance channel at it.
5. Exercise T023–T028 on the existing appliance VM matrix, including upgrade of an already-installed appliance.
6. Complete security review of pod spec, tokens, Access policy, logging, and recording integrity.
7. Move stable pointers only after explicit approval and retain the prior control-plane/release refs for rollback.

Rollback central access by disabling the Cloudflare Access application/group and rejecting new/resume token issuance. Roll back appliance enablement by moving the control-plane pointer to the prior image. Existing active sessions must still be centrally revocable and expire at their original deadline; rollback must not orphan privileged pods, so the old image cannot be restored until active sessions are zero or a cleanup job has removed them.

## Acceptance criteria / definition of done

- All F001–F024 behaviors are implemented in their owning repositories.
- All T001–T028 tests pass, including real database, Redis, WebSocket, browser, and appliance VM coverage.
- A previously installed connected Pro appliance gains the feature without a new ISO or host-agent update.
- No inbound appliance port or standing remote daemon is introduced.
- The long-lived appliance credential never enters the support pod.
- A code alone cannot grant access; an authorized Cloudflare Access operator identity is always required.
- Exactly one operator, shell, and active window are enforced.
- Revocation, expiry, idle timeout, reboot, relay loss, and recording failure produce the specified deterministic outcomes.
- Reboot resumes only the same unexpired, unrevoked session and never extends authority.
- Every executed terminal byte is represented in a locally retained, verifiable recording or the shell fails closed.
- Central databases, caches, logs, traces, metrics, and backups contain no terminal input/output or plaintext codes/tokens.
- Local retention is 30 days; central metadata retention is one year.
- Operator and appliance documentation describe eligibility, consent, root-equivalent scope, revocation, recordings, reboot behavior, and offline fallback.
- Production deployment has approved Access policy, key rotation, alerts, revocation runbook, and rollback procedure.

## Deliberate design decisions

- Dedicated control-plane UI rather than product UI or extension terminal: root support has a distinct trust and availability boundary.
- Dedicated relay rather than Hocuspocus/Yjs: PTY traffic is ordered duplex bytes, not collaborative document state.
- TLS WebSockets rather than WebRTC: port 443 outbound traversal is sufficient; WebRTC would commonly fall back to TURN and add complexity.
- Appliance-owned recording rather than central terminal storage: the customer retains the sensitive audit artifact.
- Payload-blind relay rather than v1 application-layer encryption: both legs use TLS and the authorized operator is already trusted to view content; the protocol remains versioned for later encryption.
- Privileged pod rather than direct SSH: access is ephemeral, customer-windowed, attributable, recordable, and automatically removable.
- Control-plane-owned orchestration rather than host-agent changes: the control plane is registry-updatable on existing appliances, while the host agent is ISO-baked.

## Open questions

No product-design questions remain. Implementation must validate two environment-specific contracts before production rollout without changing the approved behavior:

1. The exact Cloudflare Access claim or identity lookup used as support-group evidence.
2. The final production hostnames and Kubernetes namespace/database names for the new control API and relay.
