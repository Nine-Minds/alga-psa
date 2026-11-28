# Restore profile access for co-managed seat users

## Problem

A signed-in seat technician selects Profile from the account menu and receives a 404. The menu points to the existing self-profile page, but the seat route policy excludes it. Technicians need to maintain their own account details.

## User flow and acceptance criteria

- A seat technician opens Profile from the account menu or loads `/msp/profile` directly. The page shows the signed-in user's details.
- The technician edits a supported personal field, saves it, and sees the saved value after reloading.
- The profile presents only controls available to that principal. The API Keys tab is unavailable to a seat technician, and a saved link to `?tab=api-keys` resolves to the personal profile without mounting key management.
- Ordinary MSP users retain their existing profile tabs according to their entitlements. The seat continues to receive a 404 on user administration and other restricted MSP routes.

## Implementation and scope

Use the existing principal route policy and the existing profile page. Apply the same tab eligibility decision to the rendered navigation and URL tab selection. Check the account-specific controls and the onboarding preference against their existing permissions. Use the authenticated current-user read and self-update paths. Keep general API-key issuance subject to the existing server-side credential policy, including its distinct handling of mobile sessions.

Scope is limited to access to one's own profile. Deliver as a single change using the existing account menu, user records, and permissions. No schema migration is required.

## Verification

Exercise navigation and reload as a seat technician, persist a personal field, and verify the restricted-tab deep link and an administration route. Check the ordinary MSP profile as a control. Reconcile the existing seat surface test with the new profile behavior and retain its credential-issuance check.
