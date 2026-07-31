# PRD - Reactivation License Count

- Slug: `reactivation-license-count`
- Date: `2026-07-10`
- Status: Implemented

## Summary

Persist the license count received from nm-store in the signed tenant
reactivation token and return it during token exchange.

## Problem

The reactivation request currently accepts only an email. Its token contains no
license quantity, causing nm-store to create a one-license Stripe subscription.

## Goals

- Authenticate the requested count with the reactivation request HMAC.
- Store the count in the signed token without adding database state.
- Return the count when nm-store exchanges the token.
- Reject non-integer counts outside 1 through 1000.
- Preserve login win-back token creation with an explicit count of one.

## Non-goals

- Editing quantity after the reactivation email is requested.
- Changing Stripe pricing or checkout UI.
- Adding a database migration.

## Users and Primary Flows

A returning customer requests reactivation after choosing a license count in
nm-store. Alga authenticates the email and count, signs both into the token, and
returns the count to nm-store when the account administrator follows the link.

## UX / UI Notes

No Alga UI changes are required.

## Requirements

- `request-reactivation` requires `licenseCount` from 1 through 1000.
- The request HMAC payload is `<email>:<licenseCount>:<timestamp>`.
- `license_count` is part of the signed token payload.
- Token verification validates `license_count`.
- Token reservation returns the verified count.
- Token exchange responds with `licenseCount`.
- Login win-back requests use one license because no checkout request exists.

## Data / API / Integrations

This updates the private nm-store HMAC contract and signed reactivation token.
The token ledger schema remains unchanged because it stores only the token hash.

## Security / Permissions

The count is authenticated by both the request HMAC and token signature. Invalid
or legacy tokens without a count fail closed.

## Rollout / Migration

Deploy with the matching nm-store change. Existing unconsumed tokens without a
count become invalid and users must request a new link.

## Acceptance Criteria
