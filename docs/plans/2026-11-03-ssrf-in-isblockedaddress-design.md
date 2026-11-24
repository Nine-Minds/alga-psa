# Design — Security: ssrf in isBlockedAddress

Card: Security: ssrf in isBlockedAddress

## Finding (confirmed on main)

The IPv6 denylist in server/src/lib/net/safeFetch.ts:131-157 covers only a few ranges, and isBlockedAddress (:194-205) treats every other syntactically valid IPv6 address as safe, so fec0::/10 site-local, 100::/64 and transition ranges pass and are pinned by resolveVettedAddress (:353-376). A document:create user can then reach an internal IPv6 destination through ApiDocumentController.

## Approach

1. Invert the IPv6 decision: default-deny and admit only global unicast (2000::/3 minus the special-purpose table), using a complete published special-purpose registry rather than a denylist.
2. Keep the pinned-address re-check after DNS resolution, and apply the same predicate to the literal-address and redirect paths.
3. Tests: fec0::/10, 100::/64, ::ffff: mapped internals, link-local and ULA are all refused; a public IPv6 literal and hostname still fetch.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
