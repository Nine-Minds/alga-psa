# Appliance setup token and delivery UX

## Problem statement

Appliance operators currently need to know to open `/setup/` after authenticating to the control-plane UI. The setup form also presents too much configuration at once, even though the most important first step is entering the install code from the registration email. Separately, the public nm-store appliance order flow currently shows the install code in the browser after an email address is entered or after checkout, which allows someone to obtain a tenant-bound install secret without proving they control that email inbox.

## Goals

1. Make the appliance initial setup path obvious immediately after control-plane login.
2. Guide operators through setup progressively: setup-token/password auth first, install code next, then tenant/admin/network fields.
3. Keep support-directed release/channel controls behind an Advanced disclosure.
4. Change nm-store appliance ordering so install codes and ISO links are delivered only by email, never displayed or returned to the browser.
5. Preserve existing backend registration, Stripe checkout, email delivery, and reissue behavior.

## Non-goals

- Redesign the whole appliance status dashboard.
- Add email verification accounts or a full customer portal.
- Change alga-license install-code semantics.
- Change appliance release publishing or GHCR OCI manifest resolution.
- Change paid checkout pricing or Stripe products.

## Target users and flows

### Appliance operator first boot

1. Operator opens the appliance control plane URL.
2. Operator is asked for the one-time setup token printed on the appliance console.
3. Operator sets or enters the management password.
4. While the appliance is still in setup mode, `/` redirects to `/setup/` and/or clearly presents a Continue setup CTA.
5. `/setup/` starts with a focused install-code step.
6. After entering an install code, the operator sees the remaining setup form.
7. Release channel and release pin are hidden under Advanced unless support asks for them.

### nm-store Essentials order

1. Visitor enters company/contact/email for the Essentials appliance.
2. Server registers the appliance tenant and emails the install code + ISO link.
3. Browser shows a confirmation that the email was sent or that instructions have been sent.
4. Browser never receives or displays the install code or download URL.

### nm-store paid order

1. Visitor completes Stripe checkout.
2. Thank-you page provisions the appliance tenant server-side and sends the install email.
3. Browser shows payment success and email confirmation.
4. Browser never displays the install code or download URL, including refresh/idempotency paths.

## UX notes

- On the appliance auth gate, keep the setup token prompt clear and front-and-center.
- On the setup screen, visually separate “Step 1: Enter install code” from “Step 2: Configure appliance.”
- The setup continuation CTA on `/` should be prominent enough that an operator who lands on status knows what to do, even if redirect does not happen due to a stale status response or manual navigation.
- Use existing CSS modules and visual language; avoid adding a new UI framework.
- For nm-store confirmation copy, avoid implying the email address was verified. Say “If the address is valid, we’ll send…” only where enumeration resistance matters. For initial registration, it is acceptable to say “Check your email for your install code and download link.”

## Data/API notes

- Appliance status UI uses `GET /api/setup/config`, `GET /api/status`, and `POST /api/setup` from `ee/appliance/host-service/server.mjs`.
- `/api/setup/config` already returns `mode` (`setup` or `status`), which can drive redirect behavior.
- nm-store `registerEssentialsApplianceAction` currently returns `installCode` and `downloadUrl`; change the public return shape to omit secrets.
- nm-store `provisionApplianceFromCheckoutSession` currently returns `installCode` and `downloadUrl`; change thank-you consumption so secrets are not rendered. Prefer not returning secrets from the library where feasible, while preserving idempotency metadata server-side.
- Existing reissue action already uses the desired constant, email-only pattern and should remain unchanged.

## Risks and mitigations

- **Redirect loop risk:** only redirect `/` to `/setup/` when setup config mode is exactly `setup`; do not redirect from `/setup/`.
- **Operator blocked by accidental install-code typo:** frontend gating should only stage the UI; final validation remains server-side.
- **Email delivery failure:** do not leak the install code as a fallback. Show support/retry guidance if email sending fails.
- **Paid thank-you refresh:** keep Stripe subscription metadata idempotency, but do not reveal stored install code on refresh.
- **Cross-repo change:** appliance UI is in `alga-psa`; public order UI is in `~/nm-store`. Validate each repo separately.

## Acceptance criteria

1. Authenticated users who visit appliance `/` in setup mode are sent to `/setup/` automatically.
2. Appliance `/` includes a prominent Continue setup CTA when setup is still required or editable.
3. Appliance `/setup/` initially focuses on install-code entry and hides the rest of the form until a code is entered.
4. Release channel and release pin controls are under an Advanced disclosure on `/setup/`.
5. nm-store Essentials registration response to the browser contains no install code or download URL.
6. nm-store Essentials success screen confirms email delivery/instructions instead of displaying secrets.
7. nm-store paid thank-you screen confirms payment/provisioning and email delivery/instructions instead of displaying secrets.
8. nm-store server-side registration and reissue emails still include the install code and ISO link.
9. Unit tests cover the no-secret browser response paths for Essentials and paid/idempotent provisioning where practical.
10. Appliance status UI and nm-store targeted tests/builds pass or any residual failures are documented.
