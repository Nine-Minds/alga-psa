# Investigation

- The account dropdown in `server/src/components/layout/Header.tsx` sends internal users to `/msp/profile`.
- Running `resolveProductRouteBehavior` on the current checkout returned `not_found` for the profile of a PSA principal with surface kind `co_managed_seat`. The same principal could open tickets. An ordinary PSA principal could open both routes.
- `shared/services/productSurfaceKinds.ts` defines the seat routes. `server/src/lib/serverProductRouteGuard.tsx` turns a closed route into a 404 before the page renders.
- `UserProfile.tsx` loads the current user. The existing `updateUser` action permits self-updates. Inspect all tabs and the separate onboarding preference rendered by the page when determining what the seat can use.
- `packages/co-managed/src/seatAuthority.ts` declares the credential policy and its mobile-session exception. `packages/auth/src/services/apiKeyService.ts` enforces issuance. The seat surface Playwright test already covers general key refusal and its comment assumes the entire profile is closed.
