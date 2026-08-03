# Cancellation Feedback Validation Plan

## Goal

Prevent low-information cancellation feedback from being submitted while preserving a respectful, low-friction cancellation flow. Validation must be identical at the browser and server-action boundaries.

## Current code

- `ee/server/src/components/settings/account/CancellationFeedbackModal.tsx` owns the category selector, free-text field, submit state, and calls `onConfirm`.
- `ee/server/src/components/settings/account/AccountManagement.tsx` passes the values to the server action.
- `ee/server/src/lib/actions/license-actions.ts` implements `sendCancellationFeedbackAction` and currently forwards unchecked values.
- `packages/email/src/sendCancellationFeedbackEmail.ts` renders validated content into the support email; it should remain a formatting concern.
- `packages/ee/src/lib/actions/license-actions.ts` is the CE stub and should keep its compatibility signature.

## Implementation

1. Add a shared cancellation-feedback Zod schema near the EE server action (or a small reusable validation module imported by both UI and action). Require a known non-empty category and a trimmed reason with at least 20 visible characters; preserve the existing maximum length.
2. Drive the modal from the same constants/rules: category is required, submit stays disabled until both fields are valid, and inline accessible errors explain category and minimum-length failures. Count trimmed/visible input consistently.
3. For category `Other`, show gentle helper copy requesting concrete context; do not invent a second hard threshold unless product requirements demand it.
4. Parse again inside `sendCancellationFeedbackAction` before tenant/license lookup or email construction. Return the action's existing structured failure shape for invalid input and never place invalid text in the support email.
5. Keep `AccountManagement`, the CE stub signature, and email renderer compatible; change them only as needed to carry required category typing.

## Verification

- Behavioral component tests: submit disabled for no category, blank/punctuation/short reason; enabled at 20 visible characters with a category; Other helper copy appears.
- Server-action tests: invalid category and short reason are rejected before email dispatch; valid trimmed values reach the mailer.
- Run focused lint/typecheck and exercise the live modal through the wired app.

## Out of scope and risks

- Do not change cancellation entitlement or Stripe behavior.
- Do not validate only in React; server enforcement is the security boundary.
- Preserve current email escaping/formatting behavior and avoid duplicating divergent constants.
