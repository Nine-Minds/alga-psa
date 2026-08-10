# Microsoft Inbound Email OAuth App Selection

## Problem

Microsoft inbound email currently resolves the tenant `Email` binding when choosing an OAuth application. That binding is not an authoritative issuer record and may point at Teams or another application. The resulting redirect URI/client mismatch can fail Microsoft authorization with `AADSTS50011`.

## Goals

- Require an explicit choice between the managed Microsoft application and an eligible tenant Microsoft profile when creating or reconnecting inbound email.
- Treat the provider row's issuer identity as authoritative after connection.
- Use the tenant `Email` binding only as the create-flow default and as a conservative legacy migration hint.
- Allow secret rotation when the client ID is unchanged; require reconnect for every client-ID change.
- Leave all Teams behavior, bindings, and credentials untouched.

## Product behavior

### Create

The UI presents an explicit issuer choice. It recommends the hosted/managed application when ready and also lists eligible tenant profiles. The submitted create request carries the selected choice explicitly; the server never infers the final choice solely from the `Email` binding.

### Reconnect

The UI displays the current authoritative issuer and requires an explicit reconnect choice. Changing the client ID shows a warning that reconnect is required. Rotating a secret for the same client ID does not require reconnect.

### Current issuer

Connected providers display whether their issuer is managed or a named tenant profile, using the persisted provider-row identity rather than the current binding.

## Server invariants

Before authorization, the server verifies tenant ownership, active status, Microsoft provider type, `Email` capability, credential readiness, redirect readiness, and required consent configuration. Tenant profiles that are Teams-only or otherwise ineligible are rejected.

OAuth state is signed and contains tenant ID, provider ID, explicit issuer choice, client ID, nonce, and purpose (`create` or `reconnect`). It never contains a client secret or secret reference.

The callback verifies signature, expiry, nonce single use, tenant/provider relationship, purpose, selected profile eligibility, and that the client ID still matches the selected issuer. After token exchange, credentials and issuer metadata are persisted atomically. A failed callback preserves the previous working connection.

## Persistence and compatibility

Reuse the existing `microsoft_profile_id` and `client_secret_ref` migration and columns; do not introduce duplicated secret storage. For managed and legacy rows, persisted `client_id` is the authoritative issuer identifier. For tenant-profile rows, `microsoft_profile_id` identifies the profile and persisted `client_id` must agree with it.

Legacy backfill is conservative: populate a tenant profile only when the existing provider client ID has exactly one eligible same-client match. Ambiguous, missing, cross-tenant, inactive, or non-Email-capable matches remain legacy rows with `client_id` authoritative. The `Email` binding may narrow a same-client candidate but may never override a different persisted client ID.

## Runtime resolution

Runtime token refresh and mailbox access resolve credentials from provider-authoritative issuer metadata. Same-client secret rotation may update `client_secret_ref`. A different client ID is rejected with a reconnect-required error. Binding changes cannot silently change the issuer of an existing connection.

## Stable errors

Expose stable machine-readable errors for invalid choice, profile not found, cross-tenant profile, inactive profile, missing Email capability, issuer not ready, consent not ready, client mismatch/reconnect required, invalid state, expired state, replayed state, and callback persistence failure. User-facing copy may evolve independently.

## Rollout

1. Ship DTOs, validation, signed state, callback revalidation, and atomic persistence behind the existing Microsoft inbound-email boundary.
2. Ship provider-authoritative runtime resolution and observability for legacy fallbacks.
3. Run conservative same-client backfill with ambiguity reporting and no Teams mutations.
4. Enable the explicit create/reconnect UI and current-issuer display.
5. Monitor stable error codes, authorization completion, refresh failures, and legacy fallback counts before removing compatibility paths.

## Acceptance criteria

- Create and reconnect require an explicit managed or eligible tenant-profile choice.
- Hosted deployments recommend the ready managed application without silently selecting it server-side.
- Only active, tenant-owned, Email-capable, ready and consent-ready tenant profiles are selectable.
- Signed OAuth state includes tenant, provider, choice, client ID, nonce, and purpose, and contains no secret.
- Callback revalidation prevents cross-tenant, stale-choice, tampered, expired, and replayed authorization.
- Successful callbacks atomically persist tokens and authoritative issuer metadata; failures preserve old credentials.
- Existing providers continue using their persisted issuer when the tenant `Email` binding changes.
- Same-client secret rotation succeeds without reconnect; every client-ID change returns reconnect required.
- Legacy backfill occurs only for a unique eligible same-client match; ambiguous rows remain unchanged.
- Teams selection and operation are unchanged.
- APIs return stable machine-readable error codes for all guarded failure modes.
