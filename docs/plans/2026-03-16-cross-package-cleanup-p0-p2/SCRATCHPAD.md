# Scratchpad: Cross-Package Cleanup P0-P2

## Key Commands Reference

### Build & TypeScript
```bash
# Full build (the definitive check)
npm run build

# TypeScript check on specific package (faster than full build)
cd packages/<pkg> && npx tsc --noEmit
cd server && npx tsc --noEmit
cd ee/server && npx tsc --noEmit
cd ee/packages/workflows && npx tsc --noEmit
```

### Cross-Package Violations (Lint)
```bash
# Authoritative violation count (use this, NOT nx run-many which undercounts ~50%)
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | wc -l

# Per-source package breakdown
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*Feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn

# Per-target package breakdown
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn

# Violations for a specific source package
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | grep 'Feature package "client-portal"'

# Violations for a specific target
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | grep 'feature package "documents"'
```

### Circular Dependencies
```bash
# Generate Nx graph and check for new cycles
npx nx graph --file=/tmp/graph.json && node scripts/check-circular-deps.mjs /tmp/graph.json --baseline .github/known-cycles.json

# Update baseline after fixing cycles (include tightened baseline in commit)
npx nx graph --file=/tmp/graph.json && node scripts/check-circular-deps.mjs /tmp/graph.json --update-baseline .github/known-cycles.json

# NOTE: As of 2026-03-16, nx graph may fail with "brace_expansion_1.default is not a function"
# Workaround: clear nx cache: npx nx reset && npx nx graph --file=/tmp/graph.json
```

### Grep Patterns for Finding Violations
```bash
# Find all imports of a package from outside it
grep -r "@alga-psa/documents" --include="*.ts" --include="*.tsx" packages/ | grep -v "packages/documents/" | grep -v node_modules

# Find imports of auth-compat
grep -r "auth-compat" --include="*.ts" --include="*.tsx" -l | grep -v node_modules

# Find type-only cross-vertical imports
grep -rn "import type.*@alga-psa/" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules

# Check what shared/ imports from workflows
grep -r "@alga-psa/workflows" shared/ --include="*.ts" --include="*.tsx" -l | grep -v node_modules
```

### Testing
```bash
# Run tests locally (requires .env.localtest)
npm run test:local

# Run affected tests only
npx vitest run --changed

# Run specific test file
cd server && npx vitest run path/to/test.test.ts
```

## Decisions

- **2026-03-16:** P0-1 test files moved to `ee/packages/workflows/` (not `packages/workflows/`) because the tests reference EE-specific domain event builders
- **2026-03-16:** `nx graph` has brace_expansion bug — may need `npx nx reset` or skip circular dep checking for some commits
- **2026-03-16:** `@alga-psa/shared` added as devDependency to `ee/packages/workflows/package.json` for moved test imports

## Current State (2026-03-16)

- **Branch:** cleanup/circular_deps (rebased on origin/main)
- **Uncommitted:** P0-1 test file moves (10 files moved, ee/packages/workflows/package.json modified)
- **Known cycles baseline:** 30 cycles (18 involve shared->workflows edge, which P0-1 should fix)
- **auth-compat callers:** 2 EE files (ee/server/src/app/api/extensions/_auth.ts, ee/server/src/app/api/provisioning/tenants/route.ts)
- **msp-composition missing re-exports:** assets/, billing/, clients/

## Gotchas

- `npm run lint` is the correct command (not `npx nx run-many --target=lint` which misses ~50% of violations)
- `nx graph` may fail with brace_expansion error — try `npx nx reset` first
- Never create re-export shims when migrating — update all callers directly
- `client-portal` is inherently a composition layer — some violations may be acceptable with eslint-disable
- When adding context facades, providers must go in `DefaultLayout.tsx` (not per-page) because DrawerOutlet renders at layout level
- `msp-composition` is a horizontal package so it's allowed to import from verticals — its internal violations are by design
