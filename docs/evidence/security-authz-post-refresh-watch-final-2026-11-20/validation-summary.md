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
