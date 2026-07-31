# PRD — Appliance Initial-Admin Password Recovery

- Slug: `appliance-admin-password-recovery`
- Date: `2026-07-10`
- Status: Approved

## Summary

Align initial-admin password hashing with the appliance application's existing PBKDF2 configuration and add an authenticated, local recovery control for resetting the original Alga application administrator's password.

## Problem

The appliance temporal worker hashes with 10,000 PBKDF2 iterations while the appliance Alga application verifies with 1,000. The hash format does not encode its parameters. Initial admins created through the Temporal tenant workflow can therefore be unable to authenticate even when the correct password reached user creation. Appliances already installed need a recovery mechanism that does not depend on outbound email or a new Alga network endpoint.

## Goals

- Hash all future appliance initial-admin passwords with the application's 1,000-iteration configuration.
- Let an authenticated appliance operator reset only the original Alga application admin password.
- Use the application's hashing implementation and effective secrets/configuration.
- Avoid plaintext password exposure and clean up all transient reset resources.

## Non-goals

- Changing hosted password hashing.
- Changing existing appliance users from 1,000 to 10,000 iterations.
- Resetting arbitrary Alga users.
- Adding an emailed recovery dependency.
- Introducing a persistent Alga password-reset API.

## Users and Primary Flows

An authenticated appliance administrator opens the appliance status UI, enters and confirms a replacement password for the displayed original Alga admin, submits the reset, waits for the short-lived Job, and then signs into Alga with the replacement password.

## UX / UI Notes

- Place a **Reset Alga admin password** control on the authenticated status UI.
- Display the immutable original admin email for orientation; do not offer a user picker.
- Require new password and confirmation using the setup password policy.
- Show a busy state, a success confirmation, and generic actionable failure text.
- Never display, echo, or retain the submitted password after completion.

## Requirements

### Functional Requirements

- The appliance temporal-worker overlay sets PBKDF2 iterations to 1,000 and preserves salt bytes 12, key length 64, and SHA-512.
- Hosted temporal-worker defaults remain unchanged.
- Only an authenticated appliance management session can request a reset.
- The host service derives the target tenant and original admin email from appliance state.
- The host service creates a transient Secret and a uniquely named Kubernetes Job using the current Alga core image.
- The Job uses application-equivalent database, pepper, and PBKDF2 configuration.
- The reset script requires exactly one matching internal user and updates only that user's `hashed_password`.
- The host service prevents concurrent reset Jobs and cleans up Job and Secret resources.

### Non-functional Requirements

- Plaintext passwords must not appear in command arguments, resource metadata, logs, status output, support bundles, or responses.
- A browser disconnect must not corrupt user data or prevent fallback cleanup.
- Database mutation must be atomic and must fail closed on an unexpected target count.

## Data / API / Integrations

- Browser to appliance host service: authenticated local reset request.
- Host service to Kubernetes API: create/read/delete Secret and Job resources.
- Job to PostgreSQL: scoped lookup and single-row password hash update.
- Job uses `@alga-psa/core/encryption` with application-equivalent environment variables.

## Security / Permissions

- Reuse appliance management session enforcement.
- Do not accept tenant ID or target email from the browser.
- Keep Kubernetes RBAC limited to the resources required for reset execution.
- Use short resource lifetime and best-effort immediate deletion plus Job TTL.

## Observability

No new production observability is required. Existing control-plane logs may record reset start, completion, and generic failure without user credentials or plaintext values.

## Rollout / Migration

- Ship the temporal-worker values override for fresh/future tenant creation.
- Ship the recovery UI and Job path for existing affected appliances.
- No automatic database rewrite is possible because the existing hash cannot be converted without the plaintext password.

## Open Questions

None.

## Acceptance Criteria (Definition of Done)

- A fresh appliance initial admin can sign in with the setup password.
- An authenticated operator can reset the original Alga admin password locally.
- The replacement password passes the application's normal verifier and the previous password fails.
- No other tenant or user is modified.
- Hosted temporal-worker hashing remains at 10,000 iterations.
- Automated tests and an appliance smoke test cover the critical path.

