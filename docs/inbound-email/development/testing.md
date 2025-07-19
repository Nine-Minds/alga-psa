# Testing Inbound Email

## Overview

This file merges the previous *e2e-quick-reference* and *e2e-testing-guide* into a single source of truth.

### Test Matrix

| Scenario | Layer | Tools |
|----------|-------|-------|
| Unit – `setupPubSub` happy-path | jest + nock | `__tests__/setupPubSub.spec.ts` |
| Unit – Adapter does **not** call `setupPubSub` | jest spy | `__tests__/gmailAdapter.spec.ts` |
| Integration – OAuth callback | Playwright | `tests/oauth/google.spec.ts` |
| E2E – Email converts to Ticket | Playwright + Mailosaur | `tests/inbound-email.e2e.ts` |

## Quick Commands

```bash
# Run all jest unit tests
npm run test:unit

# Run E2E against local stack
pnpm exec playwright test tests/inbound-email.e2e.ts

# Focus on a single file
npm test -- gmailAdapter.spec.ts
```

## Mocking Tips

* Use `nock('https://gmail.googleapis.com')` to intercept Gmail API.
* For Pub/Sub, stub `googleapis` with jest mocks; you rarely need to hit real GCP.

