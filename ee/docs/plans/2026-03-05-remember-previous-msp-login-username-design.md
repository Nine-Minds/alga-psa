# Remember Previous MSP Login Username Design

- Date: `2026-03-05`
- Status: `Approved`
- Scope: `MSP sign-in only`

## Summary

The MSP sign-in experience determines available SSO options from the user's email domain. That requires the user to type their email before the UI can decide whether to show no SSO, tenant-managed SSO, or Nine Minds managed SSO. To reduce repeat friction, the login page should remember the last successfully signed-in MSP email address and prefill it on future visits.

The remembered username must only be persisted after successful authentication. The default behavior should save the username, but the user can opt out by checking a `Public workstation - do not remember my email` checkbox. A successful sign-in with that checkbox checked must clear any previously remembered username on that machine.

## Approaches Considered

### Recommended: Server-owned remembered cookie plus pending SSO intent

- Read a long-lived remembered-email cookie on the server when rendering the MSP sign-in page.
- Pass the initial email to the shared MSP login form.
- For credential sign-in, set or clear the remembered cookie only after a successful sign-in.
- For SSO sign-in, store a short-lived pending remember-context cookie before redirecting to OAuth, then finalize the remembered cookie only after the OAuth callback succeeds.

Why this approach:
- Supports the requirement that persistence happens only after successful authentication.
- Works for both credentials and SSO.
- Keeps the long-lived remembered-email cookie `HttpOnly`.
- Cleanly handles the public-workstation case by clearing previously stored data after a successful sign-in.

### Alternative: Client-only cookie logic in the login form

- The form would read and write a JS-visible cookie directly.

Why not recommended:
- Harder to guarantee `successful sign-in only`, especially across OAuth redirects.
- Requires exposing the long-lived cookie to client-side JavaScript unnecessarily.

### Alternative: Persist on the server per user

- Store a last-login username in user or tenant data.

Why not recommended:
- Wrong scope for a workstation-local convenience feature.
- Does not model the public-workstation requirement cleanly.

## UX

- On `/auth/msp/signin`, prefill the email field from the remembered-email cookie when present.
- Show a checkbox under the password field labeled `Public workstation - do not remember my email`.
- Default the checkbox to unchecked.
- A successful sign-in with the checkbox unchecked stores the normalized email for 180 days.
- A successful sign-in with the checkbox checked clears any existing remembered email cookie.
- Failed credential attempts and abandoned or failed SSO flows do not update the long-lived remembered cookie.

## Architecture

### Remembered Email Cookie

- Add a long-lived cookie for the remembered MSP email.
- Normalize the stored value by trimming and lowercasing the email.
- Use `HttpOnly` and server-side reads for the durable cookie.

### Pending SSO Remember Context

- Add a short-lived cookie used only to bridge the SSO redirect.
- Store the normalized email and whether the user selected the public-workstation opt-out.
- Finalize or clear the durable remembered-email cookie only after successful OAuth completion.
- Clear the pending cookie after callback processing.

### Page + Form Changes

- Update the server route for MSP sign-in to read the remembered cookie and pass `initialEmail` to the shared MSP login component.
- Update the shared MSP login component to:
  - initialize the email field from `initialEmail`
  - render and manage the public-workstation checkbox
  - call a remember-email endpoint after successful credentials sign-in and before redirecting
  - include remember-context when starting SSO resolution

## Error Handling

- Credentials failure must not set or clear the durable remembered-email cookie.
- Resolver or OAuth startup failure must not set the durable remembered-email cookie.
- Failed or cancelled OAuth must not promote pending remember-context into the durable cookie.
- Invalid remember-context payloads should fail closed without blocking login.

## Testing

- Unit-test server rendering of the remembered email into the MSP sign-in page.
- Unit-test the MSP login form’s initial email state and checkbox behavior.
- API-test cookie set and clear behavior for successful credentials sign-in handling.
- API-test pending remember-context storage during SSO resolve.
- Auth callback test successful SSO finalization of remembered-email state.
- Playwright coverage for remember, clear-on-public-workstation, and no-write-on-failure behaviors.

## Non-goals

- No client portal changes.
- No change to session lifetime or existing NextAuth session cookie behavior.
- No attempt-based remembering before successful authentication.
- No redesign of the overall MSP sign-in screen.
