# PR #4204 repair validation

Validation source: checkout HEAD `fa97731e76b69a6d0736e9f30b513e59bf446e9f` plus the task-owned source diff with SHA-256 `92e25078a760e855c6fe7dbc00d10c819a2b4b5a59f823e68e4dd7e9922f59f1`. The PR base reported by GitHub was `a1159f3256c80dee1ff58a260cce2f11a9ad8976`. The unrelated pre-existing `package-lock.json` edit was excluded from this source digest and all commits.

| Edition/scope | Command | Result | Output |
| --- | --- | --- | --- |
| Route + middleware | `cd server && npx vitest run src/app/api/email/refresh-watch/route.test.ts src/test/unit/middleware.apiKeyAuth.test.ts --reporter=verbose` | Exit 0; 39/39 passed | `focused-route-middleware.log` |
| Turbopack resolver fixture | `cd server && npx vitest run src/test/unit/nextConfigServicePrincipalsAlias.contract.test.ts --reporter=verbose` | Exit 0; 2/2 passed, both edition compile fixtures | `resolver-compile-fixture.log` |
| Community API-auth consumers | `EDITION=community NEXT_PUBLIC_EDITION=community npx vitest run ../packages/auth/src/services/apiKeyService.keyGateAllowList.test.ts ../packages/auth/src/services/apiKeyService.F041.serviceOwner.test.ts src/test/unit/api/apiKeyServiceForApi.clientOwner.test.ts --reporter=verbose` | Exit 0; 16/16 passed | `auth-consumers-community.log` |
| Enterprise API-auth consumers | Same consumer command with `EDITION=enterprise NEXT_PUBLIC_EDITION=enterprise` | Exit 0; 16/16 passed | `auth-consumers-enterprise.log` |
| Boundary guard | `node scripts/guard-service-principals-boundary.mjs` | Exit 0 | `service-principals-boundary.log` |
| Full server typecheck | `cd server && NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | Exit 0 | `server-typecheck.log` |
| Community production | `NODE_OPTIONS=--max-old-space-size=6144 NEXT_BUILD_CPUS=1 NEXT_DIST_DIR=.next-security-authz-ce npm run build:ce` | Exit 130; manually interrupted after available host memory fell to 4.6 GiB while the Next process was about 20 GiB RSS. Nx dependency targets completed from cache; Next production compilation did not complete. Not a pass. | `build-ce.log` |
| Enterprise production | `NODE_OPTIONS=--max-old-space-size=6144 NEXT_BUILD_CPUS=1 NEXT_DIST_DIR=.next-security-authz-ee npm run build:ee` | Exit 130; manually interrupted after available host memory fell to 4.9 GiB with build processes still growing. Not a pass. | `build-ee.log` |

The resolver fixture uses a minimal app and disables Next's agent-upgrade reminder only inside that disposable fixture. It exercises Turbopack compilation of the configured entry for both editions; it is not a full production build. The two production build commands are unfinished due host memory pressure. No app server was started or recovered.

## Review follow-up

Source revision under review: parent commit `166cad869e1b00eb1445e034b02f360b3dabff95` plus the review follow-up source diff with SHA-256 `a2062cb216cc3a896ef2f1089336efc9cc9df75ed721965bddb99c1bde582d84`. The test fixture now reads the relevant `turbopack.resolveAlias` entries from the actual Next config as ordered `[key, target]` pairs, and passes those exact edition-specific pairs into the fixture's `Object.fromEntries`. Only the fixture-only `@product/service-principals/types` tsconfig alias is appended.

The restored resolver fixture passed **4/4**: community, `EDITION=enterprise`, `EDITION=ee`, and `NEXT_PUBLIC_EDITION=enterprise`. To verify the regression, I temporarily moved the EE-specific `@ee/lib/service-principals` alias after the broad `@ee` alias in production `server/next.config.mjs`; the targeted enterprise fixture failed (exit 1, `expected 3 to be less than 1`). I restored production ordering and reran the full four-case fixture successfully. The failed mutation run is preserved in `review-reverted-alias-order-fails.log`.

Vitest now selects the service-principal entry using the same three enterprise selectors as `next.config.mjs`. The API consumer test compares the configured import's function identities with the direct community and enterprise entry modules, then exercises internal-user success and client/service rejection. Consumer suites passed **17/17** under each configuration: community, `EDITION=enterprise`, `EDITION=ee`, and `NEXT_PUBLIC_EDITION=enterprise`. The service-owner test title was made edition-neutral. Logs are `review-consumers-community.log`, `review-consumers-edition-enterprise.log`, `review-consumers-edition-ee.log`, and `review-consumers-public-edition.log`.

On the follow-up source, the required refresh-watch and middleware suites passed **39/39** (`review-focused-route-middleware.log`) and full server typecheck passed (exit 0; `review-server-typecheck.log`). The earlier CE/EE production attempts remain interrupted as documented above. They were not repeated on this host. The PR Actions run available before this follow-up was at an older SHA and did not provide CE/EE production build evidence; current-SHA CI must be checked after publication.
