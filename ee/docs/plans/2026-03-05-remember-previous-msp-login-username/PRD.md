# PRD — Remember Previous MSP Login Username

- Slug: `remember-previous-msp-login-username`
- Date: `2026-03-05`
- Status: Draft

## Summary

Reduce repeated friction on the MSP sign-in page by remembering the last successfully signed-in email address and pre-filling it when the user returns. This is specifically valuable because MSP SSO behavior is chosen from the email domain, so the user cannot see the correct SSO path until they first enter their email.

## Problem

The current MSP sign-in flow requires the user to type their email address every time before the UI can determine whether the email domain should receive:

- no SSO options
- tenant-managed SSO options
- Nine Minds managed SSO options

This is repetitive for returning users and slows down both credential and SSO login flows. It is especially noticeable because the email field is not just an identifier for sign-in, it is also the input to SSO discovery.

## Goals

- Prefill the MSP sign-in email field with the last successfully signed-in email address on that workstation.
- Save the email only after a successful sign-in.
- Default to remembering the email without requiring an extra opt-in step.
- Allow the user to opt out on a per-sign-in basis with a clear `public workstation` control.
- Clear any existing remembered email after a successful public-workstation sign-in.
- Support the behavior consistently across both credentials and SSO-based sign-in.

## Non-goals

- Do not change client portal sign-in behavior.
- Do not change NextAuth session persistence or session lifetime.
- Do not store attempted or failed-login email addresses.
- Do not redesign the broader MSP sign-in layout beyond the checkbox and prefill behavior.
- Do not replace the existing remembered SSO-provider `localStorage` behavior.

## Users and Primary Flows

### Returning MSP user on a private workstation

1. User revisits `/auth/msp/signin`.
2. The page pre-fills the email field with the last successfully used MSP email.
3. The user either signs in with credentials or uses the now-immediately-discoverable SSO option.
4. On successful sign-in, the remembered email remains updated for future visits.

### MSP user on a public workstation

1. User enters an email and checks `Public workstation - do not remember my email`.
2. User signs in successfully with credentials or SSO.
3. The system clears any existing remembered MSP email cookie on that machine.
4. A later visit to `/auth/msp/signin` does not prefill the prior email.

### Failed sign-in

1. User attempts credential or SSO sign-in.
2. Authentication fails or the flow is abandoned.
3. The durable remembered email does not change.

## UX / UI Notes

- Apply only to the MSP sign-in page.
- Prefill the email field when a remembered value exists.
- Add a checkbox below the password field labeled `Public workstation - do not remember my email`.
- The checkbox defaults to unchecked.
- The remembered email should be normalized to trimmed lowercase before persistence.
- Prefill should not interfere with domain-based SSO discovery; the existing discovery behavior should react to the prefilled email the same way it reacts to typed input.

## Requirements

### Functional Requirements

- The MSP sign-in server route must read a remembered-email cookie and pass the value into the login form as the initial email.
- The MSP login form must initialize the email field from the provided remembered-email value.
- The MSP login form must render a `Public workstation - do not remember my email` checkbox that defaults to unchecked.
- A successful credentials sign-in with the checkbox unchecked must write the normalized email to a 180-day remembered-email cookie.
- A successful credentials sign-in with the checkbox checked must clear any existing remembered-email cookie.
- Failed credentials sign-ins must not set, update, or clear the remembered-email cookie.
- SSO start must include the normalized email and public-workstation preference when resolving the provider.
- SSO resolution must persist a short-lived pending remember-context cookie for use after the OAuth redirect.
- A successful OAuth sign-in with opt-out unchecked must promote the pending remember-context into the 180-day remembered-email cookie.
- A successful OAuth sign-in with opt-out checked must clear any existing remembered-email cookie.
- Failed or abandoned OAuth flows must not create or update the durable remembered-email cookie.
- Pending remember-context must be cleared after callback processing.
- Remembered-email behavior must remain isolated to MSP sign-in and must not affect client portal auth.
- Existing localStorage-based preferred SSO provider behavior must continue to work.

### Non-functional Requirements

- The durable remembered-email cookie should be `HttpOnly`.
- The durable remembered-email cookie should use a 180-day max age.
- The remember feature should fail closed: invalid or missing remember-context should not break sign-in.
- The implementation should minimize duplication between credentials and SSO flows while keeping the persistence semantics clear.

## Data / API / Integrations

- Add a durable cookie for the last remembered MSP email.
- Add a short-lived pending remember-context cookie to bridge the SSO redirect.
- Add or extend a server endpoint used after successful credentials sign-in to set or clear the durable cookie.
- Extend the MSP SSO resolve route to accept the remember-context payload and persist pending state.
- Extend the relevant NextAuth or OAuth callback path to finalize the remembered-email cookie after successful SSO completion.

## Security / Permissions

- Do not persist email addresses before successful authentication.
- Clear existing remembered-email state on successful public-workstation sign-in.
- Store only the minimum needed remember-context for SSO bridging.
- Keep durable remembered-email state separate from session cookies and separate from OAuth resolution cookies.
- Fail closed if the remember-context cannot be parsed or validated.

## Observability

- Reuse safe structured auth logging patterns where helpful.
- Avoid logging raw remembered email values in server logs unless existing auth logging policy already permits it.
- If remember-related log lines are added, they should record only coarse outcome states such as `set`, `cleared`, or `ignored`.

## Rollout / Migration

- No database migration is required.
- Roll out as an MSP-only auth UI and cookie behavior change.
- Existing users without a remembered cookie continue to see the current empty email field until their first successful sign-in after deployment.

## Open Questions

- Whether the remember cookie should be scoped narrowly to the sign-in path or more broadly to auth paths used during SSO finalization.
- Whether the credentials success cookie update should use a dedicated endpoint or be folded into an existing auth response surface.

## Acceptance Criteria (Definition of Done)

- Returning MSP users see their last successfully used email prefilled on `/auth/msp/signin` when they did not opt out on their prior successful sign-in.
- The `Public workstation - do not remember my email` checkbox is visible on the MSP sign-in form and defaults to unchecked.
- Successful credentials sign-in remembers the normalized email for 180 days when opt-out is unchecked.
- Successful credentials sign-in clears any existing remembered email when opt-out is checked.
- Successful SSO sign-in remembers or clears the email using the same rules as credentials sign-in.
- Failed credentials sign-ins do not change remembered-email state.
- Failed or abandoned SSO flows do not change durable remembered-email state.
- Client portal sign-in behavior remains unchanged.
