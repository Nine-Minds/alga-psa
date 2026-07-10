# Appliance Initial-Admin Password Recovery Design

## Context

The appliance Temporal worker and hosted Temporal worker inherit PBKDF2 defaults of 10,000 iterations. The hosted Alga application also verifies with 10,000 iterations, but the appliance Alga application currently verifies with 1,000. Because the stored `salt:hash` format does not encode its PBKDF2 parameters, an initial appliance admin created by the Temporal worker can receive the correct password while still being unable to sign in.

Existing appliance users must continue to verify with the appliance application's 1,000-iteration configuration. Future initial-admin creation must therefore use 1,000 iterations, and already affected appliances need a local recovery path.

## Decisions

- Override PBKDF2 values in the appliance temporal-worker values overlay; leave hosted temporal-worker values unchanged.
- Add password recovery for only the original Alga application admin recorded during appliance setup.
- Expose recovery through the authenticated appliance management UI, not through a new Alga network endpoint.
- Execute recovery in a uniquely named, short-lived Kubernetes Job using the deployed Alga core image and application-owned password hashing implementation.
- Pass the new password through a short-lived Kubernetes Secret, never through command arguments, labels, logs, Job status, or an API response.

## Architecture and Data Flow

1. An authenticated operator opens **Reset Alga admin password** on the appliance status page.
2. The operator enters and confirms a new password. The UI and host service enforce the existing initial-admin password policy.
3. The host service derives the original admin email and tenant ID from appliance-owned state. The browser cannot choose the target user.
4. The host service rejects the request if another password-reset Job is active.
5. It creates a short-lived Secret containing the new password and a Job using the currently deployed Alga core image.
6. The Job receives the same database connection, `NEXTAUTH_SECRET`, and PBKDF2 values as the Alga application.
7. A bundled application script finds exactly one internal user matching both the original tenant and email, hashes the new password through `@alga-psa/core/encryption`, and updates only `hashed_password`.
8. The host service waits for Job completion and returns a generic success or failure. It deletes the Job and Secret after completion; a TTL provides fallback cleanup.

## Failure Handling

- Missing or ambiguous target: fail without updating any user.
- Database or hashing error: retain the existing hash and report a generic failure.
- Alga web deployment unavailable: recovery remains possible when Kubernetes, the image, and PostgreSQL are available.
- Browser disconnect: the Job continues independently and remains subject to TTL cleanup.
- Concurrent attempt: reject while an active reset Job exists.

## Security

- Appliance management authentication is required.
- The target identity is server-derived and restricted to the original setup admin.
- The plaintext password is transient and redacted from all observable metadata and logs.
- The Job uses the minimum database operation required and modifies one expected row.
- No persistent Alga reset endpoint is introduced.

## Testing

- Host-service tests cover authentication, validation, concurrency, manifest generation, cleanup, and absence of plaintext leakage.
- DB-backed integration tests prove the new password verifies through the normal application verifier, the old password fails, unrelated users remain unchanged, and missing/ambiguous targets do not mutate data.
- Helm tests prove appliance temporal-worker iterations are 1,000 while hosted defaults remain 10,000.
- UI tests cover validation and busy, success, and failure states.
- Appliance smoke testing resets the original admin through the management UI and signs into Alga with the new password.

